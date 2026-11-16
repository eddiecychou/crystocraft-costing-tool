import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { createInvoiceFollowupListHandler, readInvoiceFollowupPage } from '../netlify/functions/lib/invoiceFollowupList.js'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Use fictional Firestore emulator only')
const app = initializeApp({ projectId: 'demo-invoice-followup-list' }, 'invoice-followup-list-qa')
const store = getFirestore(app)
const repo = createInvoiceRecoveryRepository(store, FieldValue.serverTimestamp)
const now = Date.now()
const operationId = n => '12345678-1234-4123-8123-' + n.toString(16).padStart(12, '0')
const orderA = 'b-fictional-splits', orderB = 'c-fictional-older'
const profiles = { admin: { role: 'admin' }, shipping: { role: 'staff', modules: ['shipping'] },
  manager: { role: 'staff', modules: ['shipping', 'uc'] }, finance: { role: 'staff', modules: ['invoices'] },
  customer: { role: 'customer', status: 'approved' } }
const auth = { verifyToken: async token => {
  if (token === 'revoked') throw Error('Revoked session')
  return { uid: token }
}, getProfile: async uid => (await store.doc('users/' + uid).get()).data() }
const order = (id, current, extra) => ({
  invoice_allocation_id: current.id, erp_si_no: current.result.si_no, uc_no: current.result.uc_no,
  erp_so_no: 'SO260050', customer_name: 'Fictional Split Buyer', currency: 'USD', ...extra
})
const receipt = (parent, n, purpose, state = 'pending') => ({
  id: operationId(n), order_id: parent, status: 'linked', created_at: new Date('2025-03-17'),
  request: { customer: 'Fictional Split Buyer', currency: 'USD', purpose, actor_uid: 'fictional-secret-actor' },
  followups: { financial: { state, error: 'FICTIONAL private accounting error' }, woo: { state: 'not_applicable' } },
  result: { si_no: 'SI' + String(260100 + n), uc_no: 'UC' + n + '/26', invoice_id: n },
})
const ref = (parent, id) => store.doc(`orders/${parent}/invoice_allocations/${id}`)
const split = receipt(orderA, 40, 'split'), reissue = receipt(orderA, 41, 'reissue')
const old = receipt(orderB, 65535, 'split'), oldCurrent = receipt(orderB, 2000, 'reissue', 'done')
const list = async ({ uid = 'shipping', cursor, method = 'GET', readPage } = {}) => {
  const endpoint = new URL('http://127.0.0.1/api/invoice-followups')
  if (cursor !== undefined) endpoint.searchParams.set('cursor', cursor)
  const handler = createInvoiceFollowupListHandler({ ...auth,
    readPage: readPage || (after => readInvoiceFollowupPage(store, after, 2)) })
  return handler(new Request(endpoint, { method, headers: uid ? { Authorization: 'Bearer ' + uid } : {} }))
}
const status = async (parent, target, action = 'status') => {
  const handler = createInvoiceRecoveryHandler({ ...auth, repo, sql: new Proxy({}, {
    get: () => () => assert.fail('No SQL calls during a linked follow-up read')
  }) })
  return handler(new Request('http://127.0.0.1/api/invoice-allocation', { method: 'POST',
    headers: { Authorization: 'Bearer manager' }, body: JSON.stringify({ action, order_id: parent,
      ...(target === undefined ? {} : { followup_id: target }) }) }))
}

before(async () => {
  const batch = store.batch()
  for (const [uid, profile] of Object.entries(profiles)) batch.set(store.doc('users/' + uid), profile)
  batch.set(store.doc('orders/' + orderA), order(orderA, reissue))
  batch.set(store.doc('orders/' + orderB), order(orderB, oldCurrent, { shipping_closed: true }))
  for (const n of [1, 2]) batch.set(ref('a-settled', operationId(n)), receipt('a-settled', n, 'first', 'done'))
  for (const [parent, item] of [[orderA, split], [orderA, reissue], [orderB, oldCurrent], [orderB, old]]) {
    batch.set(ref(parent, item.id), item)
  }
  batch.set(store.doc(`invoice_followup_jobs/${reissue.id}_financial`),
    { order_id: orderA, operation_id: reissue.id, stage: 'financial', lease_until: now + 900000 })
  batch.set(ref(orderA, operationId(99)), { ...receipt(orderA, 99, 'first'), order_id: 'wrong-owner' })
  batch.set(ref('d-missing', operationId(101)), receipt('d-missing', 101, 'first'))
  batch.set(store.doc(`unrelated/fixture/invoice_allocations/${operationId(102)}`), receipt('fixture', 102, 'first'))
  await batch.commit()
})
after(async () => {
  // Clean up only this isolated demo project so the fixture is rerunnable.
  for (const collection of ['orders', 'users', 'invoice_followup_jobs', 'unrelated']) {
    await store.recursiveDelete(store.collection(collection))
  }
  await store.terminate()
  await deleteApp(app)
})

test('bounded pages discover the exact split and reissue, an older closed-order follow-up and detached records', async () => {
  const { docs } = await store.collectionGroup('invoice_allocations').orderBy(FieldPath.documentId()).get()
  const before = docs.map(doc => doc.updateTime.toMillis())
  let response = await list()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /private, no-store/)
  let page = await response.json()
  assert.deepEqual(page.rows, [])
  assert.ok(page.next)
  const rows = [], cursors = new Set()
  while (page.next) {
    assert.ok(!cursors.has(page.next))
    cursors.add(page.next)
    response = await list({ cursor: page.next })
    assert.equal(response.status, 200)
    page = await response.json()
    rows.push(...page.rows)
  }
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.filter(row => row.si).map(row => [row.orderId, row.operationId, row.si, row.disposition]),
    [[orderA, split.id, split.result.si_no, 'finance_review'], [orderA, reissue.id, reissue.result.si_no, 'in_progress'],
     [orderB, old.id, old.result.si_no, 'finance_review']])
  assert.deepEqual(rows.filter(row => row.issue).map(row => [row.orderId, row.issue, row.si, row.uc]),
    [[orderA, 'receipt_conflict', undefined, undefined], ['d-missing', 'order_unavailable', undefined, undefined]])
  assert.doesNotMatch(JSON.stringify(rows), /actor_uid|private accounting error|invoice_id/)
  const after = await store.collectionGroup('invoice_allocations').orderBy(FieldPath.documentId()).get()
  assert.deepEqual(after.docs.map(doc => doc.updateTime.toMillis()), before)
})

test('the order resolves only its exact selected receipt beyond the checklist cap and after settlement', async () => {
  const writes = store.bulkWriter()
  for (let n = 3000; n < 3500; n++) writes.set(ref(orderB, operationId(n)), receipt(orderB, n, 'split', 'done'))
  await writes.close()
  const ordinary = await (await status(orderB)).json()
  assert.equal(ordinary.followupChecklist.incomplete, true)
  assert.ok(!ordinary.followupChecklist.entries.some(row => row.id === old.id))
  const exact = await (await status(orderB, old.id)).json()
  assert.equal(exact.focusedFollowupId, old.id)
  assert.deepEqual(exact.followupChecklist.entries.map(row => [row.id, row.result.si_no]), [[old.id, old.result.si_no]])
  assert.equal(exact.operation.id, oldCurrent.id)
  const wrongOrder = await (await status(orderA, old.id)).json()
  assert.ok(!wrongOrder.followupChecklist.entries.some(row => row.id === old.id))
  assert.equal((await status(orderA, split.id, 'resume')).status, 400)
  await ref(orderB, old.id).update({ 'followups.financial.state': 'manual_review' })
  const settled = await (await status(orderB, old.id)).json()
  assert.equal(settled.focusedFollowupId, old.id)
  assert.deepEqual(settled.followupChecklist.entries, [])
  assert.equal(settled.operation.id, oldCurrent.id)
})

test('access is checked before reading and a failed page is retryable', async () => {
  let reads = 0
  const readPage = async () => { reads++; throw Error('Private fixture error') }
  for (const [uid, method, expected] of [[null,'GET',401], ['revoked','GET',401], ['finance','GET',403],
    ['customer','GET',403], ['shipping','POST',405], ['admin','GET',503], ['manager','GET',503]]) {
    const response = await list({ uid, method, readPage })
    assert.equal(response.status, expected)
    assert.doesNotMatch(await response.text(), /Private fixture error/)
  }
  assert.equal((await list({ cursor:'invalid-cursor', readPage })).status, 400)
  assert.equal(reads, 2)
})
