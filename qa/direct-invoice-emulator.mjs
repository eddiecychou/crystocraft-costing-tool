// Real request repository, invoice handler, Firestore transactions and local PostgreSQL.
import assert from 'node:assert/strict'
import { test, before, beforeEach, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createInvoiceTestDatabase } from './invoice-recovery-postgres-fixture.mjs'
import { directInvoiceFixture } from './direct-invoice-fixture.mjs'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { createOrderRequests } from '../netlify/functions/lib/orderCreateRequests.js'
import { invoiceExpected } from '../src/invoiceRecoveryModel.js'
import { soYear } from '../src/soNumberModel.js'

const projectId = process.env.GCLOUD_PROJECT
assert.equal(projectId, 'demo-sh07-manual')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const app = initializeApp({ projectId }, 'initial-direct-test'),
  db = getFirestore(app)
const counter = db.doc('counters/so_' + soYear())
const draft = {
  order: {
    customer_id: 'fictional',
    customer_name: 'Fictional buyer',
    currency: 'GBP',
    deposit_paid: 100
  },
  lines: [
    {
      item_code: 'FIC-DIRECT',
      description: 'Fictional item',
      qty_ordered: 1000,
      unit_price: 1.222,
      unit: 'pcs'
    }
  ]
}
const orderHandler = orderRequestHandler({
  verifyToken: async (uid) => ({ uid }),
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo: createOrderRequests(db, () => {
    throw Error('Direct invoices do not upload a PI')
  })
})
let sqlDb, invoices, faults
before(async () => {
  sqlDb = await createInvoiceTestDatabase()
})
beforeEach(async () => {
  await db.recursiveDelete(db.collection('orders'))
  await db.recursiveDelete(db.collection('shipping_create_operators'))
  await Promise.all(
    Object.entries({
      staff: ['shipping', 'uc'],
      limited: ['shipping'],
      other: ['shipping', 'uc'],
      customer: []
    }).map(([uid, modules]) =>
      db
        .doc('users/' + uid)
        .set({ role: uid === 'customer' ? 'customer' : 'staff', modules })
    )
  )
  await counter.set({ last: 100 })
  await sqlDb.reset()
  await sqlDb.pool.query(sqlDb.migration)
  await sqlDb.pool.query(sqlDb.followupMigration)
  faults = {}
  invoices = directInvoiceFixture(db, sqlDb, faults)
})
after(async () => {
  await sqlDb?.close()
  await db.terminate()
  await deleteApp(app)
})
async function api(handler, uid, body) {
  const r = await handler(
    new Request('http://localhost/api/fixture', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + uid },
      body: JSON.stringify(body)
    })
  )
  return { code: r.status, body: await r.json() }
}
const order = (id, action, fields = {}, uid = 'staff') =>
  api(orderHandler, uid, { id, operator: uid, action, ...fields })
const success = (r) => {
  assert.equal(r.code, 200, JSON.stringify(r))
  return r.body
}
const prep = (id, overrides = {}, uid = 'staff') =>
  order(
    id,
    'prepare',
    { ...draft, order: { ...draft.order, ...overrides }, mode: 'direct' },
    uid
  )
const issue = (orderId, id, uid = 'staff') =>
  api(invoices.handler, uid, {
    action: 'initial_direct',
    order_id: orderId,
    request_id: id
  })
async function direct(id = randomUUID(), header = {}, uid = 'staff') {
  success(await prep(id, header, uid))
  const saved = success(await order(id, 'commit', {}, uid))
  return { id, saved }
}
async function counts(orders, invoices) {
  assert.equal((await db.collection('orders').get()).size, orders)
  assert.equal((await counter.get()).get('last'), 100)
  const records = await sqlDb.counts()
  assert.equal(records.invoices, invoices + 1)
  assert.equal(records.receipts, invoices)
}
test('lost prepare and order confirmations, reload and two tabs converge on one order, SI, UC and ledger row', async () => {
  const id = randomUUID()
  const results = await Promise.all([prep(id), prep(id)])
  assert.ok(
    results.map(success).every((p) => p.direct && p.status === 'prepared')
  )
  const [a, b] = (
    await Promise.all([order(id, 'commit'), order(id, 'commit')])
  ).map(success)
  assert.equal(a.order_id, b.order_id)
  assert.equal(a.so, '')
  assert.equal(a.invoice.state, 'due')
  assert.equal(
    success(await order(id, 'list')).requests[0].invoice.state,
    'due'
  )
  await counts(1, 0)
  await Promise.all([issue(a.order_id, id), issue(a.order_id, id)]).then(
    (rows) => rows.map(success)
  )
  const status = success(await order(id, 'status'))
  assert.equal(status.invoice.state, 'issued')
  assert.equal(success(await prep(id)).order_id, a.order_id)
  assert.equal(success(await order(id, 'commit')).invoice.si, status.invoice.si)
  success(await issue(a.order_id, id))
  await counts(1, 1)
  assert.equal((await sqlDb.counts()).ucs, 2)
  const root = db.doc('orders/' + a.order_id),
    saved = (await root.get()).data()
  assert.equal(saved.source, 'direct_invoice')
  assert.equal(saved.erp_si_no, status.invoice.si)
  assert.equal(saved.total_amount, 1222)
  assert.equal(saved.deposit_paid, 100)
  assert.equal(
    (await root.collection('lines').get()).docs[0].get('unit_price'),
    1.222
  )
})
test('lost SQL reply after issuance is recovered against the same durable invoice operation and number', async () => {
  const { id, saved } = await direct()
  faults.lostSqlAck = true
  success(await issue(saved.order_id, id))
  await counts(1, 1)
  const pending = success(await order(id, 'status')).invoice
  assert.equal(pending.state, 'pending')
  assert.ok(pending.operation_id)
  const originalRow = (
    await sqlDb.pool.query(
      'select id,si_no,uc_no from app_sales_invoice where order_id=$1',
      [saved.order_id]
    )
  ).rows[0]
  success(await issue(saved.order_id, id))
  success(await issue(saved.order_id, id))
  const result = success(await order(id, 'status')).invoice
  assert.equal(result.operation_id, pending.operation_id)
  assert.equal(result.si, originalRow.si_no)
  assert.equal(result.state, 'issued')
  assert.equal(
    (await db.doc('orders/' + saved.order_id).get()).get('uc_no'),
    originalRow.uc_no
  )
  await counts(1, 1)
})
test('an existing first claim from the saved order is adopted; replay never runs a later pending split or reissue', async () => {
  const { id, saved } = await direct(),
    root = db.doc('orders/' + saved.order_id)
  const claim = await invoices.repo.begin(
    saved.order_id,
    { action: 'raise', expected: invoiceExpected((await root.get()).data()) },
    { uid: 'staff' }
  )
  success(await issue(saved.order_id, id))
  const first = success(await order(id, 'status')).invoice
  assert.equal(first.operation_id, claim.operation.id)
  for (const purpose of ['split', 'reissue']) {
    const current = (await root.get()).data()
    const additional = await invoices.repo.begin(
      saved.order_id,
      {
        action: 'new',
        previous_operation_id: current.invoice_allocation_id,
        purpose,
        reason: 'Fictional ' + purpose,
        expected: invoiceExpected(current)
      },
      { uid: 'staff' }
    )
    const before = await sqlDb.counts()
    success(await issue(saved.order_id, id))
    assert.deepEqual(await sqlDb.counts(), before)
    assert.equal(
      (await invoices.repo.operation(saved.order_id, additional.operation.id))
        .result,
      null
    )
    success(
      await api(invoices.handler, 'staff', {
        action: 'resume',
        order_id: saved.order_id
      })
    )
    assert.equal(success(await order(id, 'status')).invoice.si, first.si)
  }
  await counts(1, 3)
})
test('first issue completed entirely from the saved order is found even after an independent split has started', async () => {
  const { id, saved } = await direct(),
    root = db.doc('orders/' + saved.order_id)
  const first = success(
    await api(invoices.handler, 'staff', {
      action: 'raise',
      order_id: saved.order_id,
      expected: invoiceExpected((await root.get()).data())
    })
  )
  await invoices.repo.begin(
    saved.order_id,
    {
      action: 'new',
      previous_operation_id: first.operation.id,
      purpose: 'split',
      reason: 'Second delivery',
      expected: first.expected
    },
    { uid: 'staff' }
  )
  success(await issue(saved.order_id, id))
  assert.equal(
    success(await order(id, 'status')).invoice.si,
    first.operation.result.si_no
  )
  await counts(1, 1)
})
test('supplied SI and legacy SI in the SO field skip allocation; genuine identical Direct Invoices stay independent', async () => {
  for (const refs of [
    { erp_si_no: 'SI-FICTIONAL' },
    { erp_so_no: 'SI-LEGACY' }
  ]) {
    const { id, saved } = await direct(randomUUID(), refs)
    assert.equal(saved.invoice.state, 'supplied')
    success(await issue(saved.order_id, id))
    assert.equal(
      success(await order(id, 'status')).invoice.si,
      Object.values(refs)[0]
    )
  }
  const a = await direct(),
    b = await direct()
  success(await issue(a.saved.order_id, a.id))
  success(await issue(b.saved.order_id, b.id))
  assert.notEqual(a.saved.order_id, b.saved.order_id)
  await counts(4, 2)
})
test('shipping-only staff can save the Direct order and regain UC permission to finish it; another operator cannot use the receipt', async () => {
  const { id, saved } = await direct(randomUUID(), {}, 'limited')
  assert.equal((await issue(saved.order_id, id, 'limited')).code, 403)
  assert.equal((await issue(saved.order_id, id, 'other')).code, 404)
  assert.equal((await issue(saved.order_id, id, 'customer')).code, 403)
  assert.equal(
    (await order(id, 'status', { operator: 'limited' }, 'other')).code,
    403
  )
  await counts(1, 0)
  await db.doc('users/limited').update({ modules: ['shipping', 'uc'] })
  success(await issue(saved.order_id, id, 'limited'))
  await counts(1, 1)
})
test('changed invoice details and removed or replaced orders require review without creating new records', async () => {
  const { id, saved } = await direct(),
    root = db.doc('orders/' + saved.order_id)
  await root.update({ currency: 'USD' })
  assert.equal(success(await order(id, 'status')).invoice.state, 'review')
  assert.equal((await issue(saved.order_id, id)).code, 409)
  await root.update({ erp_si_no: 'SI-EXTERNAL' })
  success(await issue(saved.order_id, id))
  await counts(1, 0)
  await root.delete()
  assert.equal(success(await order(id, 'status')).status, 'review')
  assert.equal((await order(id, 'commit')).code, 409)
  await counts(0, 0)
  await root.set({ source: 'direct_invoice', customer_name: 'Replacement' })
  assert.equal((await issue(saved.order_id, id)).code, 409)
  await counts(1, 0)
})
test('manual requests cannot be used as Direct Invoice requests or bypass SO permission by switching mode', async () => {
  const id = randomUUID(),
    directSaved = await direct(id)
  assert.equal(
    (
      await order(id, 'prepare', {
        ...draft,
        order: { ...draft.order, erp_so_no: 'SO-OLD' }
      })
    ).code,
    409
  )
  assert.equal(
    (
      await order(randomUUID(), 'prepare', {
        ...draft,
        mode: 'direct',
        file: { name: 'fixture.pdf' }
      })
    ).code,
    400
  )
  const foreign = await direct()
  assert.equal((await issue(foreign.saved.order_id, directSaved.id)).code, 409)
  await counts(2, 0)
})

test('an issued invoice survives a failed order link; Finish links the same SQL row and SI', async () => {
  const { id, saved } = await direct()
  faults.beforeLink = true
  assert.equal((await issue(saved.order_id, id)).code, 503)
  const pending = success(await order(id, 'status')).invoice
  assert.equal(pending.state, 'pending')
  assert.match(pending.si, /^SI\d+$/)
  assert.equal(
    (await db.doc('orders/' + saved.order_id).get()).get('erp_si_no'),
    ''
  )
  const before = await sqlDb.counts()
  success(await issue(saved.order_id, id))
  const linked = success(await order(id, 'status')).invoice
  assert.equal(linked.state, 'issued')
  assert.equal(linked.operation_id, pending.operation_id)
  assert.equal(linked.si, pending.si)
  assert.equal((await sqlDb.counts()).invoices, before.invoices)
  assert.equal((await sqlDb.counts()).ucs, before.ucs)
  await counts(1, 1)
})
test('a manual order with a supplied SO cannot be invoiced through the initial Direct Invoice action', async () => {
  const id = randomUUID()
  success(
    await order(id, 'prepare', {
      ...draft,
      order: { ...draft.order, erp_so_no: 'SO-FICTIONAL' }
    })
  )
  const saved = success(await order(id, 'commit'))
  assert.equal(saved.direct, false)
  assert.equal((await issue(saved.order_id, id)).code, 409)
  assert.equal((await issue(saved.order_id, 'invalid')).code, 400)
  await counts(1, 0)
})
