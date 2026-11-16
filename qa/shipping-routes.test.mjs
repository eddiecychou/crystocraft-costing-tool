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
  firebase: 'export const db={};export const authedUser=async()=>({uid:"fictional",getIdToken:async()=>"fictional-token"});',
  firestore: `export const doc=(...args)=>args; export const onSnapshot=(_path,next)=>{next({id:'fictional',exists:()=>true,data:()=>globalThis.fixture.profile});return()=>{}}`,
  Layout: pass, CustomerLayout: pass, ErrorBoundary: pass,
  store: `export const CartProvider=${pass.split('default ')[1]}, FavouritesProvider=CartProvider`,
  shipping: `import{useState}from 'react';import{orderStatusOf,orderUc,orderSi,orderSoDisplay,NO_INVOICE_REASONS,noInvoiceReasonOf}from './src/shippingModel.js';export{orderStatusOf,orderUc,orderSi,orderSoDisplay,NO_INVOICE_REASONS,noInvoiceReasonOf};
  export function useOrders({enabled=true}={}){const[attempt,setAttempt]=useState(0);const f=globalThis.fixture;
    return {orders:enabled?f.app:[],loading:!!f.appLoading,error:!attempt&&f.appError,fromCache:!attempt&&f.fromCache,retry:()=>setAttempt(n=>n+1)};
  }export const updateOrder=${fail}`,
  invoiceReconciliation: `export const getOrderForInvoiceSync=${fail}, invoiceReconciliation=()=>null, isFinancialInvoiceNo=()=>false, financialOrderSource=()=>''`,
  ucRegistry: `export const listAppInvoicesForReconciliation=async()=>[],upsertInvoiceStrict=${fail}`,
  logistics: `export const useVendors=()=>({vendors:globalThis.fixture.vendor?[globalThis.fixture.vendor]:[],loading:false}), getVendor=async id=>{globalThis.fixture.calls.push('vendor:'+id);return globalThis.fixture.vendor}, saveVendor=${fail},deleteVendor=async id=>{const f=globalThis.fixture;if(id!==f.vendor?.id)throw Error('Expected fictional vendor');f.calls.push('delete:'+id);f.vendor=null}, FREIGHT_MODES=[],COVERAGE_STRENGTH=[],FREIGHT_INCOTERMS=[],modeLabel=v=>v,strengthOf=()=>({})`,
  orderCreateRequest: `export const beginOrderCopy=${fail},orderRequestAction=${fail}`,
  useOcInvoiceSummaries: `export default enabled=>{const f=globalThis.fixture;return {rows:enabled?f.summaries:undefined,error:enabled&&f.summaryError,retry:()=>{}}}`,
  CustomerFilePreview: `import React from 'react';export default ({title,actions})=>React.createElement('div',{role:'dialog','aria-label':title},actions)`,
  customer: 'export const useCustomers=()=>({customers:[]})',
  erpApi: `export const erpLookup=async(entity,filters)=>{const f=globalThis.fixture;f.calls.push([entity,filters.q]);if(f.erpFailure)throw Error('Fictional archive failure');return f[entity]};export const erpLines=async(of,id)=>{globalThis.fixture.calls.push([of,id]);return {rows:[{seq:1,item_code:'FICT-ARCHIVE-ITEM',description:'Fictional ERP line',qty:7,unit:'pcs',unit_price:3}],surcharges:[]}}`,
}
const real = new Set(['App', 'Storefront', 'Shipping', 'SalesInvoices', 'InvoiceOriginalButton', 'LogisticsVendorForm', 'ErpDocModal', 'ExportFilterBar', 'i18n', 'access', 'useProfile'])
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
async function withPage(path, who, check, overrides) {
  calls = []
  globalThis.fixture = { ...fixtures, profile: who, calls, ...overrides }
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
    assert.match(host.textContent, /OC invoice summariesUnavailable/)
    assert.match(host.textContent, /JES historyUnavailable with this account\. ERP access is required/)
    assert.ok(!host.textContent.includes('No invoices match'))
    assert.ok(buttons('Export OC CSV').disabled)
    assert.equal(buttons('Refresh financial check'), undefined)
    assert.deepEqual(calls, [])
  }, { summaryError: new Error('Fictional summary read failed') })
  await withPage('/shipments/new?direct=1', invoiceOnly, () => {
    pathIs('/dashboard')
    route('Dashboard', {})
  })
  await withPage('/logistics', invoiceOnly, () => {
    pathIs('/dashboard')
    assert.equal(vendorLink(), null)
  })
})

const selectSource = async source => {
  const select = [...host.querySelectorAll('select')].find(el => el.parentElement.textContent.startsWith('Source'))
  assert.ok(select)
  await act(async () => { select.value = source; select.dispatchEvent(new window.Event('change', {bubbles:true})) })
}

async function downloadedCsv(label) {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, trigger = window.HTMLAnchorElement.prototype.click
  let blob, name
  URL.createObjectURL = data => { blob = data; return 'blob:fictional' }
  URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function () { name = this.download }
  try {
    assert.equal(buttons(label)?.disabled, false)
    await click(buttons(label))
    return { name, text: await blob.text() }
  } finally {
    URL.createObjectURL = create; URL.revokeObjectURL = revoke; window.HTMLAnchorElement.prototype.click = trigger
  }
}

test('Invoices and ERP staff must select JES and the CSV identifies the only included source', async () => {
  await withPage('/sales-invoices', profile('staff', ['invoices', 'erp']), async () => {
    await settle(340)
    assert.ok(buttons('Export OC + JES CSV').disabled)
    assert.match(host.textContent, /Select JES history in Source/)
    assert.ok(!host.textContent.includes('0 in the app'))
    await selectSource('jes')
    const csv = await downloadedCsv('Export JES CSV')
    assert.equal(csv.name, 'sales-invoices_jes.csv')
    assert.match(csv.text, /"Source"/)
    assert.match(csv.text, /SI250100/)
    assert.doesNotMatch(csv.text, /Fictional OC buyer/)
  }, { summaryError: new Error('Fictional summary read failed') })
})

test('invoice-only staff see read-only OC summaries and export only the displayed minimum fields', async () => {
  const summary = { no:'SI260052', date:'2026-10-09', customer:'Fictional summary buyer', currency:'USD',
    status:'ISSUED', amount:null, documentStatus:'Original unavailable' }
  await withPage('/sales-invoices', profile('staff', ['invoices']), async () => {
    assert.match(host.textContent, /Original unavailable/)
    assert.match(host.textContent, /Fictional summary buyer/)
    assert.ok(!host.textContent.includes('Fictional OC buyer'))
    assert.equal(host.querySelector('td a'), null)
    assert.equal(link('Direct Invoice'), undefined)
    assert.equal(buttons('Refresh financial check'), undefined)
    assert.equal(host.querySelector('tr td:nth-last-child(2)').textContent, '—')
    const csv = await downloadedCsv('Export OC summary CSV')
    assert.equal(csv.name, 'sales-invoices-summary_oc.csv')
    const [header, line] = csv.text.trim().split('\r\n')
    assert.equal(header, '"Invoice no.","Invoice date","Customer","Currency","Total","Status","Source","Original document"')
    assert.match(line, /SI260052/)
    assert.match(line, /"USD","","ISSUED","OC","Original unavailable"/)
    assert.deepEqual(calls, [])
  }, { summaries:[summary] })
})

test('invoice-only staff can open only an available exact original and the CSV retains availability labels', async () => {
  const rows = ['Verified original PDF', 'Original unavailable', 'Needs review'].map((documentStatus, i) => ({
    no: `SI26990${i}`, date: '2026-11-16', customer: 'Fictional buyer', currency: 'USD', status: 'ISSUED', amount: 99, documentStatus,
  }))
  const fetchBefore = globalThis.fetch
  const reads = []
  globalThis.fetch = async (url, { headers }) => {
    reads.push([url, headers.Authorization, headers['If-Match']])
    if (reads.length === 2) return Response.json({ error: 'Original unavailable' }, { status: 404 })
    return new Response('%PDF-fictional', { headers: { 'Content-Type': 'application/pdf', ETag: '"fictional-revision"' } })
  }
  try {
    await withPage('/sales-invoices', profile('staff', ['invoices']), async () => {
      assert.equal([...host.querySelectorAll('button')].filter(b => b.textContent.includes('View original')).length, 1)
      assert.match(host.textContent, /Needs review/)
      assert.equal(host.querySelector('td a'), null)
      const csv = await downloadedCsv('Export OC summary CSV')
      for (const row of rows) assert.match(csv.text, new RegExp(`"${row.documentStatus}"`))
      assert.deepEqual(reads, [])
      await act(async () => buttons('View original').click())
      assert.ok(host.querySelector('[role=dialog][aria-label="Original invoice SI269900"]'))
      await act(async () => buttons('Download original').click())
      assert.equal(host.querySelector('[role=dialog]'), null)
      assert.match(host.querySelector('[role=alert]')?.textContent || '', /Original unavailable/)
      assert.deepEqual(reads, [
        ['/api/oc-invoice-summaries?pdf=SI269900', 'Bearer fictional-token', undefined],
        ['/api/oc-invoice-summaries?pdf=SI269900', 'Bearer fictional-token', '"fictional-revision"'],
      ])
    }, { summaries: rows })
  } finally { globalThis.fetch = fetchBefore }
})

test('Shipping and Invoices staff can choose OC without ERP or UC and export their visible rows', async () => {
  await withPage('/sales-invoices', profile('staff', ['invoices', 'shipping']), async () => {
    assert.ok(buttons('Export OC + JES CSV').disabled)
    assert.equal(buttons('Refresh financial check'), undefined)
    await selectSource('app')
    const csv = await downloadedCsv('Export OC CSV')
    assert.equal(csv.name, 'sales-invoices_oc.csv')
    assert.match(csv.text, /"App"/)
    assert.doesNotMatch(csv.text, /SI250100/)
    assert.deepEqual(calls, [])
  })
})

test('admin can export both sources once ready and the choice also filters the visible table', async () => {
  await withPage('/sales-invoices', admin, async () => {
    assert.ok(buttons('Export OC + JES CSV').disabled)
    await settle(340)
    const csv = await downloadedCsv('Export OC + JES CSV')
    assert.equal(csv.name, 'sales-invoices_oc-and-jes.csv')
    assert.match(csv.text, /SI260050/)
    assert.match(csv.text, /SI250100/)
    assert.doesNotMatch(csv.text, /Duplicate ERP invoice/)
    await selectSource('jes')
    assert.ok(!host.textContent.includes('Fictional OC buyer'))
    assert.match((await downloadedCsv('Export JES CSV')).text, /SI250100/)
  })
})

test('source failures block combined export, allow an explicit healthy source and recover on retry', async () => {
  for (const [overrides, failed, healthy, filter] of [
    [{appError:new Error('Fictional order failure')},'OC invoices','JES','jes'],
    [{fromCache:true},'OC invoices','JES','jes'],
    [{erpFailure:true},'JES history','OC','app'],
  ]) await withPage('/sales-invoices', admin, async () => {
    await settle(340)
    assert.ok(buttons('Export OC + JES CSV').disabled)
    assert.ok(!host.textContent.includes('No invoices match'))
    await selectSource(filter)
    assert.match((await downloadedCsv(`Export ${healthy} CSV`)).name, new RegExp('_'+healthy.toLowerCase()+'\\.csv$'))
    await selectSource('')
    globalThis.fixture.erpFailure = false
    await click(buttons('Retry '+failed))
    await settle(340)
    assert.equal(buttons('Export OC + JES CSV')?.disabled, false)
  }, overrides)
})

test('a successful empty result is labelled separately from unavailable sources', async () => {
  await withPage('/sales-invoices', admin, async () => {
    await settle(340)
    assert.match(host.textContent, /No invoices match the current filters/)
    assert.equal(host.querySelector('[role="alert"]'), null)
    assert.ok(buttons('Export OC + JES CSV').disabled)
  }, { app: [], sales_invoice: [] })
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
