import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoverySql } from '../netlify/functions/lib/invoiceRecoverySql.js'
import { readInvoiceFinanceLookup } from '../netlify/functions/lib/invoiceFinanceLookup.js'
import { createOcInvoiceSummariesHandler } from '../netlify/functions/lib/ocInvoiceSummaries.js'
import { invoiceExpected } from '../src/invoiceRecoveryModel.js'
import { invoiceTestRest } from './invoice-recovery-rest-fixture.mjs'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const app = initializeApp({ projectId:'demo-finance-invoice-lookup' }, 'finance-invoice-handoff-qa')
const db = getFirestore(app), pg = new PGlite()
const repo = createInvoiceRecoveryRepository(db, FieldValue.serverTimestamp)
const queries = []
let failNextLink = false, ledgerUnavailable = false
const fixtureRepo = { ...repo, link: async (...args) => {
  if (failNextLink) {
    failNextLink = false
    throw Error('Fictional interruption between invoice issuance and order link')
  }
  return repo.link(...args)
} }
const asRole = (role, statement, args) => pg.transaction(async tx => {
  assert.equal(role, 'service_role')
  await tx.exec('SET LOCAL ROLE service_role')
  return (await tx.query(statement, args)).rows
})
const faults = {}
const fakePostgrest = invoiceTestRest({ pool:pg, asRole }, faults, queries)
const sql = createInvoiceRecoverySql({ url:'https://fictional.invalid', key:'fixture', fetchImpl:async (href, options) => {
  const url = new URL(href)
  if (!url.searchParams.has('si_no')) return fakePostgrest(href, options)
  assert.equal(url.pathname, '/rest/v1/app_sales_invoice')
  assert.equal(options.method, 'GET')
  assert.equal(url.searchParams.get('limit'), '2')
  assert.equal(url.searchParams.get('select'), 'id,si_no,order_id,uc_no,uc_id,status')
  assert.match(url.searchParams.get('si_no'), /^eq\.SI\d{6,}$/)
  queries.push('exact_ledger')
  if (ledgerUnavailable) return Response.json({}, { status:503 })
  const { rows } = await pg.query('select id::integer, si_no, order_id, uc_no, uc_id::integer, status from app_sales_invoice where si_no=$1 limit 2',
    [url.searchParams.get('si_no').slice(3)])
  return Response.json(rows)
} })
const profiles = {
  admin:{ role:'admin' },
  shipping:{ role:'staff', modules:['shipping'] },
  shipping_uc:{ role:'staff', modules:['shipping','uc'] },
  finance:{ role:'staff', modules:['invoices'] },
  dual:{ role:'staff', modules:['invoices','shipping'] },
  customer:{ role:'customer', status:'approved', customer_id:'fictional-buyer' },
}
const auth = { verifyToken:async uid => ({ uid }), getProfile:async uid => (await db.doc('users/' + uid).get()).data() }
const setupRecovery = createInvoiceRecoveryHandler({ ...auth, repo:fixtureRepo, sql })
const handler = createOcInvoiceSummariesHandler({ ...auth,
  lookup:target => readInvoiceFinanceLookup(db, sql, target),
  load:() => assert.fail('Exact lookup cannot scan summaries'),
})
const request = async (handler, path, actor, body) => {
  const headers = actor ? { Authorization:'Bearer ' + actor } : {}
  const response = await handler(new Request('http://127.0.0.1' + path, { headers, method:body ? 'POST' : 'GET',
    ...(body ? { body:JSON.stringify(body) } : {}) }))
  return { status:response.status, body:await response.json(), cache:response.headers.get('cache-control') }
}
const lookup = (value, actor = 'finance') => request(handler,
  '/api/oc-invoice-summaries?' + new URLSearchParams({ lookup:value }), actor)
const order = id => db.doc('orders/' + id)
const opRef = (id, op) => order(id).collection('invoice_allocations').doc(op.id)
async function buildFamily(id, purpose, interrupted, fault) {
  const data = { customer_name:'Fictional Buyer', customer_id:'fictional-buyer', currency:'USD',
    total_amount:245, accounting_total:245, status:'confirmed', erp_so_no:'SO-FICTION-' + id }
  await order(id).set(data)
  const action = (action, details) => request(setupRecovery, '/api/invoice-allocation', 'admin', { action, order_id:id, ...details })
  const first = await action('raise', { expected:invoiceExpected(data) })
  assert.equal(first.status, 200)
  const add = async (kind, previous) => action('new', { purpose:kind, reason:'Fictional ' + kind,
    expected:previous.expected, previous_operation_id:previous.operation.id })
  let previous = first
  if (purpose === 'reissue') {
    previous = await add('split', previous.body)
    assert.equal(previous.status, 200)
  }
  failNextLink = interrupted
  if (fault) faults[fault] = true
  const last = await add(purpose, previous.body)
  assert.equal(last.status, interrupted && !fault ? 503 : 200)
  const pointer = (await order(id).get()).get('invoice_allocation_id')
  const op = (await opRef(id, { id:pointer }).get()).data()
  assert.equal(op.status, fault ? 'pending' : interrupted ? 'allocated' : 'linked')
  assert.equal(op.request.purpose, purpose)
  if (!fault) {
    assert.notEqual(op.result.si_no, previous.body.operation.result.si_no)
    assert.equal(op.result.uc_no, previous.body.operation.result.uc_no)
  }
  return { id, op, first:first.body.operation, previous:previous.body.operation }
}
async function snapshot() {
  const firestore = (await Promise.all([
    db.collection('orders').get(), db.collectionGroup('invoice_allocations').get(), db.collection('invoice_followup_jobs').get(),
  ])).flatMap(({ docs }) => docs.map(doc => [doc.ref.path, doc.updateTime.toDate().toISOString(), doc.data()]))
  const postgres = await pg.query(`select
    (select jsonb_agg(to_jsonb(t) order by id) from app_sales_invoice t) invoices,
    (select jsonb_agg(to_jsonb(t) order by id) from uc_registry t) uc,
    (select jsonb_agg(to_jsonb(t) order by operation_id) from oc_invoice_private.invoice_allocations t) receipts,
    (select count(*)::int from app_sales_invoice_audit) audit_rows`)
  return { firestore, postgres:postgres.rows[0] }
}
try {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema raw; create table raw.salesinvoice(sino text);
    create sequence public.fictional_uc_number start 100;
    create table public.uc_registry(id bigserial primary key, uc_no text default ('UC'||nextval('public.fictional_uc_number')),
      year text, customer text, currency text, status text, created_by text, updated_at timestamptz, updated_by text,
      source text, customer_id text, order_no text, total numeric, deposit numeric, balance numeric, bal_pay_date text,
      remarks text, confirmed boolean);`)
  for (const path of ['erp-sync/app_sales_invoice.sql','erp-sync/migrations/20261108013402_invoice_retry_recovery.sql',
    'erp-sync/migrations/20261112011943_guard_invoice_followup_review.sql']) await pg.exec(await readFile(path,'utf8'))
  await Promise.all(Object.entries(profiles).map(([uid, profile]) => db.doc('users/' + uid).set(profile)))

  const missing = await buildFamily('fictional-missing-order', 'split', true)
  await order(missing.id).delete()
  const replaced = await buildFamily('fictional-replaced-reissue', 'reissue', true)
  await order(replaced.id).update({ invoice_allocation_id:replaced.previous.id })
  const conflict = await buildFamily('fictional-conflicting-reissue', 'reissue', true)
  await opRef(conflict.id, conflict.op).update({ 'request.reason':'Fictional inconsistent evidence' })
  const dangling = await buildFamily('fictional-ledger-dangling', 'split', true)
  await opRef(dangling.id, dangling.op).delete()
  const ledgerOnly = await buildFamily('fictional-ledger-only', 'reissue', false)
  await order(ledgerOnly.id).delete()
  await opRef(ledgerOnly.id, ledgerOnly.op).delete()
  await pg.query('delete from oc_invoice_private.invoice_allocations where operation_id=$1', [ledgerOnly.op.id])
  const ledgerIncomplete = await buildFamily('fictional-ledger-no-amount', 'split', true)
  await order(ledgerIncomplete.id).delete()
  await opRef(ledgerIncomplete.id, ledgerIncomplete.op).delete()
  const control = await buildFamily('fictional-healthy-reissue', 'reissue', false)
  const lostAck = await buildFamily('fictional-lost-ack', 'split', false, 'lostSqlAck')
  const unissued = await buildFamily('fictional-unissued-reissue', 'reissue', false, 'beforeSql')
  const voided = await buildFamily('fictional-voided-reissue', 'reissue', false)
  await pg.query("update app_sales_invoice set status='void' where si_no=$1", [voided.op.result.si_no])
  const ledgerConflict = await buildFamily('fictional-ledger-conflict', 'reissue', false)
  await pg.query("update app_sales_invoice set uc_no='FICTIONAL-OTHER-UC' where si_no=$1", [ledgerConflict.op.result.si_no])
  const baseline = await snapshot(), readStart = queries.length

  const check = async (input, status, expected) => {
    const response = await lookup(input)
    assert.equal(response.status, 200)
    assert.match(response.cache, /private, no-store/)
    assert.equal(response.body.status, status)
    for (const [key, value] of Object.entries(expected || {})) assert.equal(response.body[key], value, key)
    assert.doesNotMatch(JSON.stringify(response.body), /actor_uid|customer|request_json|snapshot|Fictional Buyer/)
    return response.body
  }
  const both = async ({ op, id }, status, hasVerifiedUc) => {
    const { si_no:si, uc_no:uc, invoice_id:ledgerId } = op.result
    const expected = { si, orderId:id, requestId:op.id, ledgerId:String(ledgerId), uc:hasVerifiedUc ? uc : undefined }
    assert.deepEqual(await check(op.id, status, expected), await check(si.toLowerCase(), status, expected))
  }
  await both(missing, 'order_missing', true)
  await both(replaced, 'request_replaced', true)
  await both(conflict, 'receipt_conflict', false)
  await both(ledgerConflict, 'ledger_conflict', false)
  await both(voided, 'ledger_void', true)
  await both(dangling, 'request_missing', true)
  await check(ledgerIncomplete.op.id, 'request_missing', { si:ledgerIncomplete.op.result.si_no, uc:ledgerIncomplete.op.result.uc_no })
  await check(ledgerIncomplete.op.result.si_no, 'ledger_only', { requestId:undefined, uc:undefined })
  await check(ledgerOnly.op.result.si_no, 'ledger_only', { ledgerId:String(ledgerOnly.op.result.invoice_id), uc:undefined })
  await check(ledgerOnly.op.id, 'no_receipt', { si:undefined })
  await check(unissued.op.id, 'no_receipt', { orderId:unissued.id, si:undefined })
  const receipt = await sql.lookup(lostAck.op.id)
  await check(receipt.o_si_no, 'awaiting_link', { requestId:lostAck.op.id, uc:receipt.o_uc_no })
  assert.equal((await opRef(lostAck.id, lostAck.op).get()).get('result'), null)
  await check('SI9999999999', 'not_found')
  for (const op of [control.first, control.previous, control.op])
    await both({ id:control.id, op }, 'linked', true)
  assert.notEqual(control.previous.result.si_no, control.op.result.si_no)
  assert.equal(control.previous.result.uc_no, control.op.result.uc_no)

  const beforeRejections = queries.length
  for (const [actor, status] of [['shipping',403], ['shipping_uc',403], ['customer',403], [null,401]])
    assert.equal((await lookup(control.op.id, actor)).status, status)
  for (const value of ['SI260', 'UC100/26', '.*', 'SI' + '1'.repeat(39), ''])
    assert.equal((await lookup(value)).status, 400)
  for (const fields of ['lookup=SI260001&lookup=SI260002', 'lookup=SI260001&pdf=SI260001'])
    assert.equal((await request(handler, '/api/oc-invoice-summaries?' + fields, 'finance')).status, 400)
  assert.equal(queries.length,beforeRejections)
  for (const actor of ['finance','dual','admin']) assert.equal((await lookup(control.op.id, actor)).status, 200)
  ledgerUnavailable = true
  assert.equal((await lookup(control.op.id)).status, 503)
  ledgerUnavailable = false
  faults.lookupUnavailable = true
  assert.equal((await lookup(control.op.id)).status, 503)
  faults.lookupUnavailable = false
  assert.equal((await lookup(control.op.id)).body.status, 'linked')
  assert.ok(queries.slice(readStart).every(path => ['lookup_invoice_allocation','exact_ledger'].includes(path)))
  assert.deepEqual(await snapshot(),baseline)
  console.log('PASS Finance exact lookup: split, reissue, conflict, detached, void, outages and role boundaries; no writes.')
} finally {
  await db.terminate()
  await deleteApp(app)
  await pg.close()
}
