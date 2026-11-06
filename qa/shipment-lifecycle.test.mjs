// Actual form, Router and shipping normalization; fictional external I/O only.
// No credentials, live records, number allocation or network requests.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
dom.window.HTMLElement.prototype.scrollIntoView = function () { globalThis.__shipmentLifecycle?.scrolled.push(this) }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import('react-router-dom')
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
let scratch, Page, root, host, f, navigate, route, originalError, originalFetch, errors
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const record = id => ({
  customer_id: 'customer-' + id, customer_name: 'Fictional Customer ' + id,
  customer_po: 'PO-' + id, erp_so_no: 'SO-' + id, erp_si_no: 'SI-' + id,
  uc_no: 'UC-' + id, currency: 'USD', status: 'draft', incoterm: 'FOB',
  notes: 'Notes ' + id, destination: { country: 'Country ' + id },
  source_file: { url: 'https://fictional.invalid/PI-' + id + '.pdf', name: 'PI-' + id + '.pdf' },
})
const line = id => ({ id: 'line-' + id, line_no: 1, item_code: 'ITEM-' + id, description: 'Description ' + id, qty_ordered: 10, unit: 'pcs', unit_price: 1.222, line_type: 'ad_hoc' })
const stubs = {
  firebase: 'export const db={},storage={};export const authHeader=async()=>{throw Error("Network forbidden")}',
  firestore: `const f=()=>globalThis.__shipmentLifecycle;
    export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'new-line'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{},where=()=>{},limit=()=>{};
    export const getDoc=async path=>{
      if(!path.includes('orders'))throw Error('Unexpected document read');
      const id=path.at(-1),value=await f().read('order',id);
      return{id,exists:()=>value!=null,data:()=>value};
    };
    export const getDocs=async raw=>{
      const path=raw.flat();if(path.includes('range_products'))return{docs:[]};
      if(!path.includes('orders'))throw Error('Unexpected collection read');
      const id=path[path.indexOf('orders')+1],data=await f().read('lines',id);
      return{docs:data.map(item=>({id:item.id,ref:[{},'orders',id,'lines',item.id],data:()=>item}))};
    };
    export const onSnapshot=(path,next)=>{const state=f();state.subscriptions.push({path:[...path],next});return()=>{}},serverTimestamp=()=> 'FICTIONAL timestamp';
    export const writeBatch=()=>{
      const ops=[];const add=(kind,path,data)=>{if(!f().allowWrite)throw Error('Unexpected write');ops.push({kind,path:[...path],data:structuredClone(data)})};
      return{
        update:(p,d)=>add('update',p,d),set:(p,d)=>add('set',p,d),delete:p=>add('delete',p),
        commit:async()=>{const state=f();state.batches.push(ops);if(state.commitGate)await state.commitGate.promise;if(state.commitError)throw Error(state.commitError);state.committed.push(ops)},
      };
    };
    const fail=()=>{throw Error('Unexpected standalone write/create/delete/allocation')};
    export{fail as updateDoc,fail as runTransaction,fail as addDoc,fail as deleteDoc,fail as setDoc,fail as increment};`,
  customer: `export const loadCustomers=async()=>['A','B'].map(id=>({id:'customer-'+id,company_name:'Fictional Customer '+id}));export const getCustomer=async id=>(await loadCustomers()).find(x=>x.id===id)||null;export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error('No customer writes')};`,
  criticalComponents: 'export const buildProductIndex=()=>new Map();export const matchProductCode=()=>null;',
  soNumber: 'export const JES_SEED_BY_YEAR={};export const soYear=()=>"26";const fail=()=>{throw Error("No number allocation")};export{fail as allocateSoNo,fail as formatSoNo}',
  ucRegistry: `export const upsertInvoice=async data=>globalThis.__shipmentLifecycle.accounting.push(structuredClone(data));const fail=()=>{throw Error('No financial allocation')};export{fail as allocateOrderUc,fail as allocateInvoice,fail as updateUcInvoice};`,
  storage: 'const fail=()=>{throw Error("No storage access")};export{fail as ref,fail as uploadBytes,fail as getDownloadURL}',
  erpSoImport: 'const fail=()=>{throw Error("No ERP access")};export{fail as fetchErpSoLines,fail as diffLines}',
  crystals: 'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}}',
  packaging: 'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}}',
  orderStock: 'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}}',
  ConfirmDialog: 'export default()=>null', LineImagePicker: 'export default()=>null',
  PackingListEditor: 'export default()=>null', FreightComparison: 'export default()=>null',
  OrderStockIssue: 'export default()=>null', OrderInventoryIssue: 'export default()=>null',
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipment-lifecycle-'))
  await build({ entryPoints: [resolve('src/pages/ShipmentForm.jsx')], outfile: join(scratch, 'page.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fictional-lifecycle-io', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, a => ({ path: a.path.split('/')[1], namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => { const name = basename(a.path).replace(/\.jsx?$/, ''); if (name in stubs) return { path: name, namespace: 'fixture' } })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: process.cwd() }))
  } }] })
  Page = (await import(pathToFileURL(join(scratch, 'page.mjs')))).default
  originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('Network forbidden') }
})
beforeEach(() => {
  f = { gates: {}, faults: {}, readEvents: [], subscriptions: [], batches: [], committed: [], accounting: [], scrolled: [], allowWrite: false }
  f.read = async (kind, id) => {
    const key = kind + '-' + id
    f.readEvents.push(key)
    const gate = f.gates[key]
    if (gate) await gate.promise
    if (f.faults[key] instanceof Error) throw f.faults[key]
    if (key in f.faults) return f.faults[key]
    return kind === 'order' ? record(id) : [line(id)]
  }
  globalThis.__shipmentLifecycle = f
  errors = []; originalError = console.error; console.error = (...args) => {
    const message = args.map(String).join(' ')
    if (/^\(node:\d+\) ExperimentalWarning: The MockTimers API is an experimental feature/.test(message)) originalError(...args)
    else errors.push(message)
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []) }
  finally { console.error = originalError; host.remove(); delete globalThis.__shipmentLifecycle }
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })

function Bridge() { navigate = useNavigate(); route = useLocation().pathname; return null }
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async (path = '/shipments/A') => {
  const page = React.createElement(Page)
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Bridge), React.createElement(Routes, null,
      React.createElement(Route, { path: '/shipments/new', element: page }),
      React.createElement(Route, { path: '/shipments/:id', element: page }),
      React.createElement(Route, { path: '/shipments', element: React.createElement('p', null, 'Fictional order listing') }),
    ))))
  await flush()
}
const go = async path => { await act(async () => navigate(path)); await flush() }
const release = async key => { await act(async () => f.gates[key].resolve()); await flush() }
const one = placeholder => host.querySelector('[placeholder="' + placeholder + '"]')
const submit = () => host.querySelector('button[type="submit"]')
const click = async button => { assert.ok(button); await act(async () => button.click()); await flush() }
const fill = async (element, value) => { assert.ok(element); await act(async () => { element.value = value; Simulate.change(element, { target: { value } }) }) }
const alert = () => [...host.querySelectorAll('[role="alert"]')].map(x => x.textContent).join(' ')
const retry = () => [...host.querySelectorAll('button')].find(x => /retry/i.test(x.textContent))
const assertOrder = id => {
  assert.equal(route, '/shipments/' + id)
  assert.equal(one('e.g. 56909')?.value, 'PO-' + id)
  assert.equal(one('Item code')?.value, 'ITEM-' + id)
  assert.equal(one('Unit price')?.value, '1.222')
  assert.ok([...host.querySelectorAll('a')].some(x => x.textContent.trim() === 'PI-' + id + '.pdf'))
}

test('normal saved-order navigation keeps each header, lines and source attachment together', async () => {
  await mount(); assertOrder('A'); await go('/shipments/B'); assertOrder('B')
})
test('saved to new clears references, source attachment and lines while preserving URL customer prefill', async () => {
  await mount(); assertOrder('A'); await go('/shipments/new?customer_id=customer-B')
  assert.equal(one('e.g. 56909')?.value, ''); assert.equal(one('Item code'), null)
  assert.equal(host.textContent.includes('PI-A.pdf'), false)
  assert.equal(host.querySelector('select').value, 'customer-B')
  assert.equal(submit().disabled, true)
})
test('invoice focus query on the same saved order preserves unsaved header edits', async () => {
  await mount(); await fill(one('e.g. 56909'), 'Unsaved customer PO')
  const originalReads = [...f.readEvents]
  await go('/shipments/A?invoice=1')
  assert.equal(one('e.g. 56909').value, 'Unsaved customer PO')
  assert.deepEqual(f.readEvents, originalReads)
  assert.equal(f.scrolled.at(-1), one('e.g. SI260094'))
  assert.equal(document.activeElement, one('e.g. SI260094'))
})
test('new direct and customer entry contexts do not carry earlier unsaved order state', async () => {
  await mount('/shipments/new'); await fill(one('e.g. 56909'), 'Unsaved manual order')
  await go('/shipments/new?direct=1')
  assert.equal(one('e.g. 56909').value, ''); assert.match(host.querySelector('h1').textContent, /Direct Invoice/)
  await fill(one('e.g. 56909'), 'Unsaved direct invoice')
  await go('/shipments/new?customer_id=customer-B')
  assert.equal(one('e.g. 56909').value, ''); assert.equal(host.querySelector('select').value, 'customer-B')
  await fill(one('e.g. 56909'), 'Unsaved B order')
  await go('/shipments/new?customer_id=customer-A')
  assert.equal(one('e.g. 56909').value, ''); assert.equal(host.querySelector('select').value, 'customer-A')
  assert.deepEqual(f.batches, [])
})
for (const kind of ['order', 'lines']) {
  test(`late abandoned A ${kind} response cannot replace loaded B or save A data into B`, async () => {
    f.gates[kind + '-A'] = deferred(); await mount()
    assert.equal(submit(), null)
    await go('/shipments/B'); assertOrder('B'); await release(kind + '-A'); assertOrder('B')
    f.allowWrite = true; await click(submit())
    assert.equal(f.batches.length, 1)
    const ops = f.batches[0]
    assert.equal(ops.find(x => x.kind === 'update').data.customer_po, 'PO-B')
    assert.ok(ops.every(x => x.path.includes('B')))
    assert.equal(ops.some(x => x.data?.item_code === 'ITEM-A'), false)
    assert.equal(f.accounting[0].order_id, 'B')
    assert.equal(route, '/shipments')
  })
  test(`late abandoned A ${kind} response cannot repopulate a new order`, async () => {
    f.gates[kind + '-A'] = deferred(); await mount(); await go('/shipments/new'); await release(kind + '-A')
    assert.equal(one('e.g. 56909')?.value, ''); assert.equal(one('Item code'), null)
    assert.equal(host.textContent.includes('PI-A.pdf'), false)
    assert.equal(submit().disabled, true); assert.deepEqual(f.batches, [])
  })
  test(`rejected abandoned A ${kind} read cannot turn loaded B into an error`, async () => {
    f.gates[kind + '-A'] = deferred(); await mount(); await go('/shipments/B'); assertOrder('B')
    await act(async () => f.gates[kind + '-A'].reject(Error('Fictional abandoned A read failure'))); await flush()
    assertOrder('B'); assert.equal(alert(), ''); assert.equal(submit().disabled, false)
  })
}
for (const [name, faults] of [
  ['missing order', { 'order-B': null }],
  ['header read failure', { 'order-B': Error('Fictional header read failure') }],
  ['line read failure', { 'lines-B': Error('Fictional line read failure') }],
]) {
  test(`${name} blocks stale edits and Retry loads a complete matching order`, async () => {
    await mount(); assertOrder('A'); Object.assign(f.faults, faults); await go('/shipments/B')
    assert.equal(submit(), null); assert.equal(one('e.g. 56909'), null); assert.ok(alert()); assert.ok(retry())
    f.faults = {}; await click(retry()); assertOrder('B'); assert.deepEqual(f.batches, [])
  })
}
test('B stays noneditable until its header and lines have both loaded', async () => {
  await mount(); f.gates['lines-B'] = deferred(); await go('/shipments/B')
  assert.equal(submit(), null); assert.equal(one('e.g. 56909'), null)
  await release('lines-B'); assertOrder('B')
})

async function startSave(t, options = {}) {
  Object.assign(f, { allowWrite: true }, options)
  await mount(); await fill(one('e.g. 56909'), 'PO-EDITED')
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => t.mock.timers.reset())
  await click(submit())
}
const tick = async (t, ms) => { await act(async () => t.mock.timers.tick(ms)); await flush() }
test('acknowledged atomic save invokes financial mapping and navigation after commit', async t => {
  await startSave(t)
  assert.equal(f.committed.length, 1); assert.equal(f.accounting.length, 1); assert.equal(route, '/shipments')
  assert.equal(f.accounting[0].order_id, 'A')
})
test('pending save after six seconds stays visible and prevents repeat writes until acknowledged', async t => {
  f.commitGate = deferred(); await startSave(t); await tick(t, 6000)
  assert.equal(route, '/shipments/A'); assert.equal(submit().disabled, true)
  assert.equal(host.querySelector('fieldset').disabled, true)
  assert.match(host.textContent, /pending|waiting|sync|taking longer/i)
  assert.equal(f.accounting.length, 0); assert.equal(f.committed.length, 0); assert.equal(f.batches.length, 1)
  await click(submit()); assert.equal(f.batches.length, 1)
  await act(async () => Simulate.submit(host.querySelector('form'))); await flush()
  assert.equal(f.batches.length, 1)
  await act(async () => f.commitGate.resolve()); await flush()
  assert.equal(f.committed.length, 1); assert.equal(f.accounting.length, 1); assert.equal(route, '/shipments')
})
test('late rejected save retains edits, displays the failure, and never updates financial registry', async t => {
  f.commitGate = deferred(); await startSave(t); await tick(t, 6000)
  await act(async () => f.commitGate.reject(Error('Fictional late permission rejection'))); await flush()
  assert.equal(route, '/shipments/A'); assert.match(alert(), /Fictional late permission rejection/)
  assert.equal(one('e.g. 56909').value, 'PO-EDITED'); assert.equal(submit().disabled, false)
  assert.equal(host.querySelector('fieldset').disabled, false)
  assert.equal(f.committed.length, 0); assert.equal(f.accounting.length, 0)
  f.commitGate = null; await click(submit())
  assert.equal(f.batches.length, 2); assert.equal(f.committed.length, 1)
  assert.equal(f.committed[0].find(x => x.kind === 'update').data.customer_po, 'PO-EDITED')
  assert.equal(f.accounting.length, 1); assert.equal(route, '/shipments')
})
test('delayed line reconciliation read cannot publish the header or financial entry before a batch exists', async t => {
  await mount(); f.allowWrite = true; f.gates['lines-A'] = deferred()
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => t.mock.timers.reset())
  await click(submit()); await tick(t, 6000)
  assert.equal(f.batches.length, 0); assert.equal(f.accounting.length, 0); assert.equal(route, '/shipments/A')
  await act(async () => f.gates['lines-A'].reject(Error('Fictional reconciliation read failure'))); await flush()
  assert.equal(f.batches.length, 0); assert.equal(f.accounting.length, 0)
  assert.match(alert(), /Fictional reconciliation read failure/); assert.equal(submit().disabled, false)
})
for (const destination of ['/shipments/B', '/shipments/new']) {
  test(`completed A save after leaving for ${destination} cannot hijack that page`, async t => {
    f.commitGate = deferred(); await startSave(t); await tick(t, 6000)
    await go(destination)
    if (destination.endsWith('/B')) assertOrder('B')
    else assert.equal(one('e.g. 56909').value, '')
    await act(async () => f.commitGate.resolve()); await flush()
    assert.equal(route, destination)
    if (destination.endsWith('/B')) assertOrder('B')
    else assert.equal(one('e.g. 56909').value, '')
    assert.equal(f.committed.length, 1); assert.equal(f.accounting.length, 1)
    assert.equal(f.accounting[0].order_id, 'A')
  })
}
test('rejected A save after B loads cannot display an A error on B', async t => {
  f.commitGate = deferred(); await startSave(t); await go('/shipments/B'); assertOrder('B')
  await act(async () => f.commitGate.reject(Error('Fictional abandoned A save rejection'))); await flush()
  assertOrder('B'); assert.equal(alert(), ''); assert.equal(f.accounting.length, 0)
})
