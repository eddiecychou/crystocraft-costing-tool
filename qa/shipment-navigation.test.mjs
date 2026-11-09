// Real controlled page header plus real form/Router integration. Every external
// service is fictional; unexpected writes, allocation and network calls throw.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'FileReader']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import('react-router-dom')
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
let scratch, Header, Page, host, root, f, navigate, route, originalError, originalFetch, errors
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const record = id => ({
  customer_id: 'customer-' + id, customer_name: 'Fictional Customer ' + id,
  customer_po: 'PO-' + id, erp_so_no: 'SO-' + id, erp_si_no: 'SI-' + id,
  uc_no: 'UC-' + id, currency: 'USD', status: 'draft', incoterm: 'FOB',
  notes: 'Notes ' + id, destination: { country: 'Country ' + id },
})
const stubs = {
  firebase: 'export const db={},storage={};export const authHeader=async()=>{throw Error("No network access")}',
  firestore: `const f=()=>globalThis.__shipmentNavigation;
    export const doc=(...p)=>Object.assign(p,{id:p.at(-1)}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{};
    export const getDoc=async p=>{if(!p.includes('orders'))throw Error('Unexpected document read');const id=p.at(-1);f().reads.push(id);return{id,exists:()=>true,data:()=>({...f().record(id),...f().overrides})}};
    export const getDocs=async raw=>{const p=raw.flat();if(p.includes('range_products'))return{docs:[]};if(!p.includes('orders'))throw Error('Unexpected collection read');const id=p[p.indexOf('orders')+1];return{docs:[{id:'line-'+id,data:()=>({line_no:1,item_code:'ITEM-'+id,description:'Fictional item '+id,qty_ordered:10,unit:'pcs',unit_price:1.222,line_type:'ad_hoc'})}]}};
    export {getDoc as getDocFromServer,getDocs as getDocsFromServer};
    export const onSnapshot=()=>()=>{},serverTimestamp=()=> 'FICTIONAL timestamp';
    export const writeBatch=()=>{const operations=[];const add=(kind,path,data)=>{if(!f().allowSave)throw Error('No fictional save authorized');operations.push({kind,path,data})};return{update:(p,d)=>add('update',p,d),set:(p,d)=>add('set',p,d),delete:p=>add('delete',p),commit:async()=>{const state=f();state.batches.push(operations);if(state.saveGate)await state.saveGate.promise}}};
    const fail=()=>{throw Error('No database writes or allocation authorized')};export{fail as runTransaction,fail as addDoc,fail as updateDoc,fail as deleteDoc};`,
  customer: `export const loadCustomers=async()=>['A','B'].map(id=>({id:'customer-'+id,company_name:'Fictional Customer '+id}));export const getCustomer=async id=>(await loadCustomers()).find(x=>x.id===id)||null;export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error('No customer writes')};`,
  criticalComponents: 'export const buildProductIndex=()=>new Map();export const matchProductCode=()=>null;',
  soNumber: 'export const JES_SEED_BY_YEAR={};export const soYear=()=>"26";const fail=()=>{throw Error("No number allocation")};export{fail as allocateSoNo,fail as formatSoNo}',
  ucRegistry: 'const fail=()=>{throw Error("No financial access")};export{fail as upsertInvoice,fail as allocateOrderUc,fail as allocateInvoice,fail as updateUcInvoice};',
  storage: 'const fail=()=>{throw Error("No storage access")};export{fail as ref,fail as uploadBytes,fail as getDownloadURL}',
  erpSoImport: 'const fail=()=>{throw Error("No ERP access")};export{fail as fetchErpSoLines,fail as diffLines}',
  crystals: 'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}}',
  packaging: 'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}}',
  orderStock: 'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}}',
  ConfirmDialog: 'export default()=>null', LineImagePicker: 'export default()=>null',
  PackingListEditor: `import React from 'react';export default({orderId,orderLines})=>React.createElement('div',{'data-fictional-packing':orderId,'data-line-price':orderLines[0]?.unit_price},'Fictional packing editor')`,
  FreightComparison: `import React from 'react';export default({orderId})=>React.createElement('div',{'data-fictional-freight':orderId},'Fictional freight comparison')`,
  OrderStockIssue: 'export default()=>null', OrderInventoryIssue: 'export default()=>null',
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipment-navigation-'))
  await build({ stdin: { contents: 'export{default as Header}from"./src/components/shipping/ShipmentPageHeader.jsx";export{default as Page}from"./src/pages/ShipmentForm.jsx";', resolveDir: process.cwd(), loader: 'jsx' }, outfile: join(scratch, 'pages.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fictional-navigation-boundaries', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, a => ({ path: a.path.split('/')[1], namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => { const name = basename(a.path).replace(/\.jsx?$/, ''); if (name in stubs) return { path: name, namespace: 'fixture' } })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: process.cwd() }))
  } }] })
  ;({ Header, Page } = await import(pathToFileURL(join(scratch, 'pages.mjs'))))
  originalFetch = globalThis.fetch; globalThis.fetch = () => { throw Error('Network forbidden') }
})
beforeEach(() => {
  f = globalThis.__shipmentNavigation = { record, reads: [], overrides: {}, raised: 0, tabs: [], batches: [] }
  errors = []; originalError = console.error; console.error = (...args) => errors.push(args.map(String).join(' '))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []) }
  finally { console.error = originalError; host.remove(); delete globalThis.__shipmentNavigation }
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const button = label => [...host.querySelectorAll('button')].find(x => x.textContent.trim() === label)
const link = label => [...host.querySelectorAll('a')].find(x => x.textContent.trim() === label)
const click = async element => { assert.ok(element); await act(async () => element.click()); await flush() }
const one = placeholder => host.querySelector('[placeholder="' + placeholder + '"]')
const fill = async (element, value) => { assert.ok(element); await act(async () => { element.value = value; Simulate.change(element, { target: { value } }) }) }
const props = override => ({ id: 'fictional-order', isEdit: true, isDirect: false, invoiceNo: '', ucNo: '', allocatingSi: false, saving: false, siError: '', onRaiseInvoice: () => { f.raised++ }, tab: 'order', onTabChange: value => f.tabs.push(value), ...override })
const renderHeader = async override => { await act(async () => root.render(React.createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(Header, props(override))))); await flush() }
function Bridge() { navigate = useNavigate(); route = useLocation().pathname; return null }
const mountForm = async (path = '/shipments/A') => {
  const element = React.createElement(Page)
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path], future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(Bridge), React.createElement(Routes, null,
    React.createElement(Route, { path: '/shipments/new', element }), React.createElement(Route, { path: '/shipments/:id', element }), React.createElement(Route, { path: '/shipments', element: React.createElement('p', null, 'Order listing') }),
  )))); await flush()
}
const go = async path => { await act(async () => navigate(path)); await flush() }

test('new order title and PI help keep the listing link without saved-order controls', async () => {
  await renderHeader({ isEdit: false, id: undefined })
  assert.equal(host.querySelector('h1').textContent.trim(), 'New Order')
  assert.match(host.textContent, /Enter the order directly, or drop a PI below/)
  assert.equal(link('← Order Listing').getAttribute('href'), '/shipments')
  assert.equal(host.querySelectorAll('a').length, 1); assert.equal(host.querySelectorAll('button').length, 0)
  assert.equal(f.raised, 0); assert.deepEqual(f.tabs, []); assert.deepEqual(f.reads, [])
})
test('direct invoice has its own title and retail help without a proforma or saved tabs', async () => {
  await renderHeader({ isEdit: false, isDirect: true, id: undefined })
  assert.equal(host.querySelector('h1').textContent.trim(), 'Direct Invoice')
  assert.match(host.textContent, /A retail sale invoiced directly — no sales order needed/)
  assert.equal(link('Proforma Invoice'), undefined); assert.equal(button('Raise Invoice'), undefined)
  assert.equal(button('Packing List'), undefined); assert.equal(f.raised, 0)
})
test('saved order uses UC then fallback title and preserves the proforma target attributes', async () => {
  await renderHeader({ ucNo: 'UC4950/26' })
  assert.equal(host.querySelector('h1').textContent.trim(), 'UC4950/26')
  const pi = link('Proforma Invoice')
  assert.equal(pi.getAttribute('href'), '/shipments/fictional-order/pi'); assert.equal(pi.target, '_blank'); assert.equal(pi.rel, 'noreferrer')
  assert.equal(button('Raise Invoice').type, 'button'); assert.equal(link('Invoice'), undefined)
  assert.doesNotMatch(host.textContent, /Enter the order directly|A retail sale invoiced directly/)
  await renderHeader()
  assert.equal(host.querySelector('h1').textContent.trim(), 'Order Detail')
})
test('saved invoice takes title precedence and links to its exact invoice without a Raise action', async () => {
  await renderHeader({ invoiceNo: 'SI260094', ucNo: 'UC4950/26' })
  assert.equal(host.querySelector('h1').textContent.trim(), 'SI260094')
  const invoice = link('Invoice SI260094')
  assert.equal(invoice.getAttribute('href'), '/shipments/fictional-order/invoice'); assert.equal(invoice.target, '_blank'); assert.equal(invoice.rel, 'noreferrer')
  assert.equal(button('Raise Invoice'), undefined); assert.equal(f.raised, 0)
})
test('Raise is an explicit callback only, with raising, saving and error presentation controlled by the parent', async () => {
  await renderHeader(); assert.equal(f.raised, 0); await click(button('Raise Invoice')); assert.equal(f.raised, 1)
  await renderHeader({ allocatingSi: true }); assert.equal(button('Raising…').disabled, true)
  await click(button('Raising…')); assert.equal(f.raised, 1)
  await renderHeader({ saving: true, siError: 'Fictional invoice allocation error' })
  assert.equal(button('Raise Invoice').disabled, true); await click(button('Raise Invoice')); assert.equal(f.raised, 1)
  assert.match(host.textContent, /Fictional invoice allocation error/)
  for (const label of ['Order & Lines', 'Packing List', 'Freight']) assert.equal(button(label).disabled, true)
  await click(button('Packing List')); assert.deepEqual(f.tabs, [])
})
test('each tab delegates its value once and active presentation follows the controlled tab prop', async () => {
  await renderHeader({ tab: 'packing' })
  assert.match(button('Packing List').className, /border-brand-600/)
  assert.match(button('Order & Lines').className, /border-transparent/)
  for (const label of ['Order & Lines', 'Packing List', 'Freight']) { assert.equal(button(label).type, 'button'); await click(button(label)) }
  assert.deepEqual(f.tabs, ['order', 'packing', 'freight']); assert.equal(f.raised, 0)
})
test('real parent retains unsaved order and line edits across Packing List, Freight and return tabs', async () => {
  await mountForm(); await fill(one('e.g. 56909'), 'Unsaved PO 中文'); await fill(one('Unit price'), '3.125')
  await click(button('Packing List'))
  assert.equal(one('e.g. 56909'), null)
  const packing = host.querySelector('[data-fictional-packing]')
  assert.equal(packing.getAttribute('data-fictional-packing'), 'A'); assert.equal(packing.getAttribute('data-line-price'), '3.125')
  await click(button('Freight')); assert.equal(host.querySelector('[data-fictional-freight]').getAttribute('data-fictional-freight'), 'A')
  await click(button('Order & Lines'))
  assert.equal(one('e.g. 56909').value, 'Unsaved PO 中文'); assert.equal(one('Unit price').value, '3.125')
  assert.equal(host.querySelector('h1').textContent.trim(), 'SI-A')
})
test('real route transition resets tab ownership and cannot carry edited A fields or child IDs into B', async () => {
  await mountForm(); await fill(one('e.g. 56909'), 'Unsaved A PO'); await click(button('Freight'))
  await go('/shipments/B')
  assert.equal(route, '/shipments/B'); assert.equal(host.querySelector('h1').textContent.trim(), 'SI-B')
  assert.equal(one('e.g. 56909').value, 'PO-B'); assert.equal(one('Item code').value, 'ITEM-B')
  assert.equal(host.querySelector('[data-fictional-freight]'), null)
  await click(button('Packing List')); assert.equal(host.querySelector('[data-fictional-packing]').getAttribute('data-fictional-packing'), 'B')
})
test('real parent passes its legacy UC fallback to the header and keeps Raise explicit', async () => {
  f.overrides = { erp_si_no: '', uc_no: '', erp_pi_no: 'UC-LEGACY-FICTIONAL' }
  await mountForm()
  assert.equal(host.querySelector('h1').textContent.trim(), 'UC-LEGACY-FICTIONAL')
  assert.ok(button('Raise Invoice')); assert.equal(one('e.g. UC4950/26').value, 'UC-LEGACY-FICTIONAL')
  assert.equal(f.raised, 0)
})
test('real parent forwards pending-save state to header allocation and navigation controls', async () => {
  f.overrides = { erp_si_no: '' }; f.allowSave = true; f.saveGate = deferred()
  await mountForm(); await click(host.querySelector('button[type="submit"]'))
  assert.equal(f.batches.length, 1); assert.equal(button('Raise Invoice').disabled, true)
  for (const label of ['Order & Lines', 'Packing List', 'Freight']) assert.equal(button(label).disabled, true)
  await click(button('Freight')); assert.equal(host.querySelector('[data-fictional-freight]'), null)
  await act(async () => f.saveGate.reject(Error('Fictional save rejected'))); await flush()
  assert.equal(button('Raise Invoice').disabled, false); assert.equal(button('Freight').disabled, false)
  assert.match(host.querySelector('#shipment-form-error').textContent, /Fictional save rejected/)
})
