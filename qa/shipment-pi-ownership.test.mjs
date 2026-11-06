// Actual ShipmentForm, Router, PI preparation, Shipping and ERP comparison.
// All external reads, extraction, uploads, counters and writes are fictional.
import { test as nodeTest, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'

const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'FileReader']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
// A regression must name and fail its scenario rather than stall the CI worker.
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const piData = id => ({
  customer_name: 'Fictional ' + id, pi_no: id === 'A' ? 'UC5001/26' : 'UC5002/26',
  so_no: id === 'A' ? 'SO260001' : 'SO260002', currency: id === 'A' ? 'USD' : 'EUR',
  payment_terms: 'Terms ' + id,
  lines: [{ item_code: 'PI-ITEM-' + id, description: 'PI line ' + id, qty_ordered: id === 'A' ? 10 : 20, unit: 'pcs', unit_price: id === 'A' ? 1.111 : 2.222 }],
})
const erpRows = code => [{ seq: 1, item_code: 'ERP-' + code, description: 'Fictional ERP line', qty: 99, unit_price: 9.999 }]
let scratch, Page, host, root, f, navigate, currentRoute, errors, originalError, originalFetch
const stubs = {
  firebase: 'export const db={},storage={};export const authHeader=async()=>({Authorization:"Bearer fictional-pi-test"});',
  firestore: `const f=()=>globalThis.__shipmentPiOwnership;
    export const doc=(...p)=>Object.assign(p,{id:typeof p.at(-1)==='string'?p.at(-1):'created-order'}),collection=(...p)=>p,query=(...p)=>p,orderBy=()=>{},where=()=>{},limit=()=>{};
    export const getDoc=async raw=>{
      const p=raw.flat(Infinity);if(!p.includes('orders'))throw Error('Unexpected document read');
      const id=p.at(-1),data=id==='created-order'?f().created.find(x=>!x.path.flat(Infinity).includes('lines'))?.data:{customer_id:'customer-B',customer_name:'Fictional B',customer_po:'SAVED-'+id,erp_so_no:'SO260050',uc_no:'UC5050/26',currency:'USD',status:'draft'};
      return{id,exists:()=>data!=null,data:()=>data};
    };
    export const getDocs=async raw=>{
      const p=raw.flat(Infinity);if(p.includes('range_products'))return{docs:[]};
      if(!p.includes('orders'))throw Error('Unexpected collection read');
      const data=p.includes('created-order')?f().created.filter(x=>x.path.flat(Infinity).includes('lines')).map(x=>x.data):[{item_code:'SAVED-ITEM',line_no:1,qty_ordered:1,unit_price:10,line_type:'ad_hoc'}];
      return{docs:data.map((item,i)=>({id:'line-'+i,ref:[],data:()=>item}))};
    };
    export const onSnapshot=()=>()=>{},serverTimestamp=()=> 'FICTIONAL timestamp';
    export const runTransaction=async(_db,callback)=>{
      const state=f();if(!state.allowCreate)throw Error('Unexpected create');state.createCalls++;
      return callback({get:async()=>{throw Error('No real/fictional number allocation expected')},set:(path,data)=>state.created.push({path:[...path],data:structuredClone(data)})});
    };
    const fail=()=>{throw Error('Unexpected business mutation')};export{fail as updateDoc,fail as writeBatch,fail as addDoc,fail as deleteDoc,fail as setDoc,fail as increment};`,
  customer: `const list=()=>globalThis.__shipmentPiOwnership.customers;export const loadCustomers=async()=>list();export const getCustomer=async id=>list().find(x=>x.id===id)||null;export const primaryContact=()=>null;export const saveCustomer=async()=>{throw Error('No customer writes')};`,
  erpApi: 'export const erpLines=(kind,code)=>globalThis.__shipmentPiOwnership.erpRead(kind,code);',
  soNumber: 'export const JES_SEED_BY_YEAR={};export const soYear=()=>"26";const fail=()=>{throw Error("No number allocation")};export{fail as allocateSoNo,fail as formatSoNo};',
  ucRegistry: 'const fail=()=>{throw Error("No financial requests")};export{fail as allocateOrderUc,fail as allocateInvoice,fail as updateUcInvoice,fail as upsertInvoice};',
  storage: `const f=()=>globalThis.__shipmentPiOwnership;
    export const ref=(_s,path)=>({path});
    export const uploadBytes=async(ref,file,metadata)=>{if(!f().allowCreate)throw Error('Unexpected upload');f().uploads.push({path:ref.path,name:file.name,metadata})};
    export const getDownloadURL=async()=> 'https://fictional.invalid/PI.pdf';`,
  crystals: 'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}};',
  packaging: 'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}};',
  orderStock: 'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}};',
  ConfirmDialog: 'export default()=>null;', LineImagePicker: 'export default()=>null;',
  PackingListEditor: 'export default()=>null;', FreightComparison: 'export default()=>null;',
  OrderStockIssue: 'export default()=>null;', OrderInventoryIssue: 'export default()=>null;',
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-pi-ownership-'))
  const source = await readFile(process.env.SHIPMENT_PI_FORM_SOURCE || 'src/pages/ShipmentForm.jsx', 'utf8')
  await build({ stdin: { contents: source, resolveDir: resolve('src/pages'), loader: 'jsx' }, outfile: join(scratch, 'page.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fictional-pi-io', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, a => ({ path: a.path.split('/')[1], namespace: 'fixture' }))
    b.onResolve({ filter: /^\.\.?\// }, a => { const name = basename(a.path).replace(/\.jsx?$/, ''); if (name in stubs) return { path: name, namespace: 'fixture' } })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: process.cwd() }))
  } }] })
  Page = (await import(pathToFileURL(join(scratch, 'page.mjs')))).default
  originalFetch = globalThis.fetch
  globalThis.fetch = (path, options) => {
    if (path !== '/api/extract-pi') throw Error('Unexpected network request')
    const payload = JSON.parse(options.body), pdf = Buffer.from(payload.image, 'base64').toString('utf8')
    const id = pdf.includes('PDF-A') ? 'A' : 'B', response = deferred()
    f.requests.set(id, { response, payload, pdf }); f.started.get(id)?.resolve()
    return response.promise
  }
})
beforeEach(() => {
  f = { customers: ['A', 'B'].map(id => ({ id: 'customer-' + id, company_name: 'Fictional ' + id })), requests: new Map(), started: new Map(), erpRequests: [], erpGates: new Map(), immediateErp: new Map(), created: [], uploads: [], createCalls: 0, allowCreate: false, knownErpUnitWarnings: [], allowKnownErpUnitWarning: false }
  f.erpRead = async (kind, code) => {
    f.erpRequests.push({ kind, code })
    const gate = f.erpGates.get(code)
    return gate ? gate.promise : { rows: f.immediateErp.get(code) || [] }
  }
  globalThis.__shipmentPiOwnership = f
  errors = []; originalError = console.error; console.error = (...args) => {
    // Real lineFromErp currently omits unit. Adopting it over parser unit "pcs"
    // produces this one baseline-proven React warning, outside source identity
    // repair. Keep the typical parser fixture and fail every other warning.
    const unitWarning = 'Warning: A component is changing a controlled input to be uncontrolled. This is likely caused by the value changing from a defined to undefined, which should not happen. Decide between using a controlled or uncontrolled input element for the lifetime of the component. More info: https://reactjs.org/link/controlled-components%s'
    if (f.allowKnownErpUnitWarning && args.length === 2 && args[0] === unitWarning && String(args[1]).includes('at ShipmentLineRow')) f.knownErpUnitWarnings.push(args.map(String).join(' '))
    else errors.push(args.map(String).join(' '))
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []); assert.ok(f.knownErpUnitWarnings.length <= 1) }
  finally { console.error = originalError; host.remove(); delete globalThis.__shipmentPiOwnership }
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })

function Bridge() {
  navigate = useNavigate(); const location = useLocation()
  currentRoute = location.pathname
  return null
}
async function render() {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/shipments/new'], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Bridge), React.createElement(Routes, null,
      React.createElement(Route, { path: '/shipments/new', element: React.createElement(Page) }),
      React.createElement(Route, { path: '/shipments/:id', element: React.createElement(Page) }),
    ))))
  await flush()
}
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 0)) }) }
const input = placeholder => host.querySelector(`[placeholder="${placeholder}"]`)
const code = () => input('Item code')?.value ?? null
const uploadInput = () => host.querySelector('input[type=file]')
const uploadCard = () => uploadInput()?.closest('.card')
const fileLabel = () => uploadCard()?.querySelector(':scope > div.flex > span')?.textContent || ''
const progress = () => Boolean(uploadCard()?.querySelector('.animate-pulse'))
const submit = () => host.querySelector('button[type=submit]')
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent.trim() === label)
const erpButton = () => [...host.querySelectorAll('button')].find(el => el.textContent.startsWith("Use the ERP's lines"))
const extractionError = () => host.querySelector('#shipment-form-error')?.textContent || uploadCard()?.querySelector('.text-amber-600')?.textContent || ''
async function click(el) { assert.ok(el, 'Expected button'); await act(async () => el.click()); await flush() }
async function adoptCurrentErp() {
  f.allowKnownErpUnitWarning = true
  try { await click(erpButton()) } finally { f.allowKnownErpUnitWarning = false }
}
async function fill(el, value) { assert.ok(el, 'Expected input'); await act(async () => { el.value = value; Simulate.change(el, { target: { value } }) }); await flush() }
async function start(id) {
  const started = deferred(); f.started.set(id, started)
  const file = new dom.window.File(['%PDF-1.7 PDF-' + id + ' fictional'], 'Fictional-' + id + '.pdf', { type: 'application/pdf' })
  const picker = uploadInput(); assert.ok(picker, 'PI picker remains available for a new attempt')
  Object.defineProperty(picker, 'files', { value: [file], configurable: true })
  let timer
  try {
    await act(async () => {
      Simulate.change(picker)
      await Promise.race([
        started.promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PI ' + id + ' did not reach the fictional extraction boundary')), 3000) }),
      ])
    })
  } finally { clearTimeout(timer) }
  await flush()
  assert.equal(f.requests.get(id).payload.mimeType, 'application/pdf')
  assert.match(f.requests.get(id).pdf, new RegExp('PDF-' + id))
}
async function finish(id, { ok = true, data = piData(id), jsonError } = {}) {
  const request = f.requests.get(id); assert.ok(request)
  await act(async () => request.response.resolve({ ok, json: async () => { if (jsonError) throw jsonError; return data } }))
  await flush()
}
async function reject(id) {
  await act(async () => f.requests.get(id).response.reject(new Error('Fictional extraction network failure')))
  await flush()
}
async function createExpected(id) {
  f.allowCreate = true
  await click(submit())
  assert.equal(f.createCalls, 1)
  assert.equal(currentRoute, '/shipments/created-order')
  const order = f.created.find(x => !x.path.flat(Infinity).includes('lines'))?.data
  const line = f.created.find(x => x.path.flat(Infinity).includes('lines'))?.data
  assert.equal(order.source_file?.name, 'Fictional-' + id + '.pdf')
  assert.equal(order.uc_no, piData(id).pi_no)
  assert.equal(order.erp_so_no, piData(id).so_no)
  assert.equal(line.item_code, 'PI-ITEM-' + id)
  assert.equal(f.uploads[0].name, 'Fictional-' + id + '.pdf')
}

test('single PDF import keeps its exact file, parsed references and line through creation', async () => {
  await render(); await start('A'); assert.equal(progress(), true); assert.equal(submit().disabled, true)
  await finish('A'); assert.equal(progress(), false); assert.equal(code(), 'PI-ITEM-A')
  assert.match(uploadCard().textContent, /Fictional-A\.pdf/); await createExpected('A')
})

test('sequential successful replacement commits B file and B data together', async () => {
  await render(); await start('A'); await finish('A'); await start('B'); await finish('B')
  assert.equal(code(), 'PI-ITEM-B'); assert.equal(input('e.g. UC4950/26').value, 'UC5002/26')
  assert.match(uploadCard().textContent, /Fictional-B\.pdf/); await createExpected('B')
})

test('late A success cannot replace a newer completed B or attach B to A data', async () => {
  await render(); await start('A'); await start('B'); await finish('B'); await finish('A')
  assert.equal(code(), 'PI-ITEM-B'); assert.equal(input('e.g. SO260017').value, 'SO260002')
  assert.equal(extractionError(), ''); await createExpected('B')
})

test('superseded A completion cannot clear B busy state or enable Create early', async () => {
  await render(); await start('A'); await start('B'); await finish('A')
  assert.equal(progress(), true); assert.equal(submit().disabled, true)
  assert.equal(code(), null); assert.deepEqual(f.erpRequests, [])
  await finish('B'); assert.equal(progress(), false); await createExpected('B')
})

test('superseded A failure cannot show an error or clear pending B', async () => {
  await render(); await start('A'); await start('B'); await reject('A')
  assert.equal(progress(), true); assert.equal(submit().disabled, true); assert.equal(extractionError(), '')
  await finish('B'); assert.equal(code(), 'PI-ITEM-B'); assert.equal(extractionError(), '')
})

test('failed B replacement restores the committed A file and keeps A data associated at Create', async () => {
  await render(); await start('A'); await finish('A'); await start('B'); await finish('B', { ok: false })
  assert.equal(code(), 'PI-ITEM-A'); assert.equal(input('e.g. UC4950/26').value, 'UC5001/26')
  assert.match(uploadCard().textContent, /Fictional-A\.pdf/)
  assert.ok(extractionError()); assert.equal(progress(), false); assert.equal(submit().disabled, false)
  await createExpected('A')
})

test('malformed B response also restores committed A source rather than attaching B', async () => {
  await render(); await start('A'); await finish('A'); await start('B'); await finish('B', { jsonError: new Error('Fictional malformed JSON') })
  assert.equal(code(), 'PI-ITEM-A'); assert.match(uploadCard().textContent, /Fictional-A\.pdf/)
  assert.ok(extractionError()); await createExpected('A')
})

test('failed replacement preserves current manual edits and does not restore an invalidated ERP check', async () => {
  const erp = deferred(); f.erpGates.set('SO260001', erp)
  await render(); await start('A'); await finish('A')
  await act(async () => erp.resolve({ rows: erpRows('SO260001') })); await flush(); assert.ok(erpButton())
  await fill(input('Description'), 'Manual correction after successful A')
  await start('B'); assert.equal(erpButton(), undefined)
  await finish('B', { ok: false })
  assert.equal(input('Description').value, 'Manual correction after successful A')
  assert.equal(erpButton(), undefined); assert.match(uploadCard().textContent, /Fictional-A\.pdf/)
  assert.ok(extractionError()); assert.equal(submit().disabled, false)
})

test('initial extraction failure preserves manual draft and creates without attaching the failed file', async () => {
  await render(); await click(button('+ Add line'))
  await fill(input('Item code'), 'MANUAL-ITEM'); await fill(input('Description'), 'Manual draft')
  await fill(input('Qty'), '7'); await fill(input('Unit price'), '1.222')
  await fill(input('e.g. SO260017'), 'SO260099'); await fill(input('e.g. UC4950/26'), 'UC5099/26')
  await start('A'); await finish('A', { ok: false })
  assert.equal(code(), 'MANUAL-ITEM'); assert.equal(input('e.g. UC4950/26').value, 'UC5099/26')
  assert.equal(fileLabel(), ''); assert.ok(extractionError())
  f.allowCreate = true; await click(submit()); assert.equal(currentRoute, '/shipments/created-order')
  const order = f.created.find(x => !x.path.flat(Infinity).includes('lines')).data
  assert.equal(order.source, 'manual'); assert.equal(order.source_file, null); assert.deepEqual(f.uploads, [])
})

test('Create handler refuses explicit submit while an extraction is still pending', async () => {
  await render(); await start('A'); f.allowCreate = true
  await act(async () => Simulate.submit(host.querySelector('form'))); await flush()
  assert.equal(f.createCalls, 0); assert.deepEqual(f.uploads, []); assert.equal(currentRoute, '/shipments/new')
  await finish('A'); await createExpected('A')
})

test('failed latest B with no committed import cannot revive superseded A', async () => {
  await render(); await start('A'); await start('B'); await finish('B', { ok: false }); await finish('A')
  assert.equal(code(), null); assert.equal(input('e.g. UC4950/26').value, '')
  assert.equal(fileLabel(), '')
  assert.ok(extractionError()); assert.equal(submit().disabled, true)
})

test('current ERP comparison can be adopted explicitly for the same imported source', async () => {
  const erp = deferred(); f.erpGates.set('SO260001', erp)
  await render(); await start('A'); await finish('A'); assert.equal(code(), 'PI-ITEM-A')
  await act(async () => erp.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.match(host.textContent, /SO260001 found in the ERP/); await adoptCurrentErp()
  assert.equal(code(), 'ERP-SO260001'); assert.equal(input('e.g. SO260017').value, 'SO260001')
  assert.match(uploadCard().textContent, /Fictional-A\.pdf/)
})

test('an immediate ERP response belongs to the just-committed import without awaiting a render', async () => {
  f.immediateErp.set('SO260001', erpRows('SO260001'))
  await render(); await start('A'); await finish('A')
  assert.match(host.textContent, /SO260001 found in the ERP/); await adoptCurrentErp()
  assert.equal(code(), 'ERP-SO260001'); assert.equal(input('e.g. SO260017').value, 'SO260001')
})

test('successful B with missing SO keeps the existing reference but cannot revive A comparison', async () => {
  const a = deferred(); f.erpGates.set('SO260001', a)
  await render(); await start('A'); await finish('A'); await start('B')
  await finish('B', { data: { ...piData('B'), so_no: '' } })
  assert.equal(input('e.g. SO260017').value, 'SO260001'); assert.equal(code(), 'PI-ITEM-B')
  await act(async () => a.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.equal(erpButton(), undefined); assert.doesNotMatch(host.textContent, /found in the ERP/)
  assert.equal(fileLabel().trim(), 'Fictional-B.pdf')
})

test('successful zero-line extraction commits its own source and can then accept manual lines', async () => {
  await render(); await start('A'); await finish('A'); await start('B')
  await finish('B', { data: { ...piData('B'), lines: [] } })
  assert.equal(code(), null); assert.equal(fileLabel().trim(), 'Fictional-B.pdf')
  assert.equal(input('e.g. UC4950/26').value, 'UC5002/26'); assert.equal(submit().disabled, true)
  await click(button('+ Add line')); await fill(input('Item code'), 'MANUAL-B-LINE')
  await fill(input('Qty'), '2'); await fill(input('Unit price'), '3.333')
  f.allowCreate = true; await click(submit())
  const order = f.created.find(x => !x.path.flat(Infinity).includes('lines')).data
  assert.equal(order.source_file.name, 'Fictional-B.pdf'); assert.equal(order.uc_no, 'UC5002/26')
  assert.equal(f.uploads[0].name, 'Fictional-B.pdf')
})

test('late ERP A cannot replace B comparison or supply A lines to B adoption', async () => {
  const a = deferred(), b = deferred(); f.erpGates.set('SO260001', a); f.erpGates.set('SO260002', b)
  await render(); await start('A'); await finish('A'); await start('B'); await finish('B')
  await act(async () => b.resolve({ rows: erpRows('SO260002') })); await flush()
  await act(async () => a.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.match(host.textContent, /SO260002 found in the ERP/)
  assert.doesNotMatch(host.textContent, /SO260001 found in the ERP/)
  await adoptCurrentErp(); assert.equal(code(), 'ERP-SO260002')
  assert.equal(input('e.g. SO260017').value, 'SO260002'); assert.match(uploadCard().textContent, /Fictional-B\.pdf/)
})

test('starting a replacement invalidates the previous comparison while its extraction is pending', async () => {
  const a = deferred(); f.erpGates.set('SO260001', a)
  await render(); await start('A'); await finish('A'); await start('B')
  await act(async () => a.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.equal(erpButton(), undefined); assert.doesNotMatch(host.textContent, /SO260001 found in the ERP/)
  await finish('B'); assert.equal(code(), 'PI-ITEM-B')
})

test('editing SO invalidates a visible old ERP comparison and its adoption action', async () => {
  const erp = deferred(); f.erpGates.set('SO260001', erp)
  await render(); await start('A'); await finish('A')
  await act(async () => erp.resolve({ rows: erpRows('SO260001') })); await flush(); assert.ok(erpButton())
  await fill(input('e.g. SO260017'), 'SO260099')
  assert.equal(erpButton(), undefined); assert.doesNotMatch(host.textContent, /SO260001 found in the ERP/)
  assert.equal(code(), 'PI-ITEM-A')
})

test('editing SO before ERP returns prevents that now-stale comparison from appearing', async () => {
  const erp = deferred(); f.erpGates.set('SO260001', erp)
  await render(); await start('A'); await finish('A'); await fill(input('e.g. SO260017'), 'SO260099')
  await act(async () => erp.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.equal(erpButton(), undefined); assert.equal(input('e.g. SO260017').value, 'SO260099')
  assert.equal(code(), 'PI-ITEM-A')
})

test('retained adoption callback is refused when SO changes in the same React event batch', async () => {
  f.immediateErp.set('SO260001', erpRows('SO260001'))
  await render(); await start('A'); await finish('A')
  const adopt = erpButton(), so = input('e.g. SO260017'); assert.ok(adopt)
  await act(async () => {
    so.value = 'SO260099'; Simulate.change(so, { target: { value: 'SO260099' } })
    // The old visible button's handler still exists until the pending state
    // update renders. The synchronous ownership guard must refuse it.
    adopt.click()
  })
  await flush()
  assert.equal(code(), 'PI-ITEM-A'); assert.equal(input('e.g. SO260017').value, 'SO260099')
  assert.equal(erpButton(), undefined)
})

test('abandoned extraction cannot apply data or start an ERP lookup in the next saved editor', async () => {
  await render(); await start('A'); await act(async () => navigate('/shipments/SAVED')); await flush()
  await finish('A'); assert.equal(currentRoute, '/shipments/SAVED')
  assert.equal(input('e.g. 56909').value, 'SAVED-SAVED'); assert.equal(code(), 'SAVED-ITEM')
  assert.deepEqual(f.erpRequests, []); assert.deepEqual(f.created, []); assert.deepEqual(f.uploads, [])
})

test('abandoned ERP completion cannot add a comparison to another saved editor', async () => {
  const erp = deferred(); f.erpGates.set('SO260001', erp)
  await render(); await start('A'); await finish('A'); await act(async () => navigate('/shipments/SAVED')); await flush()
  await act(async () => erp.resolve({ rows: erpRows('SO260001') })); await flush()
  assert.equal(code(), 'SAVED-ITEM'); assert.equal(erpButton(), undefined); assert.equal(currentRoute, '/shipments/SAVED')
})
