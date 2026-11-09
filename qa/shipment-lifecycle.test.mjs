// Actual form, Router and shipping normalization; fictional external I/O only.
// No credentials, live records, number allocation or network requests.
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
import {fixtureSourceToken} from './quote-conversion-page-fixture.mjs'

const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
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
const quote = id => ({customer_id:'customer-A',client_name:'Fictional Quote '+id,quote_currency:'EUR',quote_no:'QU-'+id,ref_no:'UC100/26'})
const quoteItems = id => [{id:'quote-line-'+id,is_custom:true,product_name:'Quoted '+id,product_unit:'pair',tiers:[{quantity:1000,price:1.222,remarks:'First tier 中文'},{quantity:2000,price:1.111}]}]
const stubs = {
  quoteConversion:'export const quoteConversionAction=(...a)=>globalThis.__shipmentLifecycle.quoteAction(...a)',
  quoteConversionModel:'export const quoteSourceToken=async(...a)=>globalThis.__shipmentLifecycle.sourceToken(...a)',
  firebase: 'export const db={},storage={};export const authHeader=async()=>{throw Error("Network forbidden")}',
  firestore: `const f=()=>globalThis.__shipmentLifecycle;
    export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'new-line'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{},where=()=>{},limit=()=>{};
    export const getDoc=async path=>{
      if(!path.includes('orders')&&!path.includes('client_quotes'))throw Error('Unexpected document read');
      const id=path.at(-1),value=await f().read(path.includes('client_quotes')?'quote':'order',id);
      return{id,exists:()=>value!=null,data:()=>value};
    };
    export const getDocs=async raw=>{
      const path=raw.flat();if(path.includes('range_products'))return{docs:await f().read('catalogue','all')};
      if(!path.includes('orders')&&!path.includes('client_quotes'))throw Error('Unexpected collection read');
      const type=path.includes('client_quotes')?'client_quotes':'orders';
      const id=path[path.indexOf(type)+1],data=await f().read(type==='client_quotes'?'quoteItems':'lines',id);
      return{docs:data.map(item=>({id:item.id,ref:[{},'orders',id,'lines',item.id],data:()=>item}))};
    };
    export {getDoc as getDocFromServer,getDocs as getDocsFromServer};
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
  customer: `export const loadCustomers=()=>globalThis.__shipmentLifecycle.read('customers','all');export const getCustomer=async id=>(await loadCustomers()).find(x=>x.id===id)||null;export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error('No customer writes')};`,
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
    if(kind==='quote')return quote(id)
    if(kind==='quoteItems')return quoteItems(id)
    if(kind==='catalogue')return []
    if(kind==='customers')return ['A','B'].map(id=>({id:'customer-'+id,company_name:'Fictional Customer '+id}))
    return kind === 'order' ? record(id) : [line(id)]
  }
  globalThis.__shipmentLifecycle = f
  f.sourceToken=fixtureSourceToken
  f.quoteAction=async id=>{
    const q=f.faults['quote-'+id]||quote(id), rows=f.faults['quoteItems-'+id]||quoteItems(id)
    return {source_token:fixtureSourceToken(q,rows.map(item=>({...item,id:item.id}))),revision:0,active:null,latest:null,legacy:null,history:[]}
  }
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


// SH-06: actual route-keyed form, real mapping/defaults, deferred external reads.
const quotePath = id => '/shipments/new?from_quote='+id
const assertQuote = id => {
  assert.equal(route, '/shipments/new')
  assert.equal(host.querySelector('select')?.value,'customer-A')
  assert.equal(one('Description')?.value,'Quoted '+id)
  assert.equal(one('Qty')?.value,'1000')
  assert.equal(one('Unit price')?.value,'1.222')
  assert.equal(one('pcs')?.value,'pair')
  assert.equal(one('Tier remarks (customer-facing)')?.value,'First tier 中文')
  assert.equal(one('e.g. UC4950/26')?.value,'UC100/26')
  assert.equal(host.querySelector('textarea[placeholder^="Prints on"]')?.value,'Converted from Quote QU-'+id)
  assert.equal(submit()?.disabled,false)
  assert.match(host.textContent,/Prefilled from the quote/)
}
const assertQuoteBlocked = () => {
  assert.equal(Boolean(host.querySelector('form')),false)
  assert.equal(Boolean(submit()),false)
  assert.equal(Boolean(one('e.g. 56909')),false)
  assert.equal(host.textContent.includes('Prefilled from the quote'),false)
  assert.deepEqual(f.batches,[]);assert.deepEqual(f.accounting,[])
}
for (const kind of ['quote','quoteItems']) {
  test('quote initialization waits for '+kind+' before showing editable defaults',async()=>{
    f.gates[kind+'-Q']=deferred();await mount(quotePath('Q'));assertQuoteBlocked()
    assert.match(host.textContent,/Loading the quote and its product lines/)
    assert.equal(host.querySelector('[aria-label="Quote initialization"]').getAttribute('aria-busy'),'true')
    if(kind==='quote')assert.equal(f.readEvents.includes('quoteItems-Q'),false)
    await release(kind+'-Q');assertQuote('Q')
  })
  test('failed '+kind+' read shows Retry without partial fields or writes; retry reloads the whole quote',async()=>{
    f.faults[kind+'-Q']=Error('Fictional '+kind+' read failed');await mount(quotePath('Q'));assertQuoteBlocked()
    assert.match(alert(),/Fictional/);assert.ok(retry())
    assert.ok(host.querySelector('a[href="/quotes/Q"]'))
    f.faults={};await click(retry());assertQuote('Q')
    assert.equal(f.readEvents.filter(x=>x==='quote-Q').length,2)
  })
  for(const outcome of ['resolve','reject'])test('abandoned '+kind+' '+outcome+' cannot replace the next quote or its edits',async()=>{
    const gate=deferred();f.gates[kind+'-Q']=gate;await mount(quotePath('Q'));await go(quotePath('R'));assertQuote('R')
    await fill(one('e.g. 56909'),'Keep R edit')
    await act(async()=>outcome==='resolve'?gate.resolve():gate.reject(Error('Abandoned Q failure')));await flush()
    assertQuote('R');assert.equal(one('e.g. 56909').value,'Keep R edit');assert.equal(alert(),'')
    if(kind==='quote')assert.equal(f.readEvents.includes('quoteItems-Q'),false)
  })
}
test('quote startup also waits for common customer data; late URL prefill cannot replace the quoted company',async()=>{
 f.gates['customers-all']=deferred();await mount(quotePath('Q')+'&customer_id=customer-B');assertQuoteBlocked()
 assert.ok(f.readEvents.includes('quoteItems-Q'))
 await release('customers-all');assertQuote('Q')
 await fill(host.querySelector('select'),'customer-B');await fill(one('Unit price'),'3.125')
 const reads=[...f.readEvents];await go(quotePath('Q')+'&customer_id=customer-B&invoice=1')
 assert.equal(host.querySelector('select').value,'customer-B');assert.equal(one('Unit price').value,'3.125');assert.deepEqual(f.readEvents,reads)
})
test('optional catalogue failure preserves its existing empty-catalogue fallback and quote defaults',async()=>{
 f.faults['catalogue-all']=Error('Fictional optional catalogue unavailable');await mount(quotePath('Q'));assertQuote('Q');assert.equal(alert(),'')
})
test('retry abandons other reads from the failed attempt, protecting edits after the fresh attempt succeeds',async()=>{
 const oldCustomers=deferred();f.gates['customers-all']=oldCustomers;f.faults['quoteItems-Q']=Error('Fictional failed items')
 await mount(quotePath('Q'));assertQuoteBlocked();assert.ok(retry())
 delete f.gates['customers-all'];f.faults={};await click(retry());assertQuote('Q')
 await fill(host.querySelector('select'),'customer-B');await fill(one('e.g. 56909'),'Fresh edited PO')
 await act(async()=>oldCustomers.resolve());await flush()
 assert.equal(host.querySelector('select').value,'customer-B');assert.equal(one('e.g. 56909').value,'Fresh edited PO')
})
for(const kind of ['quote','quoteItems'])test('leaving a pending '+kind+' for a saved order or manual form discards the result',async()=>{
 f.gates[kind+'-Q']=deferred();await mount(quotePath('Q'));await go('/shipments/B');assertOrder('B');await release(kind+'-Q');assertOrder('B')
 f.gates[kind+'-R']=deferred();await go(quotePath('R'));await go('/shipments/new');await release(kind+'-R')
 assert.equal(one('Item code'),null);assert.equal(one('e.g. 56909').value,'');assert.equal(submit().disabled,true)
})
for(const [name,patch] of [
 ['missing quote',{'quote-Q':null}],
 ['uploaded quote',{'quote-Q':{quote_type:'uploaded'}}],
 ['incomplete Range price',{'quoteItems-Q':[{product_collection:'range_products',product_id:'range-Q',tiers:[{quantity:100,price:0}]}]}],
 ['incomplete Range quantity',{'quoteItems-Q':[{product_collection:'range_products',product_id:'range-Q',tiers:[{quantity:'',price:1.222}]}]}],
])test(name+' keeps its established validation message and blocks conversion until corrected',async()=>{
 Object.assign(f.faults,patch);await mount(quotePath('Q'));assertQuoteBlocked();assert.ok(alert());assert.ok(retry())
 f.faults={};await click(retry());assertQuote('Q')
})
test('an empty quote finishes loading and still permits manual lines with its existing warning',async()=>{
 f.faults['quoteItems-Q']=[];await mount(quotePath('Q'))
 assert.match(host.textContent,/That quote has no product lines yet — add lines manually/);assert.equal(alert(),'');assert.equal(submit().disabled,true)
 assert.equal(one('e.g. UC4950/26').value,'UC100/26');assert.equal(host.querySelector('select').value,'customer-A')
 await click([...host.querySelectorAll('button')].find(b=>b.textContent==='+ Add line'));assert.ok(one('Item code'))
 assert.deepEqual(f.batches,[])
})
test('quote fallback fields and first-tier exact prices/units/images retain the existing projection',async()=>{
 f.faults['quote-Q']={ref_no:'PO-not-a-UC'}
 f.faults['quoteItems-Q']=[{product_id:'range-Q',product_collection:'range_products',product_variant_sku:'SKU-ROS',product_name:'Fictional Range Rosaline',product_unit:'set',hero_image:'https://fictional.invalid/original.png',tiers:[{quantity:500,price:14.222,remarks:'Original tier note'},{quantity:1000,price:12.345}]}]
 await mount(quotePath('Q')+'&customer_id=customer-B')
 assert.equal(host.querySelector('select').value,'customer-B');assert.equal(one('e.g. UC4950/26').value,'')
 assert.equal(one('Item code').value,'SKU-ROS');assert.equal(one('Qty').value,'500');assert.equal(one('Unit price').value,'14.222');assert.equal(one('pcs').value,'set')
 assert.equal(one('Tier remarks (customer-facing)').value,'Original tier note');assert.ok(host.querySelector('img[src="https://fictional.invalid/original.png"]'))
 assert.equal(submit().disabled,false);assert.equal(host.querySelector('textarea[placeholder^="Prints on"]').value,'')
})

test('mandatory customer startup failure gets a quote Retry without applying partial quote fields',async()=>{
 f.faults['customers-all']=Error('Fictional customer data unavailable');await mount(quotePath('Q'));assertQuoteBlocked();assert.match(alert(),/customer data unavailable/)
 f.faults={};await click(retry());assertQuote('Q')
})
