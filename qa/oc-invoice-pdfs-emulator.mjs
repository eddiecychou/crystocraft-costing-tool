// Private PDF pilot with fictional data, real Admin SDK storage and client rules.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { createElement as h } from 'react'
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, getDownloadURL, uploadBytes } from 'firebase/storage'
import { createOcInvoiceSummariesHandler, loadOcInvoiceSources } from '../netlify/functions/lib/ocInvoiceSummaries.js'
import { createOcInvoicePdfArchive } from '../netlify/functions/lib/ocInvoicePdfs.js'

for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  assert.match(process.env[key] || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local emulators required')
}
const projectId = 'crystocraft-rbac-test'
const bucketName = `${projectId}.appspot.com`
const app = initializeApp({ projectId, storageBucket: bucketName }, 'invoice-pdf-pilot')
const db = getFirestore(app)
const bucket = getStorage(app).bucket()
const issuer = 'fictional-issuer'
const archive = createOcInvoicePdfArchive(db, () => bucket, issuer)
const first = 'SI269001', split = 'SI269002', reissued = 'SI269003', legacy = 'SI009007'
const missing = 'SI269004', unapproved = 'SI269005', pending = 'SI269006'
const orderId = 'fixture-oc-pdf-order'
const dates = '2026-11-12'
const base = { invoice_date: dates, customer: 'Fictional Invoice Buyer', currency: 'USD', total: 250, accounting_total: 240 }
const numbers = [first, split, reissued, missing, unapproved, pending]
const ledger = numbers.map((si_no, i) => ({ ...base, id: i + 800, si_no, order_id: orderId, status: i ? 'issued' : 'void' }))
const roles = {
  pdf_admin: { role: 'admin' }, pdf_staff: { role: 'staff', modules: ['invoices'] },
  pdf_shipping: { role: 'staff', modules: ['shipping'] },
  pdf_customer: { role: 'customer', status: 'approved', modules: ['invoices'] },
}
const profiles = uid => db.doc('users/' + uid)
const approvals = no => db.doc('oc_invoice_originals/' + no)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const pdfs = new Map()
const fixtures = new Map()
const params = { verifyToken: async uid => ({ uid }), getProfile: async uid => (await profiles(uid).get()).data(),
  load: () => loadOcInvoiceSources(db, async () => ledger) }
const handler = createOcInvoiceSummariesHandler({ ...params, archive })
const request = (query = '', { uid = 'pdf_staff', method = 'GET', ifMatch } = {}) => new Request(
  `http://127.0.0.1/api/oc-invoice-summaries${query}`, { method,
    headers: { ...(uid ? { Authorization: `Bearer ${uid}` } : {}), ...(ifMatch ? { 'If-Match': ifMatch } : {}) } })
const bytesOf = async response => Buffer.from(await response.arrayBuffer())
const pdfRequest = no => request(`?pdf=${no}`)
let env

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') } })
  await Promise.all(Object.entries(roles).map(([uid, profile]) => profiles(uid).set(profile)))
  const order = db.doc('orders/' + orderId)
  await order.set({ status: 'confirmed', erp_si_no: reissued, invoice_allocation_id: 'latest' })
  await Promise.all(ledger.map(({ si_no, id }) => order.collection('invoice_allocations').doc(si_no).set({
    status: si_no === pending ? 'issued' : 'linked', order_id: orderId, result: { si_no, invoice_id: id },
  })))
  await db.doc('orders/fixture-oc-pdf-legacy').set({ status: 'delivered', erp_so_no: legacy,
    invoice_date: dates, customer_name: base.customer, currency: base.currency, total_amount: 0 })
  for (const no of [first, split, reissued, legacy, unapproved]) {
    const bytes = await renderToBuffer(h(Document, null, h(Page, null, h(Text, null, `FICTIONAL INVOICE ${no}`))))
    pdfs.set(no, bytes)
    const sha256 = digest(bytes)
    const file = bucket.file(`oc-invoice-originals/${no}/${sha256}.pdf`)
    await file.save(bytes, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' } })
    const [meta] = await file.getMetadata()
    const id = ledger.find(row => row.si_no === no)?.id
    const record = { status: no === unapproved ? 'staged' : 'approved', source: 'OC', issuer, invoiceNo: no,
      recordKey: no === legacy ? 'legacy-order:fixture-oc-pdf-legacy' : `ledger:${id}:${orderId}`,
      date: dates, customer: base.customer, currency: base.currency,
      amount: no === legacy ? 0 : 250, payable: no === legacy ? 0 : 240,
      reviewedBy: 'fictional-finance', reviewedAt: '2026-11-16T00:00:00Z', provenance: 'Fictional sent attachment',
      filename: `發票 ${no}.pdf`, byteSize: bytes.length, generation: String(meta.generation), sha256 }
    assert.ok(!meta.metadata?.firebaseStorageDownloadTokens)
    fixtures.set(no, record)
    await approvals(no).set(record)
  }
})

after(async () => {
  try {
    if (env) await Promise.all([
      db.recursiveDelete(db.doc('orders/' + orderId)), db.doc('orders/fixture-oc-pdf-legacy').delete(),
      ...Object.keys(roles).map(uid => profiles(uid).delete()),
      ...[...pdfs].flatMap(([no, bytes]) => [approvals(no).delete(),
        bucket.file(`oc-invoice-originals/${no}/${digest(bytes)}.pdf`).delete({ ignoreNotFound: true })]),
    ])
  } finally {
    await env?.cleanup()
    await db.terminate()
    await deleteApp(app)
  }
})

test('summary and exact binary reads distinguish split, voided, reissued and legacy invoices', async () => {
  const summary = await handler(request())
  assert.equal(summary.status, 200)
  const { rows } = await summary.json()
  const byNo = Object.fromEntries(rows.map(row => [row.no, row]))
  assert.equal(byNo[first].status, 'VOID')
  assert.equal(byNo[legacy].amount, 0)
  assert.equal(byNo[missing].documentStatus, 'Original unavailable')
  assert.equal(byNo[unapproved].documentStatus, 'Original unavailable')
  assert.ok(!byNo[pending])
  for (const no of [first, split, reissued, legacy]) {
    assert.equal(byNo[no].documentStatus, 'Verified original PDF')
    assert.deepEqual(Object.keys(byNo[no]).sort(), ['amount','currency','customer','date','documentStatus','no','source','status'])
    const response = await handler(pdfRequest(no))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/pdf')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store')
    assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''%E7%99%BC/)
    assert.deepEqual(await bytesOf(response), pdfs.get(no))
  }
  for (const no of [missing, pending, unapproved]) assert.equal((await handler(pdfRequest(no))).status, 404)
  assert.notDeepEqual(pdfs.get(first), pdfs.get(split))
  assert.notDeepEqual(pdfs.get(split), pdfs.get(reissued))
})

test('PDF access uses current roles and rejects client attempts to write or browse other sources', async () => {
  assert.equal((await handler(request(`?pdf=${split}`, { uid: null }))).status, 401)
  assert.equal((await handler(request(`?pdf=${split}`, { uid: 'pdf_admin' }))).status, 200)
  for (const uid of ['pdf_customer', 'pdf_shipping']) {
    assert.equal((await handler(request(`?pdf=${split}`, { uid }))).status, 403)
  }
  assert.equal((await handler(request(`?pdf=${split}`, { method: 'POST' }))).status, 405)
  for (const query of [`?pdf=${split}&source=JES`, `?pdf=${split}&pdf=${first}`, '?pdf=../bad']) {
    assert.equal((await handler(request(query))).status, 400)
  }
  await profiles('pdf_staff').set(roles.pdf_shipping)
  try { assert.equal((await handler(pdfRequest(split))).status, 403) }
  finally { await profiles('pdf_staff').set(roles.pdf_staff) }
})

test('raw metadata reads, upload and tokenless storage access are denied for every client role', async () => {
  const path = `oc-invoice-originals/${split}/${fixtures.get(split).sha256}.pdf`
  for (const uid of [...Object.keys(roles), null]) {
    const context = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()
    const record = doc(context.firestore(), 'oc_invoice_originals', split)
    const object = ref(context.storage(`gs://${bucketName}`), path)
    await assertFails(getDoc(record))
    await assertFails(setDoc(record, { status: 'approved' }))
    await assertFails(getDownloadURL(object))
    await assertFails(uploadBytes(object, pdfs.get(split)))
  }
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media`
  assert.equal((await fetch(url)).status, 403)
})

test('withdrawal, identity conflicts, stale file version and storage failure withhold PDF bytes', async () => {
  const original = fixtures.get(split)
  const opened = await handler(pdfRequest(split))
  assert.equal(opened.status, 200)
  assert.equal((await handler(request(`?pdf=${split}`, { ifMatch: opened.headers.get('etag') }))).status, 200)
  assert.equal((await handler(request(`?pdf=${split}`, { ifMatch: '"stale"' }))).status, 409)
  const changes = [{ status: 'withdrawn' }, { source: 'JES' }, { issuer: 'other-issuer' }, { payable: 250 },
    { recordKey: fixtures.get(reissued).recordKey }, { generation: '1' }, { sha256: '0'.repeat(64) }]
  try {
    for (const [index, change] of changes.entries()) {
      await approvals(split).set({ ...original, ...change })
      const response = await handler(pdfRequest(split))
      const expected = index === 5 ? [404, 409] : [index === 0 || index === 6 ? 404 : 409]
      assert.ok(expected.includes(response.status), `${JSON.stringify(change)} returned ${response.status}`)
      assert.equal(response.headers.get('content-type'), 'application/json')
    }
  } finally { await approvals(split).set(original) }
  const outage = createOcInvoiceSummariesHandler({ ...params, archive: { ...archive,
    read: async () => { throw Error('Storage offline') }, list: async () => { throw Error('Archive offline') },
  } })
  assert.equal((await outage(pdfRequest(split))).status, 503)
  const summary = await outage(request())
  assert.equal(summary.status, 200)
  assert.ok((await summary.json()).rows.every(row => row.documentStatus === 'Original archive temporarily unavailable'))
  const disabled = createOcInvoiceSummariesHandler(params)
  assert.equal((await disabled(pdfRequest(split))).status, 404)
  assert.ok((await (await disabled(request())).json()).rows.every(row => row.documentStatus === 'Original unavailable'))
})

test('withdrawal and role revocation while reading bytes are checked before responding', async () => {
  const original = fixtures.get(split)
  try {
    const changed = action => createOcInvoiceSummariesHandler({ ...params, archive: { ...archive,
      read: async record => { const bytes = await archive.read(record); await action(); return bytes },
    } })
    const withdraw = changed(() => approvals(split).update({ status: 'withdrawn' }))
    assert.equal((await withdraw(pdfRequest(split))).status, 404)
    await approvals(split).set(original)
    const revoke = changed(() => profiles('pdf_staff').set(roles.pdf_shipping))
    assert.equal((await revoke(pdfRequest(split))).status, 403)
  } finally {
    await approvals(split).set(original)
    await profiles('pdf_staff').set(roles.pdf_staff)
  }
})
