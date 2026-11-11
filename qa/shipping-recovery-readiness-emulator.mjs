// Acceptance cases for the two release-readiness findings; fictional writes only.
import assert from 'node:assert/strict'
import { test, before, beforeEach, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createInvoiceTestDatabase } from './invoice-recovery-postgres-fixture.mjs'
import { directInvoiceFixture } from './direct-invoice-fixture.mjs'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { createOrderRequests } from '../netlify/functions/lib/orderCreateRequests.js'
import { invoiceFollowupsDone } from '../src/invoiceRecoveryModel.js'
import { needsInitialInvoice } from '../src/orderCreateRequestModel.js'

assert.equal(process.env.GCLOUD_PROJECT, 'demo-sh07-manual')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'readiness-acceptance')
const db = getFirestore(app)
const draft = {
  order: { customer_id: 'fictional', customer_name: 'Fictional readiness buyer', currency: 'GBP', deposit_paid: 100, accounting_total: 1200, adjustment_reason: 'Fictional approved adjustment', customer_po: 'FIC-PO-READINESS', notes: 'Fictional invoice remarks' },
  lines: [{ item_code: 'FIC-READINESS', description: 'Fictional item', qty_ordered: 1000, unit_price: 1.222, unit: 'pcs' }]
}
const orderHandler = orderRequestHandler({
  verifyToken: async (uid) => ({ uid }),
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo: createOrderRequests(db, () => { throw Error('No PI upload in Direct Invoice fixture') })
})
let sqlDb, invoices, faults
const evidence = []
before(async () => { sqlDb = await createInvoiceTestDatabase() })
beforeEach(async () => {
  await db.recursiveDelete(db.collection('orders'))
  await db.recursiveDelete(db.collection('shipping_create_operators'))
  await db.doc('users/reviewer').set({ role: 'staff', modules: ['shipping', 'uc'] })
  await sqlDb.reset()
  await sqlDb.pool.query(sqlDb.migration)
  faults = {}
  invoices = directInvoiceFixture(db, sqlDb, faults)
})
after(async () => {
  await mkdir('qa/out/sh07-release-20261112', { recursive: true })
  await writeFile('qa/out/sh07-release-20261112/followup-acceptance.json', JSON.stringify(evidence, null, 2) + '\n')
  await sqlDb?.close()
  await db.terminate()
  await deleteApp(app)
})
async function api(handler, body) {
  const response = await handler(new Request('http://localhost/api/fictional', {
    method: 'POST', headers: { authorization: 'Bearer reviewer' }, body: JSON.stringify(body)
  }))
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

for (const fault of ['followup', 'lostFollowupAck']) {
  test('SH07-R1: initial retry finishes financial follow-up after ' + fault, async () => {
    const id = randomUUID()
    const request = (action, fields = {}) => api(orderHandler, { id, operator: 'reviewer', action, ...fields })
    await request('prepare', { ...draft, mode: 'direct' })
    const saved = await request('commit')
    const issue = () => api(invoices.handler, { action: 'initial_direct', order_id: saved.order_id, request_id: id })
    faults[fault] = true
    const first = await issue()
    assert.equal(first.operation.status, 'linked')
    assert.equal(first.operation.followups.financial.state, 'pending')
    const status = await request('status')
    assert.equal(status.invoice.state, 'followups_pending')
    assert.ok(needsInitialInvoice(status.invoice.state))
    assert.match(status.invoice.message, /pending accounting updates/)
    const listed = await request('list')
    assert.equal(listed.requests[0].invoice.state, 'followups_pending')
    const retry = (await Promise.all([issue(), issue()]))[0]
    assert.equal(retry.operation.id, first.operation.id)
    const afterRetry = await invoices.repo.operation(saved.order_id, first.operation.id)
    assert.ok(invoiceFollowupsDone(afterRetry))
    assert.equal((await request('status')).invoice.state, 'issued')
    const ledger = async () => (await sqlDb.pool.query(
      'select si_no,uc_no,total,accounting_total,customer_po,remarks from app_sales_invoice where order_id=$1', [saved.order_id]
    )).rows
    const beforeResume = await ledger()
    // The existing saved-order Resume remains idempotent after initial recovery.
    const resumed = await api(invoices.handler, { action: 'resume', order_id: saved.order_id })
    assert.equal(resumed.operation.id, first.operation.id)
    assert.ok(invoiceFollowupsDone(resumed.operation))
    const afterResume = await ledger()
    const counts = await sqlDb.counts()
    assert.equal((await db.collection('orders').get()).size, 1)
    assert.equal(counts.invoices, 2, 'One fictional pre-existing invoice plus this sale')
    assert.equal(counts.receipts, 1)
    assert.equal(counts.ucs, 2, 'One fictional pre-existing UC plus this sale')
    assert.equal(beforeResume.length, 1)
    assert.equal(afterResume.length, 1)
    assert.equal(beforeResume[0].si_no, afterResume[0].si_no)
    assert.equal(Number(afterResume[0].total), 1222)
    assert.equal(Number(afterResume[0].accounting_total), 1200)
    assert.equal(afterResume[0].customer_po, 'FIC-PO-READINESS')
    assert.equal(afterResume[0].remarks, 'Fictional invoice remarks')
    assert.equal((await db.doc('orders/' + saved.order_id).get()).get('deposit_paid'), 100)
    evidence.push({
      finding: 'SH07-R1', fault, requestState: status.invoice.state,
      offersFinish: needsInitialInvoice(status.invoice.state), retry,
      followupAfterRetry: afterRetry.followups.financial.state,
      beforeResume, afterResume, invoiceOperationCount: counts.receipts,
      savedOrderResume: 'Idempotent; same completed operation and SI'
    })
    assert.ok(invoiceFollowupsDone(afterRetry), 'Initial Direct Invoice retry must finish pending accounting work')
  })
}

for (const changed of ['erp_si_no', 'uc_no', 'customer_name', 'invoice_allocation_id']) {
  test('unfinished first invoice requires review after changed ' + changed, async () => {
    const id = randomUUID()
    const request = (action, fields = {}) => api(orderHandler, { id, operator: 'reviewer', action, ...fields })
    await request('prepare', { ...draft, mode: 'direct' })
    const saved = await request('commit')
    faults.followup = true
    const input = { action: 'initial_direct', order_id: saved.order_id, request_id: id }
    const first = await api(invoices.handler, input)
    const root = db.doc('orders/' + saved.order_id)
    const changedValue = changed === 'invoice_allocation_id' ? randomUUID() : 'Fictional changed ' + changed
    await root.update({ [changed]: changedValue })
    const counts = await sqlDb.counts()
    assert.equal((await request('status')).invoice.state, 'review')
    const response = await invoices.handler(new Request('http://localhost/api/fictional', {
      method: 'POST', headers: { authorization: 'Bearer reviewer' }, body: JSON.stringify(input)
    }))
    assert.equal(response.status, 409)
    assert.deepEqual(await sqlDb.counts(), counts)
    assert.equal((await root.get()).get(changed), changedValue)
    assert.equal((await invoices.repo.operation(saved.order_id, first.operation.id)).followups.financial.state, 'pending')
  })
}
