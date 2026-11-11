// Real Admin transactions, client security rules, handler and PostgreSQL 17.
// All records are fictional; both stores must be explicit local services.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  collection,
  writeBatch
} from 'firebase/firestore'
import { createInvoiceTestDatabase } from './invoice-recovery-postgres-fixture.mjs'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { createInvoiceRecoverySql } from '../netlify/functions/lib/invoiceRecoverySql.js'
import { invoiceTestRest } from './invoice-recovery-rest-fixture.mjs'

import {orderEditBase,orderEditPatch} from '../src/orderEditModel.js'
import { invoiceExpected } from '../src/invoiceRecoveryModel.js'
if (
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    process.env.FIRESTORE_EMULATOR_HOST || ''
  )
)
  throw Error('Local emulator required; live financial writes forbidden')
const projectId = 'demo-invoice-recovery',
  app = initializeApp({ projectId }, 'invoice-recovery-qa'),
  store = getFirestore(app),
  id = 'fictional-order'
const profiles = {
  admin: { role: 'admin' },
  shipping: { role: 'staff', modules: ['shipping'] },
  both: { role: 'staff', modules: ['shipping', 'uc'] },
  uc: { role: 'staff', modules: ['uc'] },
  customer: {
    role: 'customer',
    status: 'approved',
    customer_id: 'fictional-customer'
  }
}
const original = {
  customer_id: 'fictional-customer',
  customer_name: 'FICTIONAL Invoice QA',
  currency: 'USD',
  total_amount: 1222.125,
  accounting_total: 0,
  adjustment_reason: 'Approved fictional zero',
  notes: 'Keep 中文 notes',
  source_file: { url: 'https://example.invalid/PI.pdf', name: 'Original.pdf' },
  untouched: { zero: 0, flag: false }
}
let db, env, repo, sql, handler, faults, queries
const request = async (action = 'raise', body = {}, uid = 'admin') => {
  const r = await handler(
    new Request('http://127.0.0.1/api/invoice-allocation', {
      method: 'POST',
      headers: uid ? { Authorization: 'Bearer ' + uid } : {},
      body: JSON.stringify({ action, order_id: id, ...body })
    })
  )
  return { status: r.status, body: await r.json() }
}
const expected = () => invoiceExpected(original)
const current = async () => ({
  ...(await store.doc('orders/' + id).get()).data(),
  id
})
before(
  async () => {
    db = await createInvoiceTestDatabase()
    env = await initializeTestEnvironment({
      projectId,
      firestore: { rules: await readFile('firestore.rules', 'utf8') }
    })
    for (const [uid, data] of Object.entries(profiles))
      await store.doc('users/' + uid).set(data)
  },
  { timeout: 30000 }
)
beforeEach(
  async () => {
    await store.recursiveDelete(store.collection('orders'))
    await db.reset()
    await db.pool.query(db.migration)
    faults = {}
    queries = []
    await store.doc('orders/' + id).set(original)
    await store
      .doc('orders/' + id + '/lines/existing')
      .set({ qty_ordered: 1000, unit_price: 1.222, unknown: 'preserved' })
    const raw = createInvoiceRecoveryRepository(
      store,
      () => FieldValue.serverTimestamp(),
      () => new Date('2026-11-08T12:00:00Z')
    )
    repo = new Proxy(raw, {
      get(target, key) {
        return async (...args) => {
          if (faults[key]) {
            faults[key] = false
            throw Error('FICTIONAL ' + String(key) + ' failure')
          }
          return target[key](...args)
        }
      }
    })
    sql = createInvoiceRecoverySql({
      url: 'http://127.0.0.1/fictional',
      key: 'fictional-not-a-key',
      fetchImpl: invoiceTestRest(db, faults, queries)
    })
    handler = createInvoiceRecoveryHandler({
      verifyToken: async (token) => {
        if (token === 'revoked') throw Error('revoked')
        return { uid: token, email: token + '@example.invalid' }
      },
      getProfile: async (uid) => (await store.doc('users/' + uid).get()).data(),
      repo,
      sql
    })
  },
  { timeout: 30000 }
)
after(
  async () => {
    await env?.cleanup()
    await store.terminate()
    await deleteApp(app)
    await db?.close()
  },
  { timeout: 20000 }
)
const assertOne = async () =>
  assert.deepEqual(await db.counts(), {
    invoices: 2,
    ucs: 2,
    audits: 3,
    receipts: 1
  })
const raise = () => request('raise', { expected: expected() })

test(
  'simultaneous authorized workers claim one durable request, link once, preserve full source/lines and approved zero',
  async () => {
    const replies = await Promise.all(Array.from({ length: 6 }, () => raise()))
    for (const r of replies) assert.equal(r.status, 200)
    const saved = await current()
    assert.equal(saved.erp_si_no, 'SI260100')
    assert.equal(saved.uc_no, 'UC100/26')
    assert.equal(saved.invoice_reference_revision, 2)
    assert.equal(saved.edit_revision,2)
    assert.equal((await request('status')).body.editBase.revision,2)
    for (const [key, value] of Object.entries(original))
      assert.deepEqual(saved[key], value)
    assert.deepEqual(
      (await store.doc('orders/' + id + '/lines/existing').get()).data(),
      { qty_ordered: 1000, unit_price: 1.222, unknown: 'preserved' }
    )
    assert.equal(replies.at(-1).body.operation.status, 'linked')
    await assertOne()
    const ledger = (
      await db.pool.query(
        "select * from app_sales_invoice where si_no='SI260100'"
      )
    ).rows[0]
    assert.equal(Number(ledger.accounting_total), 0)
    assert.equal(Number(ledger.total), 1222.125)
  },
  { timeout: 20000 }
)
for (const fault of ['beforeSql', 'lostSqlAck', 'result', 'link'])
  test(
    fault +
      ': reload/read-only status then resume recovers the same issued identifiers',
    async () => {
      faults[fault] = true
      const first = await raise()
      assert.ok([200, 503].includes(first.status))
      const op = (await current()).invoice_allocation_id
      assert.ok(op)
      const before = await db.counts(),
        status = await request('status')
      assert.equal(status.status, 200)
      assert.deepEqual(await db.counts(), before)
      const resumed = await request('resume')
      assert.equal(resumed.status, 200)
      assert.equal(resumed.body.operation.id, op)
      assert.equal(resumed.body.operation.status, 'linked')
      await assertOne()
      for (let i = 0; i < 2; i++)
        assert.equal((await raise()).body.operation.result.si_no, 'SI260100')
      await assertOne()
    },
    { timeout: 20000 }
  )
test(
  'changed references require explicit reviewed link; changed subject cannot be silently adopted',
  async () => {
    faults.lostSqlAck = true
    await raise()
    await store
      .doc('orders/' + id)
      .update({
        erp_si_no: 'SI260020',
        uc_no: 'UC90/26',
        invoice_reference_revision: 2
      })
    let r = await request('resume')
    assert.equal(r.body.operation.status, 'review_required')
    assert.equal(r.body.order.erp_si_no, 'SI260020')
    const operationId = r.body.operation.id
    r = await request('link_review', {
      previous_operation_id: operationId,
      reason: 'Reviewed fictional original',
      review_expected: invoiceExpected(await current())
    })
    assert.equal(r.body.operation.status, 'linked')
    await assertOne()
    // A separate frozen operation with a changed customer must stop linking.
    const old = r.body.operation.id
    faults.lostSqlAck = true
    await request('new', {
      previous_operation_id: old,
      purpose: 'split',
      reason: 'Fictional split',
      expected: invoiceExpected(await current())
    })
    await store
      .doc('orders/' + id)
      .update({ customer_name: 'Different customer' })
    r = await request('resume')
    assert.equal(r.body.operation.status, 'review_required')
    r = await request('link_review', {
      previous_operation_id: r.body.operation.id,
      reason: 'Cannot silently change buyer',
      review_expected: invoiceExpected(await current())
    })
    assert.equal(r.body.operation.status, 'review_required')
    assert.equal(r.body.order.erp_si_no, 'SI260100')
  },
  { timeout: 20000 }
)
test(
  'explicit split and reissued invoices use distinct operations while same-action retries and late workers cannot duplicate or overwrite',
  async () => {
    let r = await raise()
    const originalOperation = r.body.operation.id,
      firstInvoice = r.body.operation.result.si_no
    for (const purpose of ['split', 'reissue']) {
      const reviewed = invoiceExpected(await current()),
        previous = r.body.operation.id,
        body = {
          previous_operation_id: previous,
          purpose,
          reason: 'Fictional ' + purpose,
          expected: reviewed
        }
      const replies = await Promise.all([
        request('new', body),
        request('new', body)
      ])
      assert.equal(replies[0].status, 200)
      assert.equal(replies[1].status, 200)
      assert.equal(replies[0].body.operation.id, replies[1].body.operation.id)
      r = replies[0]
    }
    assert.equal((await db.counts()).receipts, 3)
    assert.equal((await db.counts()).invoices, 4)
    assert.equal(
      (
        await db.pool.query(
          'select count(*)::int as n from app_sales_invoice where si_no=$1',
          [firstInvoice]
        )
      ).rows[0].n,
      1
    )
    await repo.link(id, originalOperation, { uid: 'admin' }, null)
    assert.equal((await current()).erp_si_no, r.body.operation.result.si_no)
    assert.equal(
      (
        await request('manual_followups', {
          previous_operation_id: originalOperation,
          reason: 'Stale review'
        })
      ).status,
      409
    )
  },
  { timeout: 20000 }
)
test(
  'follow-up errors resume without reallocating and manual finance edits survive even a later fresh read',
  async () => {
    faults.followup = true
    let r = await raise()
    assert.equal(r.body.operation.status, 'linked')
    assert.equal(r.body.operation.followups.financial.state, 'pending')
    const no = r.body.operation.result.si_no
    await db.pool.query(
      'update app_sales_invoice set accounting_total=777,adjustment_reason=$1 where si_no=$2',
      ['Manual financial decision', no]
    )
    r = await request('resume')
    assert.equal(r.body.operation.followups.financial.state, 'pending')
    assert.match(
      r.body.operation.followups.financial.error,
      /edited separately/
    )
    assert.equal(
      Number(
        (
          await db.pool.query(
            'select accounting_total from app_sales_invoice where si_no=$1',
            [no]
          )
        ).rows[0].accounting_total
      ),
      777
    )
    assert.equal((await db.counts()).receipts, 1)
    r = await request('manual_followups', {
      previous_operation_id: r.body.operation.id,
      reason: 'Fictional reviewed manually'
    })
    assert.equal(r.body.canStartNew, true)
    assert.equal(r.body.operation.followups.financial.state, 'manual_review')
  },
  { timeout: 20000 }
)
test(
  'reused and unresolved legacy UC references remain linked without issuing another UC',
  async () => {
    await store.doc('orders/' + id).update({ erp_pi_no: 'UC90/26' })
    let r = await request('raise', {
      expected: invoiceExpected(await current())
    })
    assert.equal(r.body.operation.result.uc_no, 'UC90/26')
    assert.equal((await db.counts()).ucs, 1)
  },
  { timeout: 20000 }
)
for (const uid of [null, 'revoked', 'customer', 'uc'])
  test(
    'backend refuses ' + uid + ' before SQL or operation reads/writes',
    async () => {
      for (const action of ['raise', 'status', 'ready', 'resume'])
        assert.equal(
          (await request(action, { expected: expected() }, uid)).status,
          uid == null || uid === 'revoked' ? 401 : 403
        )
      assert.equal(queries.length, 0)
      assert.equal((await db.counts()).receipts, 0)
    }
  )
test('Shipping-only staff can read status but cannot allocate; staff with Shipping and UC can allocate', async () => {
  assert.equal((await request('status', {}, 'shipping')).status, 200)
  assert.equal(
    (await request('raise', { expected: expected() }, 'shipping')).status,
    403
  )
  assert.equal(
    (await request('raise', { expected: expected() }, 'both')).status,
    200
  )
  await assertOne()
})
test(
  'real rules exclude private child receipts from own-customer recursive access and prohibit all client allocation writes',
  async () => {
    const r = await raise(),
      operationId = r.body.operation.id
    for (const uid of ['admin', 'shipping', 'both', 'uc', 'customer']) {
      const client = env.authenticatedContext(uid).firestore(),
        read = ['admin', 'shipping', 'both'].includes(uid),
        path = doc(client, 'orders', id, 'invoice_allocations', operationId)
      await (read ? assertSucceeds : assertFails)(getDoc(path))
      await (read ? assertSucceeds : assertFails)(
        getDocs(collection(client, 'orders', id, 'invoice_allocations'))
      )
      await assertFails(setDoc(path, { status: 'linked' }))
      await assertFails(deleteDoc(path))
      await assertFails(
        updateDoc(doc(client, 'orders', id), {
          invoice_allocation_id: 'forged'
        })
      )
      if (uid === 'customer') {
        await assertSucceeds(getDoc(doc(client, 'orders', id)))
        await assertSucceeds(
          getDoc(doc(client, 'orders', id, 'lines', 'existing'))
        )
      }
      await client.terminate()
    }
  },
  { timeout: 20000 }
)
test(
  'stale legacy/modern root saves fail atomically; linked current revisions allow deliberate reference edits',
  async () => {
    await raise()
    const client = env.authenticatedContext('admin').firestore(),
      ref = doc(client, 'orders', id)
    for (const patch of [
      { erp_si_no: '', uc_no: '' },
      { erp_si_no: '', invoice_reference_revision: 1 },
      { erp_si_no: '', invoice_reference_revision: 2 },
      { invoice_reference_revision: 0 }
    ]) {
      const batch = writeBatch(client)
      batch.update(ref, { ...orderEditPatch(orderEditBase(await current()),crypto.randomUUID()), ...patch, notes: 'Must not save' })
      batch.update(doc(client, 'orders', id, 'lines', 'existing'), {
        unit_price: 0
      })
      await assertFails(batch.commit())
    }
    assert.equal((await current()).notes, original.notes)
    assert.equal(
      (await store.doc('orders/' + id + '/lines/existing').get()).data()
        .unit_price,
      1.222
    )
    await assertSucceeds(
      updateDoc(ref, {
        ...orderEditPatch(orderEditBase(await current()),crypto.randomUUID()),
        erp_si_no: 'SI260020',
        invoice_reference_revision: 3,
        notes: 'Deliberate linked correction'
      })
    )
    await assertSucceeds(updateDoc(ref, { ...orderEditPatch(orderEditBase(await current()),crypto.randomUUID()), notes: 'Ordinary save' }))
    await client.terminate()
  },
  { timeout: 20000 }
)
test(
  'pending references/deletion cannot be changed by clients; legacy orders keep ordinary write behavior',
  async () => {
    faults.beforeSql = true
    await raise()
    const client = env.authenticatedContext('admin').firestore(),
      ref = doc(client, 'orders', id)
    await assertFails(
      updateDoc(ref, { erp_si_no: 'SI260099', invoice_reference_revision: 2 })
    )
    await assertFails(deleteDoc(ref))
    await assertSucceeds(
      updateDoc(ref, { ...orderEditPatch(orderEditBase(await current()),crypto.randomUUID()), notes: 'Commercial note while pending' })
    )
    await assertSucceeds(
      setDoc(doc(client, 'orders', 'legacy-order'), { erp_si_no: 'SI260020' })
    )
    await assertSucceeds(
      updateDoc(doc(client, 'orders', 'legacy-order'), {
        edit_revision:1,last_edit_id:'legacy-first-edit',
        erp_si_no: 'SI260021'
      })
    )
    await assertFails(
      setDoc(doc(client, 'orders', 'fake-order'), {
        invoice_allocation_id: 'forged',
        invoice_reference_revision: 1
      })
    )
    await client.terminate()
  },
  { timeout: 20000 }
)

for (const total of [null, '', 0, 1.222])
  test(
    'actual Woo follow-up uses known checkout amounts without rounding or guessing ' +
      JSON.stringify(total),
    async () => {
      await store
        .doc('orders/' + id)
        .update({
          channel: 'woocommerce',
          total_amount: total,
          accounting_total: total,
          adjustment_reason: '',
          woo_order_no: 'WOO-FICTIONAL',
          woo_fee: 0,
          woo_net_payout_hkd: 0,
          woo_payout_date: '2026-11-08'
        })
      const r = await request('raise', {
        expected: invoiceExpected(await current())
      })
      assert.equal(r.status, 200)
      assert.equal(r.body.operation.status, 'linked')
      const uc = (
        await db.pool.query(
          'select to_jsonb(u) as value from uc_registry u where id=$1',
          [r.body.operation.result.uc_id]
        )
      ).rows[0].value
      if (typeof total === 'number') {
        assert.equal(uc.total, total)
        assert.equal(uc.deposit, total)
        assert.equal(uc.balance, 0)
        assert.equal(uc.bal_pay_date, '2026-11-08')
        assert.equal(r.body.operation.followups.woo.state, 'done')
        assert.match(uc.remarks, /HKD 0.00/)
      } else {
        assert.equal(uc.total, null)
        assert.equal(r.body.operation.followups.woo.state, 'pending')
        assert.match(r.body.operation.followups.woo.error, /unknown/)
      }
      assert.equal((await db.counts()).receipts, 1)
    },
    { timeout: 20000 }
  )
test(
  'follow-up commit with lost response recovers without extra audit, invoice or UC rows',
  async () => {
    faults.lostFollowupAck = true
    let r = await raise()
    assert.equal(r.body.operation.followups.financial.state, 'pending')
    const counts = await db.counts()
    r = await request('resume')
    assert.equal(r.body.operation.followups.financial.state, 'done')
    assert.deepEqual(await db.counts(), counts)
    await assertOne()
  },
  { timeout: 20000 }
)
test(
  'a legacy invoice in SO permits an explicit reissue and retains the old SI/UC ledger rows',
  async () => {
    await store
      .doc('orders/' + id)
      .update({ erp_so_no: 'SI260020', uc_no: 'UC90/26' })
    assert.equal(
      (await request('raise', { expected: invoiceExpected(await current()) }))
        .status,
      409
    )
    const r = await request('new', {
      previous_operation_id: null,
      purpose: 'reissue',
      reason: 'Reviewed fictional legacy reissue',
      expected: invoiceExpected(await current())
    })
    assert.equal(r.status, 200)
    assert.equal(r.body.operation.status, 'linked')
    assert.equal(r.body.order.erp_so_no, 'SI260020')
    assert.equal((await db.counts()).ucs, 1)
    assert.equal(
      (
        await db.pool.query(
          "select total::text from app_sales_invoice where si_no='SI260020'"
        )
      ).rows[0].total,
      '12.345'
    )
  },
  { timeout: 20000 }
)
