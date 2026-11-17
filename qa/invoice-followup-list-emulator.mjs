import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { createInvoiceFollowupListHandler, readAwaitingInvoiceLinkPage, readInvoiceFollowupPage } from '../netlify/functions/lib/invoiceFollowupList.js'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { invoiceReferenceValues } from '../src/invoiceRecoveryModel.js'

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

test('awaiting links verify the exact first, split and reissued request without writing or leaking receipt data', async () => {
  const batch = store.batch(), fixtures = new Map()
  for (const [i, purpose, issue] of [
    [1, 'first'], [2, 'split'], [3, 'reissue'], [4, 'first', 'no_receipt'],
    [5, 'split', 'receipt_conflict'], [6, 'reissue', 'order_unavailable'],
    [7, 'first', 'order_closed'], [8, 'split', 'request_not_current'],
    [9, 'reissue', 'references_changed'], [10, 'first', 'customer_changed'],
  ]) {
    const id = 'e-awaiting-' + String(i).padStart(2, '0')
    const op = receipt(id, 1000 + i, purpose)
    op.status = purpose === 'split' ? 'pending' : 'allocated'
    op.followups.financial.state = 'done'
    op.request = { ...op.request, order_id: id, invoiced_at: '2025-03-17' }
    const frozen = {
      ...order(id, op), erp_si_no: '', uc_no: '', customer_id: 'fictional-buyer',
    }
    op.before = { refs: invoiceReferenceValues(frozen), customerId: frozen.customer_id }
    const sqlReceipt = {
      operation_id: op.id, order_id: id, request_json: op.request,
      o_si_no: op.result.si_no, o_uc_no: op.result.uc_no, o_invoice_id: op.result.invoice_id, o_uc_id: null,
    }
    op.result = op.status === 'pending' || issue === 'no_receipt' ? null : { ...op.result, uc_id: null }
    batch.set(ref(id, op.id), op)
    if (issue !== 'order_unavailable') batch.set(store.doc('orders/' + id), {
      ...frozen,
      ...(issue === 'order_closed' ? { shipping_closed: true } : {}),
      ...(issue === 'request_not_current' ? { invoice_allocation_id: operationId(5000) } : {}),
      ...(issue === 'references_changed' ? { erp_pi_no: 'PI-CHANGED' } : {}),
      ...(issue === 'customer_changed' ? { customer_id: 'same-name-other-buyer' } : {}),
    })
    fixtures.set(op.id, { id, op, issue, sqlReceipt: issue === 'no_receipt' ? null :
      issue === 'receipt_conflict' ? { ...sqlReceipt, order_id: 'different-order' } : sqlReceipt })
  }
  await batch.commit()
  const snapshot = async () => (await Promise.all([
    store.collection('orders').get(), store.collectionGroup('invoice_allocations').get(),
    store.collection('invoice_followup_jobs').get(),
  ])).flatMap(({ docs }) => docs.map(doc => [doc.ref.path, doc.updateTime.toMillis()]))
  const before = await snapshot()
  let reads = 0, unavailable = false
  const lookup = async id => {
    reads++
    if (unavailable) throw Error('Fictional private SQL error')
    assert.ok(fixtures.has(id))
    return fixtures.get(id).sqlReceipt
  }
  const handler = createInvoiceFollowupListHandler({ ...auth,
    readPage: () => assert.fail('Expected awaiting-link view'),
    readAwaitingLinkPage: after => readAwaitingInvoiceLinkPage(store, lookup, after, 50, 2),
  })
  const read = (who, cursor) => {
    const url = new URL('http://127.0.0.1/api/invoice-followups?view=awaiting_link')
    if (cursor) url.searchParams.set('cursor', cursor)
    return handler(new Request(url, { headers: who ? { Authorization: 'Bearer ' + who } : {} }))
  }
  for (const [who, code] of [[null,401], ['revoked',401], ['finance',403], ['customer',403]]) {
    assert.equal((await read(who)).status, code)
  }
  assert.equal(reads, 0)
  const rows = []
  let cursor, failedPage = false
  do {
    const count = reads
    const response = await read('shipping', cursor)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /private, no-store/)
    const page = await response.json()
    assert.ok(reads - count <= 2)
    if (reads > count && !failedPage) {
      unavailable = true
      const failed = await read('shipping', cursor)
      assert.equal(failed.status, 503)
      assert.match(await failed.text(), /receipt source.*unavailable/)
      unavailable = false
      assert.deepEqual(await (await read('shipping', cursor)).json(), page)
      failedPage = true
    }
    rows.push(...page.rows)
    assert.ok(!page.next || page.next !== cursor)
    cursor = page.next
  } while (cursor)
  assert.equal(failedPage, true)
  assert.equal(rows.length, 9)
  assert.equal(new Set(rows.map(row => row.operationId)).size, 9)
  for (const row of rows) {
    const { id, op, issue, sqlReceipt } = fixtures.get(row.operationId)
    assert.equal(row.orderId, id)
    if (['receipt_conflict','order_unavailable','order_closed','request_not_current'].includes(issue)) {
      assert.deepEqual(row, { operationId: op.id, orderId: id, issue })
    } else {
      assert.equal(row.si, sqlReceipt.o_si_no)
      assert.equal(row.uc, sqlReceipt.o_uc_no)
      assert.equal(row.purpose, op.request.purpose)
      assert.equal(row.disposition, issue ? 'finance_review' : 'resume')
    }
  }
  assert.deepEqual(rows.filter(row => row.disposition === 'resume').map(row => row.purpose), ['first','split','reissue'])
  assert.doesNotMatch(JSON.stringify(rows), /actor_uid|private accounting error|invoice_id|customer_id|request_json/)

  const split = fixtures.get(operationId(1002))
  const verifiedReceipt = split.sqlReceipt
  let allocations = 0
  const recovery = createInvoiceRecoveryHandler({ ...auth, repo, sql: {
    lookup, allocate: () => { allocations++; throw Error('Pinned links cannot allocate') },
  } })
  const action = (action, orderId, id) => recovery(new Request('http://127.0.0.1/api/invoice-allocation', {
    method: 'POST', headers: { Authorization: 'Bearer manager' }, body: JSON.stringify({
      action, order_id: orderId, invoice_request_id: id, ...(action === 'resume' ? { previous_operation_id: id } : {}),
    }),
  }))
  const exact = await (await action('status', split.id, split.op.id)).json()
  assert.equal(exact.focusedInvoiceRequestId, split.op.id)
  assert.equal(exact.operation.receiptStatus, 'verified')
  assert.equal(exact.operation.result.si_no, split.sqlReceipt.o_si_no)
  const count = reads
  const stale = await (await action('status', split.id, operationId(1003))).json()
  assert.equal(stale.focusedInvoiceRequestId, operationId(1003))
  assert.equal(stale.operation.receiptStatus, null)
  assert.equal(reads, count)
  assert.equal((await action('resume', split.id, operationId(1003))).status, 409)
  assert.equal((await action('raise', split.id, split.op.id)).status, 400)
  split.sqlReceipt = null // Simulate receipt loss between the first read and the click.
  assert.equal((await action('resume', split.id, split.op.id)).status, 409)
  assert.equal(allocations, 0)
  assert.deepEqual(await snapshot(), before)

  split.sqlReceipt = verifiedReceipt
  assert.equal((await action('resume', split.id, split.op.id)).status, 200)
  const linked = await (await action('status', split.id, split.op.id)).json()
  assert.equal(linked.operation.status, 'linked')
  assert.equal(linked.operation.result.si_no, verifiedReceipt.o_si_no)
  assert.equal((await store.doc('orders/' + split.id).get()).data().uc_no, verifiedReceipt.o_uc_no)
  const afterLink = await snapshot()
  assert.equal((await action('resume', split.id, split.op.id)).status, 200)
  assert.deepEqual(await snapshot(), afterLink)
  assert.equal(allocations, 0)
})
