// Real Shipping, Sales Invoices, vendor form and application route gates.
// All business records and service boundaries are fictional.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { resolve, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fictional.invalid' })
for (const name of ['window', 'document', 'HTMLElement', 'MouseEvent']) globalThis[name] = dom.window[name]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const fixtures = {
  app: [{ id: 'fictional-order', erp_so_no: 'SO260050', erp_si_no: 'SI260050', customer_name: 'Fictional OC buyer', customer_id: 'synthetic', status: 'confirmed', order_date: '2026-11-01', total_amount: 100, currency: 'USD' }],
  sales_order: [{ code: ' so260050 ', customer: 'Duplicate ERP order' }, { code: 'SO250100', customer: 'Fictional ERP order buyer', date: '2025-11-01' }],
  sales_invoice: [{ code: ' si260050 ', customer: 'Duplicate ERP invoice' }, { code: 'SI250100', customer: 'Fictional ERP invoice buyer', date: '2025-11-01' }],
  vendor: { id: 'fictional-vendor', name: 'Fictional forwarder', modes: [], incoterms_supported: [], contacts: [], coverage: [] },
}
let app, root, host, calls, originalFetch, scratch
const profile = (role, modules = []) => ({ role, status: 'approved', modules })
const pass = 'export default ({children})=>children??null'
const fail = '()=>{throw Error("Unexpected write in the Shipping routing test")}'
const stubs = {
  useAuthState: 'export const useAuthState=()=>globalThis.fixture.profile?{uid:"fictional"}:null',
  firebase: 'export const db={};',
  firestore: `export const doc=(...args)=>args; export const onSnapshot=(_path,next)=>{next({id:'fictional',exists:()=>true,data:()=>globalThis.fixture.profile});return()=>{}}`,
  Layout: pass, CustomerLayout: pass, ErrorBoundary: pass,
  store: `export const CartProvider=${pass.split('default ')[1]}, FavouritesProvider=CartProvider`,
  shipping: `import{orderStatusOf,orderUc,orderSi,orderSoDisplay,NO_INVOICE_REASONS,noInvoiceReasonOf}from './src/shippingModel.js';export{orderStatusOf,orderUc,orderSi,orderSoDisplay,NO_INVOICE_REASONS,noInvoiceReasonOf};export const useOrders=()=>({orders:globalThis.fixture.app,loading:false}),updateOrder=${fail}`,
  invoiceReconciliation: `export const getOrderForInvoiceSync=${fail}, invoiceReconciliation=()=>null, isFinancialInvoiceNo=()=>false, financialOrderSource=()=>''`,
  ucRegistry: `export const listAppInvoicesForReconciliation=async()=>[],upsertInvoiceStrict=${fail}`,
  logistics: `export const useVendors=()=>({vendors:globalThis.fixture.vendor?[globalThis.fixture.vendor]:[],loading:false}), getVendor=async id=>{globalThis.fixture.calls.push('vendor:'+id);return globalThis.fixture.vendor}, saveVendor=${fail},deleteVendor=async id=>{const f=globalThis.fixture;if(id!==f.vendor?.id)throw Error('Expected fictional vendor');f.calls.push('delete:'+id);f.vendor=null}, FREIGHT_MODES=[],COVERAGE_STRENGTH=[],FREIGHT_INCOTERMS=[],modeLabel=v=>v,strengthOf=()=>({})`,
  orderCreateRequest: `export const beginOrderCopy=${fail},orderRequestAction=${fail}`,
  customer: 'export const useCustomers=()=>({customers:[]})',
  erpApi: `export const erpLookup=async(entity,filters)=>{globalThis.fixture.calls.push([entity,filters.q]);return globalThis.fixture[entity]};export const erpLines=async(of,id)=>{globalThis.fixture.calls.push([of,id]);return {rows:[{seq:1,item_code:'FICT-ARCHIVE-ITEM',description:'Fictional ERP line',qty:7,unit:'pcs',unit_price:3}],surcharges:[]}}`,
}
const real = new Set(['App', 'Storefront', 'Shipping', 'SalesInvoices', 'LogisticsVendorForm', 'ErpDocModal', 'i18n', 'access', 'useProfile'])
const routeOutput = name => `import React from 'react';import{useParams}from 'react-router-dom';export default function RouteProbe(){return React.createElement('div',{'data-route':${JSON.stringify(name)}},JSON.stringify(Object.fromEntries(Object.entries(useParams()).filter(([key])=>key!=='*'))))}`
before(async () => {
  const result = await build({ entryPoints: ['src/App.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', external: [], plugins: [{ name: 'local-route-fixture',setup(builder) {
    builder.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, args => ({ path: require.resolve(args.path), external: true }))
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'fixture' }))
    builder.onResolve({ filter: /^\./ }, args => {
      if (args.namespace === 'fixture') return
      const name = basename(args.path).replace(/\.jsx?$/, '')
      if (Object.hasOwn(stubs, name)) return { path: name, namespace: 'fixture' }
      if (real.has(name) || !/(?:^|\/)(?:pages|customer|components)\//.test(resolve(args.resolveDir, args.path))) return
      return { path: name, namespace: 'fixture' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] ?? routeOutput(args.path), loader: 'js', resolveDir: process.cwd() }))
  }}] })
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipping-routes-'))
  const bundle = join(scratch, 'routes-bundle.mjs')
  await writeFile(bundle, result.outputFiles[0].text)
  app = (await import(pathToFileURL(bundle).href)).default
  originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('Network forbidden in this fixture') }
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })
const settle = async (ms = 0) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) }) }
async function withPage(path, who, check) {
  calls = []
  globalThis.fixture = { ...fixtures, profile: who, calls }
  window.history.replaceState({}, '', path)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  try { await act(async () => root.render(React.createElement(app))); await settle(); await check() }
  finally { await act(async () => root.unmount()); host.remove(); delete globalThis.fixture }
}
const pathIs = path => assert.equal(window.location.pathname + window.location.search, path)
const click = async elem => { assert.ok(elem); await act(async () => elem.click()); await settle() }
const h1 = () => host.querySelector('h1')?.textContent
const route = (name, params) => assert.equal(host.querySelector(`[data-route="${name}"]`)?.textContent, JSON.stringify(params))
const buttons = txt => [...host.querySelectorAll('button')].find(x => x.textContent.trim() === txt)
const link = txt => [...host.querySelectorAll('a')].find(x => x.textContent.trim() === txt)
const vendorLink = () => host.querySelector('a[href="/logistics/fictional-vendor"]')
const staff = profile('staff', ['shipping'])
const admin = profile('admin')
const customer = profile('customer')

test('old Shipping aliases and the canonical URL open the intended list', async () => {
  for (const [path, destination, active] of [
    ['/shipments', '/shipping', 'Orders'],
    ['/logistics', '/shipping?tab=logistics', 'Logistics'],
    ['/shipping?tab=logistics', '/shipping?tab=logistics', 'Logistics'],
    ['/shipping?tab=unknown', '/shipping?tab=unknown', 'Orders'],
  ]) await withPage(path, staff, () => {
    pathIs(destination)
    assert.equal(h1(), 'Production')
    assert.equal(buttons(active).getAttribute('aria-pressed'), 'true')
    assert.equal(Boolean(vendorLink()), active === 'Logistics')
  })
})

test('vendor detail and creation both return to Logistics through the old URL', async () => {
  await withPage('/shipping', staff, async () => {
    await click(buttons('Logistics'))
    pathIs('/shipping?tab=logistics')
    await click(vendorLink())
    pathIs('/logistics/fictional-vendor')
    assert.equal(h1(), 'Edit Vendor')
    assert.deepEqual(calls.filter(x => typeof x === 'string'), ['vendor:fictional-vendor'])
    await click(link('← Logistics'))
    pathIs('/shipping?tab=logistics')
    assert.equal(buttons('Logistics').getAttribute('aria-pressed'), 'true')
    assert.ok(vendorLink())
    await click(link('+ New Vendor'))
    pathIs('/logistics/new')
    assert.equal(h1(), 'New Logistics Vendor')
    await click(link('← Logistics'))
    pathIs('/shipping?tab=logistics')
    assert.ok(vendorLink())
  })
})

test('vendor deletion returns to the Logistics list', async () => {
  const confirm = window.confirm
  window.confirm = () => true
  try {
    await withPage('/logistics/fictional-vendor', staff, async () => {
      await click(buttons('Delete'))
      pathIs('/shipping?tab=logistics')
      assert.equal(buttons('Logistics').getAttribute('aria-pressed'), 'true')
      assert.equal(vendorLink(), null)
      assert.deepEqual(calls.filter(x => typeof x === 'string'), ['vendor:fictional-vendor', 'delete:fictional-vendor'])
    })
  } finally { window.confirm = confirm }
})

test('tab links keep unrelated query parameters and restore selection from browser history', async () => {
  await withPage('/shipping?source=fictional', staff, async () => {
    await click(buttons('Logistics'))
    pathIs('/shipping?source=fictional&tab=logistics')
    await click(buttons('Requirements'))
    pathIs('/shipping?source=fictional&tab=requirements')
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)) })
    pathIs('/shipping?source=fictional&tab=logistics')
    assert.equal(buttons('Logistics').getAttribute('aria-pressed'), 'true')
    await click(buttons('Orders'))
    pathIs('/shipping?source=fictional')
    assert.equal(buttons('Orders').getAttribute('aria-pressed'), 'true')
  })
})

test('entry query flags, saved IDs and staff print shapes resolve through original gates', async () => {
  await withPage('/shipments', staff, async () => {
    const order = [...host.querySelectorAll('tr')].find(row => row.textContent.includes('Fictional OC buyer'))
    await click(order)
    pathIs('/shipments/fictional-order')
    route('ShipmentForm', { id: 'fictional-order' })
  })
  for (const [url, leaf, params, role] of [
    ['/shipments/new?direct=1', 'NewShipmentEntry', {}, staff],
    ['/shipments/new?from_quote=fictional-quote', 'NewShipmentEntry', {}, staff],
    ['/shipments/fictional-order?invoice=1', 'ShipmentForm', {id:'fictional-order'},staff],
    ['/shipments/woo-99999', 'ShipmentForm', {id:'woo-99999'},staff],
    ['/shipments/fictional-order/pi', 'ProformaInvoicePrint', {id:'fictional-order'},staff],
    ['/shipments/fictional-order/invoice', 'SalesInvoicePrint', {id:'fictional-order'},profile('staff',['invoices'])],
    ['/packing/fictional-scenario/print', 'PackingListPrint', {plId:'fictional-scenario'},staff],
  ]) await withPage(url, role, () => { pathIs(url); route(leaf,params) })
})
test('the customer tree rejects staff links and retains its own invoice URL', async () => {
  for (const url of ['/shipments','/logistics','/shipments/fictional-order','/shipments/fictional-order/pi','/shipments/fictional-order/invoice','/sales-invoices','/packing/fictional-scenario/print']) await withPage(url, customer, () => { pathIs('/shop'); route('HomePage',{}); assert.deepEqual(calls,[]) })
  await withPage('/shop/invoice/fictional-si', customer, () => route('CustomerInvoicePrint',{key:'fictional-si'}))
  await withPage('/shipments/fictional-order/invoice', staff, () => { pathIs('/dashboard'); route('ProductionDashboard',{}) })
  await withPage('/shipments/fictional-order', null, () => { pathIs('/login'); route('Login',{}) })
})
test('JES order and invoice archives dedupe on number and open read-only source details', async () => {
  for (const [path, entity, number, dupe, original] of [
    ['/shipping','sales_order','SO250100','Duplicate ERP order','Fictional ERP order buyer'],
    ['/sales-invoices','sales_invoice','SI250100','Duplicate ERP invoice','Fictional ERP invoice buyer'],
  ]) await withPage(path, admin, async () => {
    await settle(340)
    assert.match(host.textContent,/Fictional OC buyer/); assert.ok(!host.textContent.includes(dupe))
    const row=[...host.querySelectorAll('tr')].find(x=>x.textContent.includes(original)); assert.ok(row)
    assert.equal(row.querySelector('button,a'),null)
    await click(row.querySelector('td')); assert.match(host.textContent,/Fictional ERP line/)
    assert.deepEqual(calls, [[entity,''],[entity,number]]); pathIs(path)
  })
})
test('invoice-only staff cannot see Direct Invoice or open the Shipping form by URL', async () => {
  const invoiceOnly = profile('staff', ['invoices'])
  await withPage('/sales-invoices', invoiceOnly, () => {
    assert.equal(h1(), 'Sales Invoices')
    assert.equal(link('Direct Invoice'), undefined)
    assert.equal(host.querySelector('a[href="/shipments/new?direct=1"]'), null)
  })
  await withPage('/shipments/new?direct=1', invoiceOnly, () => {
    pathIs('/dashboard')
    route('Dashboard', {})
  })
  await withPage('/logistics', invoiceOnly, () => {
    pathIs('/dashboard')
    assert.equal(vendorLink(), null)
  })
})

test('admin and staff with Shipping and Invoices can still open Direct Invoice', async () => {
  for (const role of [admin, profile('staff', ['shipping', 'invoices'])]) {
    await withPage('/sales-invoices', role, async () => {
      await click(link('Direct Invoice'))
      pathIs('/shipments/new?direct=1')
      route('NewShipmentEntry', {})
    })
  }
})
