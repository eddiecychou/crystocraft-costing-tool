// Shared supplier quote form and real Range quote writers, with fictional I/O.
import { test as nodeTest, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'FileReader']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import('react-router-dom')
const { Simulate } = await import('react-dom/test-utils')
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const crystalPath = (p = 'p1', v = 'v1', c = 'c1', q = 'q1') => `/crystal-components/${p}/variants/${v}/costs/${c}/quotes/${q}`
const quotePath = (c = 'c1', q = 'q1') => `range_components/${c}/supplier_quotes/${q}`
const attachment = { file_url: 'https://fictional.invalid/original.pdf', file_name: 'Original.pdf', file_type: 'pdf', metadata: { revision: 1 } }
const quote = () => ({ supplier_id: 's1', supplier_name: 'Fictional Supplier', unit_cost: 1.222, unit_cost_currency: 'USD', moq: 1000, tooling_sample_cost: 1400, tooling_sample_cost_currency: 'RMB', tooling_lead_time_days: 15, sampling_lead_time_days: 12, production_lead_time_days: 30, is_preferred: true, notes: 'Fictional approved terms 中文; tooling RMB 900; samples RMB 500.', volume_tiers: [{ min_qty: 2000, unit_cost: 1.111 }], attachments: [attachment], createdAt: 'original', provenance: 'preserve source' })
let scratch, Form, host, root, f, navigate, currentRoute, errors, originalError, originalFetch
const stubs = {
  firebase: 'export const db={},storage={};export const authHeader=async()=>{globalThis.__crystalQuote.extractionCalls++;throw Error("Extraction is not authorized in this fixture")};',
  firestore: String.raw`const f=()=>globalThis.__crystalQuote;
    const ref=(path)=>({path,id:path.split('/').at(-1)});
    export const collection=(base,...parts)=>ref([base?.path,...parts].filter(Boolean).join('/'));
    export const doc=(base,...parts)=>ref([base?.path,...(parts.length?parts:['new-quote-'+(++f().nextId)])].filter(Boolean).join('/'));
    export const query=path=>path,orderBy=()=>{},where=()=>{},limit=()=>{},serverTimestamp=()=> 'FICTIONAL timestamp';
    const snapshot=(r,data)=>({id:r.id,ref:r,exists:()=>data!==undefined,data:()=>structuredClone(data)});
    export const getDoc=async r=>{const state=f();state.reads.push(r.path);if(state.readFailures.has(r.path))throw Error('Fictional read failed');const gate=state.readGates.get(r.path);if(gate)await gate.promise;return snapshot(r,state.docs.get(r.path))};
    export const getDocs=async r=>{const state=f();state.reads.push(r.path);if(state.readFailures.has(r.path))throw Error('Fictional list failed');return{docs:[...state.docs].filter(([p])=>p.startsWith(r.path+'/')&&p.slice(r.path.length+1).split('/').length===1).map(([p,d])=>snapshot(ref(p),d))}};
    const mutate=(kind,r,data)=>{const state=f();if(!/^range_components\/[^/]+(?:\/supplier_quotes\/[^/]+)?$/.test(r.path))throw Error('Mutation outside private Range quote tree');state.writes.push({kind,path:r.path,data:structuredClone(data)});if(kind==='delete')state.docs.delete(r.path);else state.docs.set(r.path,{...(kind==='update'?state.docs.get(r.path):{}),...structuredClone(data)})};
    export const updateDoc=async(r,data)=>mutate('update',r,data),deleteDoc=async r=>mutate('delete',r),addDoc=async(r,data)=>{const next=doc(r);mutate('set',next,data);return next};
    export const runTransaction=async(_db,fn)=>{const state=f();state.transactions++;if(state.beforeTransaction){state.beforeTransaction();state.beforeTransaction=null}if(state.transactionGate)await state.transactionGate.promise;if(state.transactionFailure)throw Error(state.transactionFailure);const pending=[];const result=await fn({get:async r=>snapshot(r,state.docs.get(r.path)),update:(r,d)=>pending.push(['update',r,d]),set:(r,d)=>pending.push(['set',r,d]),delete:r=>pending.push(['delete',r])});for(const[k,r,d]of pending)mutate(k,r,d);return result};
    const fail=()=>{throw Error('Unexpected Firestore operation')};export{fail as onSnapshot,fail as writeBatch,fail as setDoc,fail as increment};`,
  storage: `export const ref=(_storage,path)=>({path});export const uploadBytes=async(r,file,metadata)=>{const f=globalThis.__crystalQuote;f.uploads.push({path:r.path,name:file.name,metadata});if(f.uploadGate)await f.uploadGate.promise};export const getDownloadURL=async r=>'https://fictional.invalid/'+encodeURIComponent(r.path);`,
  i18n: 'export const useT=()=>text=>text;',
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-crystal-quote-'))
  await build({ entryPoints: ['src/pages/SupplierQuoteForm.jsx'], outfile: join(scratch, 'form.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fictional-private-quote-io', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, a => ({ path: a.path.split('/')[1], namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => { const name = basename(a.path).replace(/\.jsx?$/, ''); if (name in stubs) return { path: name, namespace: 'fixture' } })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: process.cwd() }))
  } }] })
  Form = (await import(pathToFileURL(join(scratch, 'form.mjs')))).default
  originalFetch = globalThis.fetch; globalThis.fetch = () => { throw Error('No live network requests') }
})
function seed(p = 'p1', v = 'v1', c = 'c1', q = 'q1') {
  f.docs.set('crystal_products/' + p, { name: 'Fictional Octagon ' + p, code: 'CC-' + p })
  f.docs.set(`crystal_products/${p}/variants/${v}`, { code: 'VAR-' + v, label: '14 mm Red ' + v, unit: 'pcs' })
  f.docs.set('range_components/' + c, { code: 'COST-' + c, name: 'Fictional private component ' + c, crystal_product_id: p, crystal_variant_id: v, crystal_catalogue_unit: 'pcs', preferred_quote_id: q, unit_cost: 1.222, internal_notes: 'Preserve private notes' })
  f.docs.set(quotePath(c, q), quote())
}
beforeEach(() => {
  f = { docs: new Map(), writes: [], reads: [], readFailures: new Set(), readGates: new Map(), transactions: 0, uploads: [], extractionCalls: 0, nextId: 0 }
  globalThis.__crystalQuote = f; seed()
  f.docs.set('suppliers/s1', { name: 'Fictional Supplier', name_cn: '測試供應商' })
  f.docs.set('suppliers/s1/catalogs/file1', { file_name: 'Supplier source.pdf', file_url: 'https://fictional.invalid/supplier-source.pdf', file_type: 'application/pdf', storage_path: 'suppliers/s1/catalogs/source.pdf' })
  errors = []; originalError = console.error; console.error = (...args) => errors.push(args.map(String).join(' '))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []) }
  finally { console.error = originalError; host.remove(); delete globalThis.__crystalQuote }
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })

function Bridge() { navigate = useNavigate(); const location = useLocation(); currentRoute = location.pathname; return null }
async function render(path = crystalPath()) {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Bridge), React.createElement(Routes, null,
      React.createElement(Route, { path: '/crystal-components/:productId/variants/:variantId/costs/:componentId/quotes/new', element: React.createElement(Form, { mode: 'range' }) }),
      React.createElement(Route, { path: '/crystal-components/:productId/variants/:variantId/costs/:componentId/quotes/:quoteId', element: React.createElement(Form, { mode: 'range' }) }),
      React.createElement(Route, { path: '/components/critical/:id/quotes/:quoteId', element: React.createElement(Form, { mode: 'range' }) }),
      React.createElement(Route, { path: '/crystal-components/:productId', element: React.createElement('p', null, 'Fictional Crystal product') }),
      React.createElement(Route, { path: '/components/critical/:id', element: React.createElement('p', null, 'Fictional Range component') }),
      React.createElement(Route, { path: '/elsewhere', element: React.createElement('p', null, 'Fictional other page') }),
    ))))
  await flush()
}
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 0)) }) }
async function waitFor(check, message = 'Expected quote state') { const deadline = Date.now() + 3000; while (!check()) { if (Date.now() > deadline) assert.fail(message); await flush() } }
const button = name => [...host.querySelectorAll('button')].find(el => el.textContent.trim() === name)
const mainCost = () => host.querySelector('input[step="0.001"]')
const alert = () => host.querySelector('[role=alert]')
async function click(el) { assert.ok(el); await act(async () => el.click()); await flush() }
async function fill(el, value) { assert.ok(el); await act(async () => { el.value = value; Simulate.change(el, { target: { value } }) }); await flush() }
async function submit() { await act(async () => Simulate.submit(host.querySelector('form'))); await flush() }
async function selectSupplier() { await click(host.querySelector('.cursor-text')); await act(async () => Simulate.keyDown(host.querySelector('[placeholder="Search supplier…"]'), { key: 'Enter' })); await flush() }
async function addSupplierFile() { await click(button('Choose supplier file')); await click(button('Attach file')) }

test('Crystal context loads actual product and variant with exact precision and existing terms', async () => {
  await render(); assert.ok(host.querySelector('form')); assert.match(host.textContent, /Fictional Octagon p1/); assert.match(host.textContent, /VAR-v1.*14 mm Red v1/)
  assert.equal(mainCost().value, '1.222'); assert.equal(mainCost().getAttribute('placeholder'), '0.000')
  assert.equal(host.querySelectorAll('input[step="0.001"]')[1].value, '1.111')
  assert.equal(host.querySelector('textarea').value, quote().notes); assert.equal(host.querySelector('#preferred').checked, true)
  assert.ok([...host.querySelectorAll('a')].some(a => a.getAttribute('href') === '/crystal-components/p1'))
})

test('new quote uses existing Range quote tree, three-decimal costs and combined tooling/sample field', async () => {
  await render(crystalPath('p1', 'v1', 'c1', 'new')); await selectSupplier()
  await fill(mainCost(), '1.222'); await click(button('+ Add Tier'))
  await fill(host.querySelectorAll('input[step="0.001"]')[1], '1.111')
  await fill(host.querySelector('[placeholder="e.g. 500"]'), '2000')
  await fill(host.querySelector('[placeholder="e.g. 200"]'), '1000')
  await fill(host.querySelector('input[step="0.01"]'), '1400')
  await fill(host.querySelector('textarea'), 'Fictional tooling RMB 900; samples RMB 500; combined RMB 1400.')
  await click(host.querySelector('#preferred')); await submit()
  assert.equal(currentRoute, '/crystal-components/p1')
  const added = f.docs.get(quotePath('c1', 'new-quote-1')); assert.ok(added)
  assert.equal(added.unit_cost, 1.222); assert.deepEqual(added.volume_tiers, [{ min_qty: 2000, unit_cost: 1.111 }]); assert.equal(added.moq, 1000); assert.equal(added.tooling_sample_cost, 1400)
  assert.match(added.notes, /900.*500.*1400/); assert.equal(added.is_preferred, true)
  assert.equal(f.docs.get('range_components/c1').preferred_quote_id, 'new-quote-1')
  assert.equal(f.docs.get(quotePath()).is_preferred, false)
})

test('intentional range pricing edits keep exact stored precision and source attachments', async () => {
  await render(); await fill(mainCost(), '1.22345'); await fill(host.querySelectorAll('input[step="0.001"]')[1], '1.11234'); await submit()
  const saved = f.docs.get(quotePath()); assert.equal(saved.unit_cost, 1.22345); assert.equal(saved.volume_tiers[0].unit_cost, 1.11234)
  assert.equal(saved.tooling_sample_cost, 1400); assert.deepEqual(saved.attachments, [attachment]); assert.equal(saved.notes, quote().notes)
  assert.equal(f.docs.get('range_components/c1').unit_cost, 1.22345)
})

test('supplier-file attachment-only transaction preserves concurrent approved costs, notes, preference and component snapshot', async () => {
  await render(); await addSupplierFile()
  const approved = { ...f.docs.get(quotePath()), unit_cost: 1.44444, moq: 3000, notes: 'Concurrent approved terms', is_preferred: false }
  f.docs.set(quotePath(), approved); f.docs.set('range_components/c1', { ...f.docs.get('range_components/c1'), preferred_quote_id: null, unit_cost: null })
  const component = structuredClone(f.docs.get('range_components/c1')); await submit()
  assert.equal(currentRoute, '/crystal-components/p1'); assert.equal(f.writes.length, 1); assert.deepEqual(Object.keys(f.writes[0].data), ['attachments'])
  assert.deepEqual({ ...f.docs.get(quotePath()), attachments: approved.attachments }, approved)
  assert.equal(f.docs.get(quotePath()).attachments[1].supplier_file_id, 'file1'); assert.equal(f.docs.get(quotePath()).attachments[1].storage_path, 'suppliers/s1/catalogs/source.pdf')
  assert.deepEqual(f.docs.get('range_components/c1'), component); assert.deepEqual(f.uploads, []); assert.equal(f.extractionCalls, 0)
})

test('uploading PDF to existing range quote never extracts and keeps the established range Storage prefix', async () => {
  await render(); const file = new dom.window.File(['%PDF-1.7 fictional'], 'Fictional-edit.pdf', { type: 'application/pdf' })
  const input = host.querySelector('input[type=file]'); Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => Simulate.change(input)); await flush(); assert.equal(f.extractionCalls, 0)
  await submit(); assert.equal(f.uploads.length, 1); assert.match(f.uploads[0].path, /^range_components\/c1\/quotes\/\d+_Fictional-edit\.pdf$/)
  assert.equal(f.docs.get(quotePath()).unit_cost, 1.222); assert.equal(f.docs.get(quotePath()).attachments.length, 2)
})

test('concurrent attachment change rejects save beside controls, retains edits and permits retry', async () => {
  await render(); await addSupplierFile(); f.docs.get(quotePath()).attachments = [{ ...attachment, file_url: '/changed.pdf' }]
  await submit(); assert.ok(alert()); assert.match(alert().textContent, /Attachments changed/); assert.equal(document.activeElement, alert()); assert.deepEqual(f.writes, [])
  assert.equal(mainCost().value, '1.222'); assert.equal(host.querySelector('button[type=submit]').disabled, false)
})

for (const missing of ['crystal_products/p1', 'crystal_products/p1/variants/v1', 'range_components/c1', quotePath()]) test('missing context or existing quote fails closed: ' + missing, async () => {
  const record = f.docs.get(missing); f.docs.delete(missing); await render(); assert.equal(host.querySelector('form'), null); assert.ok(alert()); assert.ok(button('Retry')); assert.deepEqual(f.writes, [])
  f.docs.set(missing, record); await click(button('Retry')); assert.ok(host.querySelector('form')); assert.equal(mainCost().value, '1.222')
})

for (const patch of [{ crystal_product_id: 'other-product' }, { crystal_variant_id: 'other-variant' }, { crystal_catalogue_unit: 'sheet' }, { crystal_catalogue_unit: undefined }]) test('mismatched or unreviewed association is not editable: ' + JSON.stringify(patch), async () => {
  Object.assign(f.docs.get('range_components/c1'), patch); await render(); assert.equal(host.querySelector('form'), null); assert.match(alert().textContent, /no longer matches/); assert.deepEqual(f.writes, [])
})

test('missing units on both records are an unreviewed association and cannot open the editor', async () => {
  delete f.docs.get('range_components/c1').crystal_catalogue_unit
  delete f.docs.get('crystal_products/p1/variants/v1').unit
  await render(); assert.equal(host.querySelector('form'), null); assert.match(alert().textContent, /no longer matches/); assert.deepEqual(f.writes, [])
})

for (const pricingEdit of [false, true]) test('association changed after preflight is rejected atomically: ' + (pricingEdit ? 'pricing save' : 'attachments only'), async () => {
  await render(); if (pricingEdit) await fill(mainCost(), '1.333'); else await addSupplierFile()
  f.beforeTransaction = () => { f.docs.get('range_components/c1').crystal_variant_id = 'different-variant' }
  await submit(); assert.ok(alert()); assert.equal(document.activeElement, alert()); assert.deepEqual(f.writes, []); assert.equal(currentRoute, crystalPath())
})

test('generic Range mode keeps the established component quote writer and navigation', async () => {
  await render('/components/critical/c1/quotes/q1'); await fill(mainCost(), '1.234'); await submit()
  assert.equal(currentRoute, '/components/critical/c1'); assert.equal(f.docs.get(quotePath()).unit_cost, 1.234)
})

test('Crystal delete uses guarded Range quote deletion and returns to the product', async () => {
  await render(); await click(button('Delete Quote')); await click(button('Delete'))
  assert.equal(f.docs.has(quotePath()), false); assert.equal(currentRoute, '/crystal-components/p1'); assert.equal(f.docs.get('range_components/c1').preferred_quote_id, null)
})

test('route change abandons old reads and cannot apply or save another variant quote', async () => {
  seed('p2', 'v2', 'c2', 'q2'); f.docs.get(quotePath('c2', 'q2')).unit_cost = 2.333
  const gate = deferred(); f.readGates.set('range_components/c1', gate); await render()
  await act(async () => navigate(crystalPath('p2', 'v2', 'c2', 'q2'))); await flush(); assert.equal(mainCost().value, '2.333')
  await act(async () => gate.resolve()); await flush(); assert.equal(mainCost().value, '2.333'); assert.match(host.textContent, /Fictional Octagon p2/)
  await submit(); assert.equal(currentRoute, '/crystal-components/p2'); assert.ok(f.writes.every(w => w.path === quotePath('c2', 'q2')))
})

test('duplicate pending submits start one Range quote transaction', async () => {
  await render(); await fill(mainCost(), '1.333'); f.transactionGate = deferred()
  const form = host.querySelector('form'); await act(async () => { Simulate.submit(form); Simulate.submit(form) }); await waitFor(() => f.transactions === 1)
  await act(async () => f.transactionGate.resolve()); await flush(); assert.equal(f.transactions, 1); assert.equal(f.docs.get(quotePath()).unit_cost, 1.333)
})

test('leaving during upload prevents a stale quote mutation and navigation', async () => {
  await render(); const file = new dom.window.File(['%PDF-1.7 fictional'], 'Pending.pdf', { type: 'application/pdf' }); const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: [file], configurable: true }); await act(async () => Simulate.change(input)); f.uploadGate = deferred()
  await submit(); await waitFor(() => f.uploads.length === 1); await act(async () => navigate('/elsewhere')); await flush()
  await act(async () => f.uploadGate.resolve()); await flush(); assert.equal(host.textContent, 'Fictional other page'); assert.deepEqual(f.writes, [])
})
