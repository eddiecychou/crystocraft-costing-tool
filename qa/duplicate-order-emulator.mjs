import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { readFile } from 'node:fs/promises'
import { fictionalInvoiceRequest } from './invoice-recovery-postgres-fixture.mjs'
import { createDuplicateFixture } from './duplicate-order-fixture.mjs'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { createOrderRequests } from '../netlify/functions/lib/orderCreateRequests.js'
import { soYear } from '../src/soNumberModel.js'

const projectId = process.env.GCLOUD_PROJECT
assert.equal(projectId, 'demo-sh07-manual')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const app = initializeApp({ projectId }, 'duplicate-qa'),
  db = getFirestore(app)
const sourceId = 'old-order',
  source = db.doc('orders/' + sourceId),
  counter = db.doc('counters/so_' + soYear())
let env, fixture, afterIssue
const countUc = async () =>
  Number(
    (
      await fixture.db.pool.query(
        'select count(*) as n from oc_shipping_private.duplicate_order_ucs'
      )
    ).rows[0].n
  )
const registry = async () =>
  (await fixture.db.pool.query('select * from public.uc_registry order by id'))
    .rows
const countOrders = async () => (await db.collection('orders').get()).size
const target = (uid, id) =>
  db.doc('shipping_create_operators/' + uid + '/requests/' + id)
const handler = orderRequestHandler({
  verifyToken: async (uid) => ({ uid, email: uid + '@example.invalid' }),
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo: createOrderRequests(
    db,
    () => {
      throw Error('Unexpected file check')
    },
    async (id, request, issue) => {
      const result = await fixture.uc(id, request, issue)
      if (issue && afterIssue) await afterIssue()
      return result
    }
  )
})
const api = async (uid, action, id, more = {}) => {
  const res = await handler(
    new Request('http://fictional.invalid/api/shipping-order-request', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + uid },
      body: JSON.stringify({ action, operator: uid, id, ...more })
    })
  )
  return { code: res.status, data: await res.json() }
}
const begin = (previous, more = {}) =>
  api('staff', 'duplicate', randomUUID(), {
    source_id: sourceId,
    previous_id: previous,
    ...more
  })
const success = (r) => {
  assert.equal(r.code, 200, JSON.stringify(r))
  return r.data
}
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') }
  })
  fixture = await createDuplicateFixture()
})
beforeEach(async () => {
  await env.clearFirestore()
  await fixture.db.pool.query(
    "truncate oc_shipping_private.duplicate_order_ucs; delete from public.uc_registry where uc_no<>'UC90'"
  )
  afterIssue = null
  await Promise.all(
    Object.entries({
      staff: ['shipping', 'quotes', 'uc'],
      other: ['shipping', 'quotes', 'uc'],
      noUc: ['shipping', 'quotes'],
      noSo: ['shipping', 'uc'],
      customer: []
    }).map(([uid, modules]) =>
      db
        .doc('users/' + uid)
        .set({ role: uid === 'customer' ? 'customer' : 'staff', modules })
    )
  )
  await source.set({
    customer_name: 'Fictional buyer',
    customer_id: 'fixture',
    currency: 'RMB',
    uc_no: 'UC-OLD/26',
    erp_so_no: 'SO-OLD',
    erp_si_no: 'SI-OLD',
    notes: 'Keep notes',
    incoterm: 'CIF',
    destination: { country: 'HK', city: 'HK' },
    total_amount: 99,
    deposit_paid: 50,
    status: 'shipped'
  })
  await source.collection('lines').doc('b').set({
    line_no: 9,
    description: 'Second',
    qty_ordered: 1000,
    unit_price: 1.222
  })
  await source
    .collection('lines')
    .doc('a')
    .set({ line_no: 1, description: 'First', qty_ordered: 2, unit_price: 5 })
  await source
    .collection('lines')
    .doc('legacy')
    .set({ description: 'Unnumbered', qty_ordered: 1, unit_price: 1 })
  await counter.set({ last: 100 })
})
after(async () => {
  await fixture?.db.close()
  await env?.cleanup()
  await db.terminate()
  await deleteApp(app)
})
test('concurrent source clicks and repeated completion produce one copy, one UC and one SO; snapshot and source are preserved', async () => {
  const original = (await source.get()).data()
  const start = await Promise.all([begin(null), begin(null)])
  const [first, second] = start.map(success)
  assert.equal(first.id, second.id)
  assert.notEqual(first.created, second.created)
  assert.equal(await countUc(), 0)
  assert.deepEqual(
    first.lines.map((x) => x.description),
    ['First', 'Second', 'Unnumbered']
  )
  await source.collection('lines').doc('b').update({ unit_price: 9 })
  const saved = (
    await Promise.all([
      api('staff', 'commit', first.id),
      api('staff', 'commit', first.id)
    ])
  ).map(success)
  assert.equal(saved[0].order_id, saved[1].order_id)
  assert.equal(await countOrders(), 2)
  assert.equal(await countUc(), 1)
  assert.equal((await counter.get()).data().last, 101)
  const root = db.doc('orders/' + saved[0].order_id),
    copy = (await root.get()).data()
  assert.deepEqual((await source.get()).data(), original)
  for (const key of [
    'customer_id',
    'customer_name',
    'currency',
    'notes',
    'incoterm'
  ])
    assert.equal(copy[key], original[key])
  assert.equal(copy.source, 'duplicated')
  assert.equal(copy.status, 'draft')
  assert.equal(copy.total_amount, null)
  assert.equal(copy.deposit_paid, null)
  assert.equal(copy.erp_si_no, '')
  assert.notEqual(copy.uc_no, original.uc_no)
  assert.deepEqual(
    (await root.collection('lines').orderBy('line_no').get()).docs.map((d) => [
      d.get('line_no'),
      d.get('description'),
      d.get('unit_price')
    ]),
    [
      [1, 'First', 5],
      [2, 'Second', 1.222],
      [3, 'Unnumbered', 1]
    ]
  )
  const rows = await registry()
  assert.equal(rows.length, 2)
  assert.equal(rows[1].uc_no + rows[1].year, copy.uc_no)
  assert.equal(Number(rows[1].balance), 0)
  assert.equal(rows[1].confirmed, false)
  assert.equal(rows[1].created_by, 'staff@example.invalid')
  const status = success(await api('staff', 'commit', first.id))
  assert.equal(status.order_id, root.id)
  assert.equal(success(await begin(null)).id, first.id)
})
test('UC response lost then status and Resume recover the exact SQL receipt, even after source removal', async () => {
  const op = success(await begin(null))
  afterIssue = async () => {
    throw Error('lost UC confirmation')
  }
  assert.equal((await api('staff', 'commit', op.id)).code, 503)
  assert.equal(await countOrders(), 1)
  assert.equal(await countUc(), 1)
  assert.equal((await counter.get()).data().last, 100)
  await source.delete()
  const pending = success(await api('staff', 'status', op.id))
  assert.equal(pending.status, 'prepared')
  assert.equal(pending.uc_started, true)
  assert.ok(pending.uc)
  afterIssue = null
  const done = success(await api('staff', 'commit', op.id))
  assert.equal(
    (await db.doc('orders/' + done.order_id).get()).get('uc_no'),
    pending.uc
  )
  assert.equal(await countUc(), 1)
})
test('order save rejected after UC issuance can finish after access is restored without issuing again', async () => {
  const op = success(await begin(null))
  afterIssue = async () =>
    db.doc('users/staff').update({ modules: ['shipping', 'uc'] })
  assert.equal((await api('staff', 'commit', op.id)).code, 403)
  assert.equal(await countUc(), 1)
  assert.equal(await countOrders(), 1)
  afterIssue = null
  await db.doc('users/staff').update({ modules: ['shipping', 'uc', 'quotes'] })
  success(await api('staff', 'commit', op.id))
  assert.equal(await countUc(), 1)
  assert.equal((await counter.get()).data().last, 101)
})
test('explicit repeat copies get separate receipts; racing identical additional requests converge; stale requests do not create a third copy', async () => {
  const first = success(await begin(null))
  const a = success(await api('staff', 'commit', first.id))
  const [b, c] = (await Promise.all([begin(first.id), begin(first.id)])).map(
    success
  )
  assert.equal(b.id, c.id)
  assert.notEqual(b.id, first.id)
  const saved = success(await api('staff', 'commit', b.id))
  assert.notEqual(saved.order_id, a.order_id)
  assert.notEqual(saved.uc, a.uc)
  assert.equal((await begin(randomUUID())).code, 409)
  assert.equal(success(await begin(first.id)).id, b.id)
  assert.equal(await countOrders(), 3)
  assert.equal(await countUc(), 2)
  assert.equal((await counter.get()).data().last, 102)
})
test('stale or missing sources and unauthorized users cannot prepare or allocate; another operator cannot reuse the request', async () => {
  assert.equal(
    (await begin(null, { expected_header: { notes: 'stale' } })).code,
    409
  )
  assert.equal((await begin(null, { source_id: 'missing' })).code, 409)
  for (const uid of ['customer', 'noUc', 'noSo'])
    assert.equal(
      (await api(uid, 'duplicate', randomUUID(), { source_id: sourceId })).code,
      403
    )
  const first = success(await begin(null))
  assert.equal(
    (await api('other', 'commit', first.id, { operator: 'staff' })).code,
    403
  )
  assert.equal(success(await api('other', 'status', first.id)).status, 'empty')
  await db.doc('users/staff').update({ modules: ['shipping', 'quotes'] })
  assert.equal((await api('staff', 'commit', first.id)).code, 403)
  assert.equal(await countUc(), 0)
  assert.equal(await countOrders(), 1)
})
test('conflicting receipt or edited registry row blocks the order and preserves the financial record', async () => {
  const op = success(await begin(null))
  afterIssue = async () => {
    throw Error('lost response')
  }
  await api('staff', 'commit', op.id)
  afterIssue = null
  const snap = (await target('staff', op.id).get()).data()
  await assert.rejects(
    fixture.uc(op.id, { ...snap.uc_request, source_id: 'elsewhere' }, true),
    /inconsistent|changed/
  )
  await fixture.db.pool.query(
    "update public.uc_registry set currency='EUR' where customer='Fictional buyer'"
  )
  assert.match(success(await api('staff', 'status', op.id)).uc_error, /changed/)
  assert.equal((await api('staff', 'commit', op.id)).code, 409)
  assert.equal(await countUc(), 1)
  assert.equal(await countOrders(), 1)
  assert.equal((await registry())[1].currency, 'EUR')
})
test('removed copy is reported for review; an explicit new copy can be made without resurrecting the removed order', async () => {
  const op = success(await begin(null)),
    saved = success(await api('staff', 'commit', op.id))
  await db.doc('orders/' + saved.order_id).delete()
  assert.equal(success(await begin(null)).status, 'review')
  assert.equal((await api('staff', 'commit', op.id)).code, 409)
  const next = success(await begin(op.id))
  assert.notEqual(
    success(await api('staff', 'commit', next.id)).order_id,
    saved.order_id
  )
  assert.equal(await countUc(), 2)
  assert.equal(await countOrders(), 2)
})
test('SQL lookup has no side effects; receipt and grant boundaries survive concurrent requests and rollback', async () => {
  const id = randomUUID(),
    start = success(await begin(null)),
    request = (await target('staff', start.id).get()).get('uc_request')
  assert.equal(await fixture.uc(id, request, false), null)
  assert.equal(await countUc(), 0)
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(
      fixture.db.asRole(role, fixture.rpc, [id, request, true]),
      (e) => e.code === '42501'
    )
    await assert.rejects(
      fixture.db.asRole(
        role,
        'select * from oc_shipping_private.duplicate_order_ucs'
      ),
      (e) => e.code === '42501'
    )
  }
  await assert.rejects(
    fixture.db.asRole(
      'service_role',
      'select * from oc_shipping_private.duplicate_order_ucs'
    ),
    (e) => e.code === '42501'
  )
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => fixture.uc(id, request, true))
  )
  assert.equal(new Set(responses.map((x) => x.number)).size, 1)
  assert.equal(await countUc(), 1)
  assert.equal((await registry()).length, 2)
  const c = await fixture.db.pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    await c.query(fixture.rpc, [randomUUID(), request, true])
    await c.query('rollback')
  } finally {
    c.release()
  }
  assert.equal(await countUc(), 1)
  assert.equal((await registry()).length, 2)
})

test('explicit second copy can proceed while the earlier receipt awaits review; exact replay still opens the earlier request', async () => {
  const first = success(await begin(null))
  afterIssue = async () => {
    throw Error('lost acknowledgment')
  }
  assert.equal((await api('staff', 'commit', first.id)).code, 503)
  afterIssue = null
  const next = success(await begin(first.id))
  assert.equal(next.created, true)
  assert.equal(
    success(await api('staff', 'duplicate', first.id, { source_id: sourceId }))
      .id,
    first.id
  )
  const secondOrder = success(await api('staff', 'commit', next.id))
  const originalOrder = success(await api('staff', 'commit', first.id))
  assert.notEqual(secondOrder.uc, originalOrder.uc)
  assert.equal(await countUc(), 2)
  assert.equal(success(await begin(null)).id, next.id)
})
test('an inconsistent prepared target blocks UC issuance before the registry insert', async () => {
  const op = success(await begin(null))
  const request = (await target('staff', op.id).get()).data()
  await db
    .doc('orders/' + request.order_id)
    .set({ notes: 'Fictional unrelated target' })
  assert.equal((await api('staff', 'commit', op.id)).code, 409)
  assert.equal(await countUc(), 0)
  assert.equal((await counter.get()).get('last'), 100)
})

test('a copied order can reuse its UC for first, split and reissued invoices with both migrations installed', async () => {
  const op = success(await begin(null)),
    saved = success(await api('staff', 'commit', op.id))
  const ledger = await fixture.db.pool.connect()
  try {
    await ledger.query('begin')
    await ledger.query('set local role service_role')
    const numbers = new Set()
    for (const purpose of ['first', 'split', 'reissue']) {
      const invoiceId = randomUUID()
      const input = fictionalInvoiceRequest({
        order_id: saved.order_id,
        customer: 'Fictional buyer',
        currency: 'RMB',
        uc_no: saved.uc,
        year: soYear(),
        purpose,
        reason: purpose === 'first' ? '' : 'Reviewed fictional ' + purpose
      })
      const allocate = async () =>
        (
          await ledger.query(
            'select * from public.allocate_sales_invoice_once($1,$2::jsonb)',
            [invoiceId, input]
          )
        ).rows[0]
      const invoice = await allocate()
      assert.deepEqual(await allocate(), invoice)
      assert.equal(invoice.o_uc_no, saved.uc)
      numbers.add(invoice.o_si_no)
    }
    assert.equal(numbers.size, 3)
  } finally {
    await ledger.query('rollback')
    ledger.release()
  }
  assert.equal(await countUc(), 1)
  assert.equal((await registry()).length, 2)
})
