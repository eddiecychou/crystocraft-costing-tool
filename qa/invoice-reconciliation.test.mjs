// Actual SalesInvoices UI -> UC client -> UC edge handler -> fictional REST.
// All other mutations, allocations, endpoints, credentials and hosts fail closed.
import { test as nodeTest, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let scratch, Page, handler, f, root, host, navigate, errors, originalError, originalFetch, originalDeno

const sourceOrder = () => ({
  id: 'fictional-order', source: 'manual', customer_id: 'fictional-customer', customer_name: 'Fictional Customer',
  erp_so_no: 'SO269998', erp_si_no: 'SI269999', uc_no: 'UC9999/26', currency: 'USD', status: 'confirmed',
  subtotal: 1222, total_amount: 1222, accounting_total: 1200, adjustment: -22,
  adjustment_reason: 'Approved fictional rounding', notes: 'Fictional invoice remarks', customer_po: 'FICTIONAL-PO',
  order_date: '2026-11-04', invoiced_at: '2026-11-05', invoice_date: '2026-11-06',
  channel: 'woocommerce', woo_order_no: '66849',
})
const ledgerRow = order => ({
  si_no: order.erp_si_no, uc_no: order.uc_no || null, order_id: order.id,
  customer: order.customer_name, currency: order.currency,
  total: order.total_amount ?? order.subtotal ?? null,
  accounting_total: order.accounting_total ?? order.total_amount ?? order.subtotal ?? null,
  adjustment: order.accounting_total == null || order.total_amount == null ? 0 : Math.round((order.accounting_total - order.total_amount) * 100) / 100,
  adjustment_reason: order.adjustment_reason || '',
  invoice_date: order.invoice_date || null, invoiced_at: order.invoiced_at || null,
  customer_po: order.customer_po || '', remarks: order.notes || '',
  channel: order.channel || null, external_order_no: order.woo_order_no || null,
})
const ownedFields = ['si_no', 'uc_no', 'order_id', 'customer', 'currency', 'total', 'accounting_total', 'adjustment', 'adjustment_reason', 'invoice_date', 'invoiced_at', 'customer_po', 'remarks', 'channel', 'external_order_no']
const stubs = {
  firebase: 'export const db={};export const authedUser=async()=>({getIdToken:async()=>"FICTIONAL"});',
  firestore: `const f=()=>globalThis.__invoiceReconciliation;
    export const collection=(...p)=>p,doc=(...p)=>p,query=(...p)=>p,orderBy=()=>{},where=()=>{},limit=()=>{};
    export const onSnapshot=(path,next)=>{
      if(path.flat(Infinity).join('/')!=='[object Object]/orders')throw Error('Unexpected Firestore subscription');
      const emit=()=>next({docs:f().orders.map(order=>({id:order.id,data:()=>{const{id,...data}=order;return data}}))});
      f().orderListeners.add(emit);emit();return()=>f().orderListeners.delete(emit);
    };
    export const getDocFromServer=async path=>{
      const p=path.flat(Infinity);if(p.length!==3||p[1]!=='orders')throw Error('Unexpected fresh source read');
      const state=f();state.sourceReads.push(p[2]);if(state.sourceReadGate)await state.sourceReadGate.promise;
      if(state.sourceReadFailures>0){state.sourceReadFailures--;throw Error('Fictional source read failed')}
      const order=state.orders.find(o=>o.id===p[2]);return{id:p[2],exists:()=>Boolean(order),data:()=>{const{id,...data}=structuredClone(order);return data}};
    };
    const fail=()=>{throw Error('Firestore mutation/read outside order subscription is forbidden')};
    export{fail as getDoc,fail as getDocs,fail as getDocsFromServer,fail as addDoc,fail as updateDoc,fail as deleteDoc,fail as setDoc,fail as increment,fail as serverTimestamp,fail as writeBatch,fail as runTransaction};`,
  customer: 'export const useCustomers=()=>({customers:[]});',
  erpApi: 'export const erpLookup=async()=>[];',
  ExportFilterBar: 'export default()=>null;', ErpDocModal: 'export default()=>null;', LoadingBar: 'export default()=>null;',
  exportCsv: 'export const downloadCsv=()=>{throw Error("Exports are outside reconciliation QA")};export const exportStem=()=>"";export const inDateRange=()=>true;',
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-invoice-reconciliation-'))
  await build({ stdin: { contents: await readFile(process.env.INVOICE_RECONCILIATION_EDGE_SOURCE || 'netlify/edge-functions/uc.js', 'utf8'), resolveDir: resolve('netlify/edge-functions'), loader: 'js' }, outfile: join(scratch, 'edge.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'fictional-jwt', setup(b) {
    b.onResolve({ filter: /^https:\/\/esm.sh\/jose/ }, () => ({ path: 'jose', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const createRemoteJWKSet=()=>({});export const jwtVerify=async token=>{if(token!=="FICTIONAL")throw Error("Unexpected token");return{payload:{sub:"fictional-admin",email:"fictional@example.invalid"}}};' }))
  } }] })
  handler = (await import(pathToFileURL(join(scratch, 'edge.mjs')))).default
  await build({ stdin: { contents: await readFile(process.env.SALES_INVOICES_SOURCE || 'src/pages/SalesInvoices.jsx', 'utf8'), resolveDir: resolve('src/pages'), loader: 'jsx' }, outfile: join(scratch, 'page.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fictional-reconciliation-io', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => { const name = basename(a.path).replace(/\.jsx?$/, ''); if (name in stubs) return { path: name, namespace: 'fixture' } })
    if (process.env.INVOICE_RECONCILIATION_CLIENT_SOURCE) b.onLoad({ filter: /\/src\/ucRegistry\.js$/ }, async () => ({ contents: await readFile(process.env.INVOICE_RECONCILIATION_CLIENT_SOURCE, 'utf8'), loader: 'js', resolveDir: resolve('src') }))
    if (process.env.INVOICE_RECONCILIATION_MODEL_SOURCE) b.onLoad({ filter: /\/src\/invoiceReconciliation\.js$/ }, async () => ({ contents: await readFile(process.env.INVOICE_RECONCILIATION_MODEL_SOURCE, 'utf8'), loader: 'js', resolveDir: resolve('src') }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: process.cwd() }))
  } }] })
  Page = (await import(pathToFileURL(join(scratch, 'page.mjs')))).default
  originalFetch = globalThis.fetch; originalDeno = globalThis.Deno
  globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://fictional-rest.invalid', SUPABASE_SECRET_KEY: 'FICTIONAL-KEY', VITE_FIREBASE_PROJECT_ID: 'demo-reconciliation' }[key]) } }
  globalThis.fetch = async (input, init = {}) => {
    if (input === '/api/uc') {
      assert.equal(init.method, 'POST'); const body = JSON.parse(init.body)
      assert.ok(['list_invoices', 'upsert_invoice'].includes(body.op), 'Only invoice read/recovery operations are permitted')
      f.apiRequests.push(structuredClone(body))
      return handler(new Request('https://fictional-app.invalid/api/uc', { ...init }))
    }
    const url = new URL(input)
    if (url.host === 'firestore.googleapis.com' && url.pathname === '/v1/projects/demo-reconciliation/databases/(default)/documents/users/fictional-admin' && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ fields: { role: { stringValue: 'admin' } } }), { status: 200 })
    }
    if (url.host !== 'fictional-rest.invalid' || url.pathname !== '/rest/v1/app_sales_invoice') throw Error('Forbidden request outside fictional invoice REST')
    if (!init.method || init.method === 'GET') {
      f.readAttempts++
      if (f.readGate) await f.readGate.promise
      if (f.readFailures > 0) { f.readFailures--; return new Response('Fictional ledger unavailable', { status: 503 }) }
      if (f.successfulWrites.length && f.readFailuresAfterWrite > 0) { f.readFailuresAfterWrite--; return new Response('Fictional readback unavailable', { status: 503 }) }
      const selected = url.searchParams.get('select')
      const keys = selected && selected !== '*' ? selected.split(',') : null
      // Honor the actual edge projection: returning unselected columns here
      // would conceal a missing contract field in the production read path.
      let candidates = [...f.ledger.values()]
      const identityFilter = url.searchParams.get('si_no')
      if (identityFilter) {
        if (identityFilter.startsWith('in.(') && identityFilter.endsWith(')')) {
          const identities = identityFilter.slice(4, -1).split(',').map(value => value.replace(/^"|"$/g, ''))
          candidates = candidates.filter(row => identities.includes(row.si_no))
        } else if (identityFilter.startsWith('eq.')) candidates = candidates.filter(row => row.si_no === identityFilter.slice(3))
        else throw Error('Unexpected fictional invoice filter')
      }
      const rows = candidates.map(row => keys ? Object.fromEntries(keys.filter(k => k in row).map(k => [k, row[k]])) : structuredClone(row))
      if (f.malformedRead) return new Response(JSON.stringify({ unexpected: 'not an array of ledger rows' }), { status: 200 })
      const range = rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0'
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Range': f.incompleteRead ? '0-0/2' : range } })
    }
    if (init.method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'si_no')
      const row = JSON.parse(init.body); f.upsertAttempts.push(structuredClone(row))
      if (f.upsertGate) await f.upsertGate.promise
      if (f.failAfterFirstSuccess && f.successfulWrites.length === 1) { f.failAfterFirstSuccess = false; return new Response('Fictional second invoice write refused', { status: 503 }) }
      if (f.upsertFailures > 0) { f.upsertFailures--; return new Response('Fictional invoice write refused', { status: 503 }) }
      const persisted = { ...(f.ledger.get(row.si_no) || {}), ...structuredClone(row) }
      f.ledger.set(row.si_no, persisted); f.successfulWrites.push(structuredClone(persisted))
      return new Response(JSON.stringify(f.missingUpsertAck ? [] : [persisted]), { status: 200 })
    }
    throw Error('Forbidden REST mutation')
  }
})
beforeEach(() => {
  const order = sourceOrder()
  f = { orders: [order], orderListeners: new Set(), ledger: new Map([[order.erp_si_no, ledgerRow(order)]]), apiRequests: [], readAttempts: 0, upsertAttempts: [], successfulWrites: [], readFailures: 0, readFailuresAfterWrite: 0, upsertFailures: 0, sourceReads: [], sourceReadFailures: 0 }
  globalThis.__invoiceReconciliation = f
  errors = []; originalError = console.error; console.error = (...args) => errors.push(args.map(String).join(' '))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []) }
  finally { console.error = originalError; host.remove(); delete globalThis.__invoiceReconciliation }
})
after(async () => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })

function Bridge() { navigate = useNavigate(); return null }
async function render() {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/invoices'], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Bridge), React.createElement(Routes, null,
      React.createElement(Route, { path: '/invoices', element: React.createElement(Page) }),
      React.createElement(Route, { path: '/elsewhere', element: React.createElement('p', null, 'Fictional other page') }),
    ))))
  await flush()
}
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 0)) }) }
async function waitFor(check, message) {
  const deadline = Date.now() + 3000
  while (!check()) { if (Date.now() >= deadline) assert.fail(message || 'Expected reconciliation state before deadline'); await flush() }
}
const drift = () => /out of step with the financial record/.test(host.textContent)
const alert = () => [...host.querySelectorAll('[role=alert]')].map(el => el.textContent).join(' ')
const button = text => [...host.querySelectorAll('button')].find(el => typeof text === 'string' ? el.textContent.trim() === text : text.test(el.textContent))
const resync = () => button(/^Re-sync(?: all|ing…)?$/)
const retry = () => button(/retry|try again/i) || button('Refresh financial check')
async function click(el) { assert.ok(el, 'Expected reconciliation action'); await act(async () => el.click()); await flush() }
async function settledRead() { await waitFor(() => f.readAttempts > 0, 'Initial strict ledger request'); await flush() }
async function repair() { await click(resync()); await waitFor(() => !drift() && !alert(), 'Full reconciliation agreement after recovery') }
function assertCopy(expected = ledgerRow(f.orders[0])) {
  const actual = f.ledger.get(expected.si_no)
  assert.ok(actual)
  for (const key of ownedFields) assert.equal(actual[key], expected[key], 'Financial copy field ' + key)
}
const snapshotOrders = () => structuredClone(f.orders)

test('fully aligned invoice performs no writes and leaves source untouched', async () => {
  const before = snapshotOrders(); await render(); await settledRead()
  assert.equal(drift(), false); assert.equal(alert(), ''); assert.equal(resync(), undefined)
  assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.orders, before)
})

test('currency-triggered Re-sync retains approved 1222/1200 adjustment, dates, PO, remarks and Woo references', async () => {
  Object.assign(f.ledger.get('SI269999'), { currency: 'HKD', status: 'closed', cash_receipt_reference: 'EXISTING-RECEIPT' }); const before = snapshotOrders()
  await render(); await settledRead(); assert.equal(drift(), true); await repair()
  assert.equal(f.successfulWrites.length, 1); assertCopy(); assert.deepEqual(f.orders, before)
  const sent = f.apiRequests.find(x => x.op === 'upsert_invoice')
  assert.equal(sent.total, 1222); assert.equal(sent.accounting_total, 1200)
  assert.equal(sent.adjustment_reason, 'Approved fictional rounding'); assert.equal(sent.invoice_date, '2026-11-06')
  assert.equal(sent.customer_po, 'FICTIONAL-PO'); assert.equal(sent.remarks, 'Fictional invoice remarks')
  for (const key of ['deposit_paid', 'deposit', 'balance', 'status', 'created_by', 'updated_at']) assert.equal(key in sent, false, 'Recovery must exclude ' + key)
  assert.equal(f.ledger.get('SI269999').status, 'closed'); assert.equal(f.ledger.get('SI269999').cash_receipt_reference, 'EXISTING-RECEIPT')
})

for (const [field, wrong] of [
  ['accounting_total', 1222], ['adjustment', 0], ['adjustment_reason', ''],
  ['invoice_date', '2026-10-01'], ['invoiced_at', '2026-10-01'], ['customer_po', ''], ['remarks', ''],
  ['channel', 'Wholesale'], ['external_order_no', 'wrong-external-order'],
]) test('metadata-only drift is detected and repaired: ' + field, async () => {
  f.ledger.get('SI269999')[field] = wrong
  await render(); await settledRead(); assert.equal(drift(), true, field + ' must not be omitted from drift comparison')
  await repair(); assertCopy(); assert.equal(f.successfulWrites.length, 1)
})

test('missing financial row is created from the complete projection, without mutating the order', async () => {
  f.ledger.clear(); const before = snapshotOrders(); await render(); await settledRead()
  assert.equal(drift(), true); await repair(); assertCopy(); assert.equal(f.ledger.size, 1); assert.deepEqual(f.orders, before)
})

test('explicit zero total and accounting amount stay zero through the actual handler', async () => {
  Object.assign(f.orders[0], { subtotal: 0, total_amount: 0, accounting_total: 0, adjustment: 0, adjustment_reason: '' })
  await render(); await settledRead(); assert.equal(drift(), true); await repair(); assertCopy()
  assert.equal(f.successfulWrites[0].total, 0); assert.equal(f.successfulWrites[0].accounting_total, 0)
})

test('explicit accounting zero is an approved adjustment rather than a missing amount', async () => {
  Object.assign(f.orders[0], { accounting_total: 0, adjustment: -1222, adjustment_reason: 'Approved fictional full adjustment' })
  await render(); await settledRead(); assert.equal(drift(), true); await repair(); assertCopy()
  assert.equal(f.ledger.get('SI269999').accounting_total, 0); assert.equal(f.ledger.get('SI269999').adjustment, -1222)
})

for (const subtotal of [null, 1222]) test('unknown actual total requires review, even with subtotal ' + subtotal, async () => {
  Object.assign(f.orders[0], { subtotal, total_amount: null, accounting_total: null, adjustment: null, adjustment_reason: '' })
  f.ledger.set('SI269999', { ...ledgerRow(f.orders[0]), total: 0, accounting_total: 0, adjustment: 0 })
  const before = snapshotOrders(), copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.orders, before); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('whitespace actual total is unknown despite numeric list normalization', async () => {
  Object.assign(f.orders[0], { subtotal: 100, total_amount: '   ', accounting_total: 100, adjustment: null, adjustment_reason: 'Approved fictional source' })
  const copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('missing accounting amount uses the known invoice total without a false difference', async () => {
  Object.assign(f.orders[0], { accounting_total: null, adjustment: null, adjustment_reason: '' })
  f.ledger.set('SI269999', { ...ledgerRow(f.orders[0]), accounting_total: 1222, adjustment: 0 })
  await render(); await settledRead(); assert.equal(drift(), false); assert.deepEqual(f.upsertAttempts, [])
})

test('whitespace accounting source falls back to total without writing zero or leaving false drift', async () => {
  Object.assign(f.orders[0], { subtotal: 100, total_amount: 100, accounting_total: '   ', adjustment: null, adjustment_reason: 'Approved fictional fallback' })
  f.ledger.set('SI269999', { ...ledgerRow(f.orders[0]), accounting_total: 100, adjustment: 0, remarks: 'Stale remarks' })
  const before = snapshotOrders()
  await render(); await settledRead(); assert.equal(drift(), true); await click(resync())
  await waitFor(() => f.successfulWrites.length === 1, 'Fresh whitespace-accounting source must be recoverable')
  assert.equal(f.successfulWrites[0].accounting_total, 100); assert.equal(f.successfulWrites[0].adjustment, 0)
  assert.deepEqual(f.orders, before)
  await waitFor(() => !drift() && !alert(), 'Whitespace-source recovery must not leave normalized preview disagreement')
})

for (const accounting of [null, '']) test('absent source accounting cannot erase an approved ledger adjustment: ' + String(accounting), async () => {
  Object.assign(f.orders[0], { accounting_total: accounting, adjustment: null, adjustment_reason: '' })
  const copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

for (const accounting of [1200, 0]) test('ledger accounting with unknown ledger base requires review when source accounting is absent: ' + accounting, async () => {
  Object.assign(f.orders[0], { accounting_total: null, adjustment: null, adjustment_reason: '' })
  Object.assign(f.ledger.get('SI269999'), { total: null, accounting_total: accounting, adjustment: null, remarks: 'Stale financial metadata' })
  const before = snapshotOrders(), copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, [])
  assert.deepEqual(f.orders, before); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('a conflicting nonblank order owner is review-only and is never rebound', async () => {
  f.ledger.get('SI269999').order_id = 'another-real-owner'; const copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('a missing ledger order owner can be filled from the authoritative source', async () => {
  f.ledger.get('SI269999').order_id = null
  await render(); await settledRead(); assert.equal(drift(), true); await repair(); assertCopy()
})

test('malformed source dates require review instead of clearing a valid ledger date', async () => {
  f.orders[0].invoice_date = 'not-an-invoice-date'; const copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('date-shaped invalid calendar value is review-only without a rendering RangeError', async () => {
  f.orders[0].invoice_date = '2026-99-99'; const copy = structuredClone(f.ledger.get('SI269999'))
  await render(); await settledRead(); assert.match(host.textContent, /review required/i)
  assert.ok(!resync() || resync().disabled); assert.deepEqual(f.upsertAttempts, []); assert.deepEqual(f.ledger.get('SI269999'), copy)
})

test('legacy SI in the SO field is excluded from automatic financial recovery', async () => {
  Object.assign(f.orders[0], { erp_si_no: '', erp_so_no: 'SI269999' }); f.ledger.clear()
  await render(); await flush(); assert.equal(f.upsertAttempts.length, 0); assert.ok(!resync() || resync().disabled)
})

test('explicitly cleared dates and references replace stale financial-copy values', async () => {
  Object.assign(f.orders[0], { invoice_date: null, invoiced_at: null, customer_po: '', notes: '', channel: null, woo_order_no: '', accounting_total: 1222, adjustment: 0, adjustment_reason: '' })
  await render(); await settledRead(); assert.equal(drift(), true); await repair(); assertCopy()
})

test('initial ledger read failure stays visible and requires explicit read retry before recovery', async () => {
  f.readFailures = 1; await render(); await waitFor(() => Boolean(alert()), 'Initial read error must be visible')
  assert.equal(f.upsertAttempts.length, 0); assert.ok(retry()); assert.ok(!resync() || resync().disabled)
  await click(retry()); await waitFor(() => !alert(), 'Read retry recovers'); await flush()
  assert.equal(drift(), false); assert.equal(f.readAttempts, 2); assert.equal(f.upsertAttempts.length, 0)
})

test('failed upsert retains drift and approved source, then explicit retry repairs it', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; f.upsertFailures = 1; const before = snapshotOrders()
  await render(); await settledRead(); await click(resync()); await waitFor(() => Boolean(alert()), 'Rejected recovery must remain visible')
  assert.equal(drift(), true); assert.equal(f.ledger.get('SI269999').currency, 'HKD'); assert.deepEqual(f.orders, before)
  await repair(); assertCopy(); assert.equal(f.upsertAttempts.length, 2); assert.equal(f.successfulWrites.length, 1)
})

test('partial multi-invoice recovery stays visible and retry does not rewrite the already repaired invoice', async () => {
  const second = { ...sourceOrder(), id: 'fictional-order-2', erp_si_no: 'SI269998', uc_no: 'UC9998/26', total_amount: 250, subtotal: 250, accounting_total: 245, adjustment: -5 }
  f.orders.push(second); f.ledger.set(second.erp_si_no, ledgerRow(second))
  for (const row of f.ledger.values()) row.currency = 'HKD'
  f.failAfterFirstSuccess = true; const before = snapshotOrders()
  await render(); await settledRead(); await click(resync()); await waitFor(() => Boolean(alert()), 'Partial recovery failure remains visible')
  assert.equal(f.successfulWrites.length, 1); assert.equal(drift(), true); assert.deepEqual(f.orders, before)
  const repairedSi = f.successfulWrites[0].si_no
  await repair(); for (const order of f.orders) assertCopy(ledgerRow(order))
  assert.equal(f.successfulWrites.length, 2)
  assert.equal(f.upsertAttempts.filter(row => row.si_no === repairedSi).length, 1)
})

test('readback failure after a committed upsert is shown and can be explicitly retried', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; await render(); await settledRead(); f.readFailuresAfterWrite = 1
  await click(resync()); await waitFor(() => Boolean(alert()), 'Readback failure must not appear successful')
  assert.equal(f.successfulWrites.length, 1); assertCopy()
  await click(retry() || resync()); await waitFor(() => !alert() && !drift(), 'Explicit recovery after failed readback')
  assert.equal(f.ledger.size, 1); assert.equal(f.successfulWrites.length, 1); assertCopy()
})

test('malformed successful ledger response is an error rather than an empty financial record', async () => {
  f.malformedRead = true; await render(); await waitFor(() => Boolean(alert()), 'Malformed read requires visible failure')
  assert.equal(f.upsertAttempts.length, 0)
  f.malformedRead = false; await click(retry()); await waitFor(() => !alert(), 'Explicit retry of malformed read')
  assert.equal(drift(), false); assert.equal(f.upsertAttempts.length, 0)
})

test('incomplete targeted read cannot be treated as proof that invoices are missing', async () => {
  f.incompleteRead = true; await render(); await waitFor(() => Boolean(alert()), 'Incomplete read requires visible failure')
  assert.equal(f.upsertAttempts.length, 0); assert.ok(!resync() || resync().disabled)
  f.incompleteRead = false; await click(retry()); await waitFor(() => !alert()); assert.equal(drift(), false)
})

test('failed fresh source read prevents every write and remains retryable', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; f.sourceReadFailures = 1
  await render(); await settledRead(); await click(resync()); await waitFor(() => Boolean(alert()))
  assert.equal(f.upsertAttempts.length, 0); assert.equal(f.ledger.get('SI269999').currency, 'HKD')
  await repair(); assertCopy(); assert.equal(f.sourceReads.length, 2)
})

test('HTTP success without a returned upsert row does not silently report recovery success', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; f.missingUpsertAck = true; const before = snapshotOrders()
  await render(); await settledRead(); await click(resync()); await waitFor(() => Boolean(alert()), 'Missing write acknowledgement must be visible')
  assert.deepEqual(f.orders, before); assert.equal(f.ledger.size, 1)
  f.missingUpsertAck = false; await click(retry() || resync()); await waitFor(() => !alert() && !drift())
  assertCopy(); assert.equal(f.ledger.size, 1)
})

test('repeated recovery upserts the same SI and a later aligned reload performs no write', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; await render(); await settledRead(); await repair()
  await act(async () => navigate('/elsewhere')); await flush()
  f.ledger.get('SI269999').remarks = 'Stale again'
  await act(async () => navigate('/invoices')); await settledRead(); await waitFor(drift); await repair()
  assert.equal(f.ledger.size, 1); assert.equal(f.successfulWrites.length, 2); assertCopy()
  await act(async () => navigate('/elsewhere')); await flush(); await act(async () => navigate('/invoices')); await flush()
  assert.equal(drift(), false); assert.equal(f.successfulWrites.length, 2)
})

test('repeated recovery events while pending cannot queue a second writer', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; f.upsertGate = deferred(); await render(); await settledRead()
  const action = resync(); assert.ok(action)
  await act(async () => { Simulate.click(action); Simulate.click(action) }); await waitFor(() => f.upsertAttempts.length > 0)
  assert.equal(f.apiRequests.filter(x => x.op === 'upsert_invoice').length, 1); assert.equal(f.upsertAttempts.length, 1)
  assert.equal(resync().disabled, true)
  await act(async () => f.upsertGate.resolve()); await waitFor(() => !drift() && !alert()); assertCopy()
})

test('a recovery may finish after unmount without starting another read or disturbing the new page', async () => {
  f.ledger.get('SI269999').currency = 'HKD'; f.upsertGate = deferred(); await render(); await settledRead()
  await click(resync()); await waitFor(() => f.upsertAttempts.length === 1)
  const readsBefore = f.readAttempts; await act(async () => navigate('/elsewhere')); await flush()
  await act(async () => f.upsertGate.resolve()); await flush()
  assert.equal(host.textContent, 'Fictional other page'); assert.equal(f.readAttempts, readsBefore); assertCopy()
})
