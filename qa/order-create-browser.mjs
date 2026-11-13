// Isolated native Chrome, actual pages/Web SDK/Admin endpoint and demo emulator.
// No production credentials, real counters, customer email or owner browser.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { build } from 'esbuild'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { getStorage } from 'firebase-admin/storage'
import {
  orderRequestHandler,
  verifyPiOriginal
} from '../netlify/functions/shipping-order-request.js'
import { createOrderRequests } from '../netlify/functions/lib/orderCreateRequests.js'
import { PI_MAX_FILE_BYTES } from '../src/piUploadPolicy.js'
const out = 'qa/out/sh07-manual',
  projectId = 'demo-sh07-manual-browser'
assert.equal(process.env.GCLOUD_PROJECT, projectId)
assert.match(
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '',
  /^127\.0\.0\.1:\d+$/
)
const storagePort = Number(
  process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[1]
)
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
await mkdir(out, { recursive: true })
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':'),
  app = initializeApp(
    { projectId, storageBucket: projectId + '.appspot.com' },
    'order-create-browser'
  ),
  db = getFirestore(app)
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: await readFile('firestore.rules', 'utf8') },
  storage: { rules: await readFile('storage.rules', 'utf8') }
})
let server, browser, duplicateFixture, afterDuplicateIssue, directInvoices
const invoiceFaults = {}
const firebase = `import{initializeApp}from'firebase/app';import{getFirestore,connectFirestoreEmulator}from'firebase/firestore';import{getStorage,connectStorageEmulator}from'firebase/storage';const app=initializeApp({projectId:'${projectId}',storageBucket:'${projectId}.appspot.com',apiKey:'fictional-api',appId:'fictional-app'});export const db=getFirestore(app);connectFirestoreEmulator(db,'${host}',${Number(port)},{mockUserToken:{sub:'admin'}});export const storage=getStorage(app);connectStorageEmulator(storage,'127.0.0.1',${storagePort},{mockUserToken:{sub:'admin'}});export const authHeader=async()=>({Authorization:'Bearer fictional-browser-admin'});`
const stubs = {
  firebase,
  customer: `export const loadCustomers=async()=>[{id:'fictional-customer',company_name:'Fictional 中文 Buyer'}];export const getCustomer=async()=>null;export const primaryContact=()=>null;export const saveCustomer=()=>{throw Error('No customer write')};`,
  criticalComponents:
    'export const buildProductIndex=()=>new Map();export const matchProductCode=()=>null;',
  bankAccounts:
    'export const listBankAccounts=async()=>[];export const accountForCurrency=()=>null;export const formatBankDetails=()=>"";',
  customerAssets:
    'export const loadCustomerAssets=async()=>[];export const TYPE_LABEL={},CATEGORIES=[],CATEGORY_LABEL={};',
  QuoteExport: 'export default()=>null;',
  QuoteProductPicker: 'export default()=>null;',
  ConfirmDialog: 'export default()=>null;',
  LineImagePicker: 'export default()=>null;',
  PackingListEditor: 'export default()=>null;',
  FreightComparison: 'export default()=>null;',
  OrderStockIssue: 'export default()=>null;',
  OrderInventoryIssue: 'export default()=>null;',
  crystals:
    'export const crystalInventory={order:{reserved:"crystals_reserved",committed:"crystals_committed"}};',
  packaging:
    'export const packagingInventory={order:{reserved:"packaging_reserved",committed:"packaging_committed"}};',
  orderStock:
    'export const metalOrderConfig={order:{reserved:"metal_reserved",committed:"metal_committed"}};',
  invoiceRecovery:
    'export const invoiceAction=async(_id,action)=>{if(action!=="status")throw Error("No invoice allocation allowed");return{operation:null,history:[]}};',
  ucRegistry:
    'const fail=()=>{throw Error("No financial calls allowed")};export{fail as upsertInvoice,fail as allocateOrderUc,fail as allocateInvoice,fail as updateUcInvoice};',
  erpSoImport:
    'const fail=()=>{throw Error("No ERP calls allowed")};export{fail as fetchErpSoLines,fail as diffLines,fail as adoptErpLineUnits};'
}
if (process.env.QA_INVOICE_DATABASE_URL) delete stubs.invoiceRecovery
stubs.ucRegistry +=
  'export const listAppInvoicesForReconciliation=async()=>[],upsertInvoiceStrict=async()=>{throw Error("Unexpected reconciliation")};'
stubs.customer += 'export const useCustomers=()=>({customers:[]});'
stubs.logistics =
  'export const useVendors=()=>({vendors:[]}),FREIGHT_MODES=[],modeLabel=()=>"",strengthOf=()=>"";'
stubs.erpApi = 'export const erpLookup=async()=>[];'
stubs.ComponentRequirements = stubs.ErpDocModal = 'export default ()=>null'
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import New from'./src/pages/NewShipmentEntry.jsx';import Saved from'./src/pages/ShipmentForm.jsx';import Shipping from'./src/pages/Shipping.jsx';import Sales from'./src/pages/SalesInvoices.jsx';
createRoot(document.getElementById('root')).render(<BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><main><Link to="/shipping">Shipping list</Link><Routes><Route path="/shipments/new" element={<New uid="admin"/>}/><Route path="/shipments/:id" element={<Saved/>}/><Route path="/shipping" element={<Shipping uid="admin"/>}/><Route path="/sales-invoices" element={<Sales uid="admin"/>}/></Routes></main></BrowserRouter>);`

await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' },
  outfile: out + '/browser.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  plugins: [
    {
      name: 'fictional-browser-io',
      setup(b) {
        b.onResolve({ filter: /^\.\.?\// }, (a) => {
          const name = basename(a.path).replace(/\.jsx?$/, '')
          if (name in stubs) return { path: name, namespace: 'fixture' }
        })
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: stubs[a.path],
          loader: 'js',
          resolveDir: process.cwd()
        }))
      }
    }
  ]
})
const index = await readFile('dist/index.html', 'utf8'),
  cssPath = index.match(/href="([^" ]+\.css)"/)?.[1]
assert.ok(cssPath, 'Actual built CSS required')
const css = await readFile(resolve('dist', '.' + cssPath)),
  reports = []
const reset = async () => {
  await env.clearFirestore()
  await db.doc('users/admin').set({ role: 'admin' })
  await db.doc('counters/so_26').set({ last: 100 })
}
const orders = () => db.collection('orders').get()
let discard = '',
  failStatus = false,
  interruptAfterUpload = false
const repo = createOrderRequests(
  db,
  (...args) => verifyPiOriginal(getStorage(app).bucket(), ...args),
  async (id, request, issue) => {
    const receipt = await duplicateFixture.uc(id, request, issue)
    if (issue && afterDuplicateIssue) await afterDuplicateIssue()
    return receipt
  }
)
const handler = orderRequestHandler({
  verifyToken: async (token) => {
    assert.equal(token, 'fictional-browser-admin')
    return { uid: 'admin' }
  },
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo
})
try {
  server = createServer(async (req, res) => {
    if (req.url === '/api/invoice-allocation' && directInvoices) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks),
        data = JSON.parse(body)
      const response = await directInvoices.handler(
        new Request('http://localhost' + req.url, {
          method: 'POST',
          headers: req.headers,
          body
        })
      )
      if (discard === data.action && response.ok) {
        discard = ''
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({ error: 'Fictional invoice confirmation lost' })
        )
        return
      }
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
      return
    }
    if (req.url === '/api/shipping-order-request') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks),
        data = JSON.parse(body)
      if (data.action === 'status' && failStatus) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Fictional status unavailable' }))
        return
      }
      if (interruptAfterUpload && data.action === 'commit') {
        const [files] = await getStorage(app)
          .bucket()
          .getFiles({ prefix: 'shipping_pi_originals/admin/' + data.id + '/' })
        if (files.length) {
          interruptAfterUpload = false
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ error: 'Fictional interruption after upload' })
          )
          return
        }
      }
      const response = await handler(
        new Request('http://localhost' + req.url, {
          method: 'POST',
          headers: req.headers,
          body
        })
      )
      if (discard === data.action && response.ok) {
        discard = ''
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Fictional confirmation lost' }))
        return
      }
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
      return
    }
    if (req.url === '/api/extract-pi') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          customer_name: 'Fictional buyer',
          lines: [
            {
              description: 'Fictional PI line',
              qty_ordered: 1000,
              unit_price: 1.222
            }
          ]
        })
      )
      return
    }
    if (req.url === '/browser.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(await readFile(out + '/browser.js'))
      return
    }
    if (req.url === '/style.css') {
      res.setHeader('Content-Type', 'text/css')
      res.end(css)
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(
      '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/browser.js"></script>'
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const require = createRequire(resolve('.qa-playwright/package.json')),
    { chromium } = require('playwright-core')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  const errors = []
  await context.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort()
  )
  async function pageAt(url = '/shipments/new?customer_id=fictional-customer') {
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(url.startsWith('http') ? url : origin + url)
    return page
  }
  const add = async (p) => {
    await p.getByRole('button', { name: '+ Add line', exact: true }).click()
    await p.getByPlaceholder('Qty', { exact: true }).fill('1000')
    await p.getByPlaceholder('Unit price', { exact: true }).fill('1.222')
  }
  const submit = async (p) =>
    p.getByRole('button', { name: 'Create Order', exact: true }).click()
  const saved = async (p) => {
    try { await p.waitForURL(/\/shipments\/(?!new)[A-Za-z0-9_-]+$/) }
    catch (error) {
      await writeFile(out + '/failed-page.txt', await p.locator('body').innerText())
      const snapshot = await db.collection('orders').get()
      const orders = await Promise.all(snapshot.docs.map(async d => ({ id: d.id, order: d.data(), operations: (await d.ref.collection('invoice_allocations').get()).docs.map(op => op.data()) })))
      await writeFile(out + '/failed-orders.json', JSON.stringify(orders, null, 2))
      throw error
    }
  }
  const requests = () =>
    db.collection('shipping_create_operators/admin/requests').get()
  await reset()
  let p = await pageAt()
  await add(p)
  const requestedUrl = p.url()
  discard = 'commit'
  await submit(p)
  await p.getByRole('link', { name: /Open saved order/ }).waitFor()
  assert.equal((await orders()).size, 1)
  await p.reload()
  await p.getByRole('link', { name: /Open saved order/ }).click()
  await saved(p)
  await p.goBack()
  await p.getByRole('link', { name: /Open saved order/ }).waitFor()
  await p.getByRole('link', { name: 'Start a separate order' }).click()
  await add(p)
  assert.notEqual(p.url(), requestedUrl)
  await submit(p)
  await saved(p)
  assert.equal((await orders()).size, 2)
  reports.push('lost order confirmation, reload, Back and deliberate new sale')
  await p.close()

  await reset()
  p = await pageAt()
  await add(p)
  const b = await pageAt(p.url())
  await add(b)
  await Promise.all([submit(p), submit(b)])
  await Promise.all([saved(p), saved(b)])
  assert.equal(p.url(), b.url())
  assert.equal((await orders()).size, 1)
  reports.push('two tabs sharing the prepared draft issued one SO')
  await p.close()
  await b.close()

  await reset()
  const winner = await pageAt()
  await add(winner)
  const sharedRequest = winner.url()
  const loser = await pageAt(sharedRequest)
  await loser.locator('input[type=file]').setInputFiles({
    name: 'Fictional conflicting PI.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 fictional conflicting original')
  })
  await loser.getByPlaceholder('Qty', { exact: true }).waitFor()
  await loser.getByPlaceholder('Description', { exact: true }).fill('Keep the second tab’s draft')
  await loser.getByPlaceholder('e.g. 56909').fill('PO-SECOND')
  await loser.getByPlaceholder('e.g. SO260017').fill('SO260099')
  await loser.getByPlaceholder('e.g. UC4950/26').fill('UC9999/26')
  await submit(winner)
  await saved(winner)
  await submit(loser)
  const useDraft = loser.getByRole('button', { name: 'Use my draft for a separate order' })
  await useDraft.waitFor()
  await loser.getByRole('link', { name: /Open saved order/ }).waitFor()
  assert.equal((await orders()).size, 1)
  assert.equal((await requests()).size, 1)
  const firstSo = (await orders()).docs[0].get('erp_so_no')
  const firstCounter = (await db.doc('counters/so_26').get()).get('last')
  await loser.reload()
  await useDraft.click()
  const separateRequest = loser.url()
  assert.notEqual(new URL(separateRequest).searchParams.get('request'), new URL(sharedRequest).searchParams.get('request'))
  const create = loser.getByRole('button', { name: 'Create Order', exact: true })
  await create.waitFor()
  assert.equal(await create.isDisabled(), true)
  assert.equal(await loser.getByPlaceholder('Description', { exact: true }).inputValue(), 'Keep the second tab’s draft')
  assert.equal(await loser.getByPlaceholder('e.g. 56909').inputValue(), 'PO-SECOND')
  assert.equal(await loser.getByPlaceholder('e.g. SO260017').inputValue(), '')
  assert.equal(await loser.getByPlaceholder('e.g. UC4950/26').inputValue(), '')
  assert.equal(await loser.getByPlaceholder('Unit price', { exact: true }).inputValue(), '1.222')
  assert.equal((await orders()).size, 1)
  assert.equal((await requests()).size, 1)
  const reattach = loser.getByLabel(/Reattach the original PI/)
  await reattach.setInputFiles({
    name: 'Fictional conflicting PI.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 fictional conflicting originaX')
  })
  await loser.getByRole('alert').filter({ hasText: 'Select the original PI named' }).first().waitFor()
  assert.equal(await create.isDisabled(), true)
  await reattach.setInputFiles({
    name: 'Fictional conflicting PI.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 fictional conflicting original')
  })
  await loser.getByText('Fictional conflicting PI.pdf', { exact: true }).waitFor()
  // The first commit checks for a staged file, then the second saves it.
  // Exercise replay on the saved request through Back and the original link.
  await submit(loser)
  await saved(loser)
  assert.equal((await orders()).size, 2)
  assert.equal((await requests()).size, 2)
  const secondOrder = (await orders()).docs.find(doc => doc.get('customer_po') === 'PO-SECOND')
  assert.equal(secondOrder.get('source_file.name'), 'Fictional conflicting PI.pdf')
  const secondLines = await secondOrder.ref.collection('lines').get()
  assert.equal(secondLines.docs[0].get('unit_price'), 1.222)
  assert.equal(secondLines.docs[0].get('description'), 'Keep the second tab’s draft')
  assert.notEqual(secondOrder.get('erp_so_no'), firstSo)
  assert.equal((await db.doc('counters/so_26').get()).get('last'), firstCounter + 1)
  assert.deepEqual(Buffer.from(await (await fetch(secondOrder.get('source_file.url'))).arrayBuffer()),
    Buffer.from('%PDF-1.7 fictional conflicting original'))
  await loser.goto(sharedRequest)
  await loser.getByRole('button', { name: 'Open separate request' }).click()
  assert.equal(loser.url(), separateRequest)
  await loser.getByRole('link', { name: /Open saved order/ }).click()
  await saved(loser)
  assert.equal((await orders()).size, 2)
  assert.equal((await requests()).size, 2)
  assert.equal((await db.doc('counters/so_26').get()).get('last'), firstCounter + 1)
  reports.push('different two-tab drafts: one order until explicit separate Create, reload and verified PI reattachment, then exactly two distinct orders')
  await winner.close()
  await loser.close()

  await reset()
  p = await pageAt()
  const bytes = Buffer.from('%PDF-1.7 FICTIONAL original')
  const original = {
    name: '報價 & PI.pdf',
    mimeType: 'application/pdf',
    buffer: bytes
  }
  await p.locator('input[type=file]').first().setInputFiles(original)
  await p.getByPlaceholder('Qty', { exact: true }).waitFor()
  let rejectedExtractionCalls = 0
  const watchExtract = req => { if (new URL(req.url()).pathname === '/api/extract-pi') rejectedExtractionCalls++ }
  p.on('request', watchExtract)
  await p.locator('input[type=file]').first().setInputFiles({ name: 'Fictional oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(PI_MAX_FILE_BYTES + 1) })
  await p.getByRole('alert').filter({ hasText: 'This PI exceeds the 20 MB limit' }).waitFor()
  assert.equal(await p.getByPlaceholder('Qty', { exact: true }).inputValue(), '1000')
  assert.equal(rejectedExtractionCalls, 0)
  p.off('request', watchExtract)
  reports.push('Oversized PI replacement is refused before extraction; previous original and exact lines remain usable')
  await p.locator('#deposit-paid').fill('2000')
  await submit(p)
  assert.equal((await requests()).size, 0)
  await p.locator('#deposit-paid').fill('100')
  discard = 'prepare'
  await submit(p)
  await p.getByRole('button', { name: 'Resume saved request' }).waitFor()
  const piRequest = p.url()
  await p.reload()
  await p.getByRole('button', { name: 'Resume saved request' }).click()
  await p
    .getByLabel(/Select the original PI/)
    .setInputFiles({ ...original, buffer: Buffer.from('wrong') })
  await p.getByRole('button', { name: 'Resume saved request' }).click()
  await p
    .getByRole('alert')
    .filter({ hasText: 'Select the original PI' })
    .waitFor()
  interruptAfterUpload = true
  await p.getByLabel(/Select the original PI/).setInputFiles(original)
  await p.getByRole('button', { name: 'Resume saved request' }).click()
  await p
    .getByRole('alert')
    .filter({ hasText: 'Fictional interruption after upload' })
    .waitFor()
  const prefix =
    'shipping_pi_originals/admin/' +
    new URL(piRequest).searchParams.get('request') +
    '/'
  const [staged] = await getStorage(app).bucket().getFiles({ prefix })
  assert.equal(staged.length, 1)
  const uploadedGeneration = (await staged[0].getMetadata())[0].generation
  await p.close()
  p = await pageAt(piRequest)
  await p.getByRole('button', { name: 'Resume saved request' }).click()
  await saved(p)
  const o = (await orders()).docs[0]
  assert.equal(o.data().source_file.name, original.name)
  assert.deepEqual(
    Buffer.from(await (await fetch(o.data().source_file.url)).arrayBuffer()),
    bytes
  )
  const [objects] = await getStorage(app)
    .bucket()
    .getFiles({
      prefix:
        'shipping_pi_originals/admin/' +
        new URL(piRequest).searchParams.get('request') +
        '/'
    })
  assert.equal(objects.length, 1)
  assert.equal(
    (await objects[0].getMetadata())[0].generation,
    uploadedGeneration
  )
  assert.equal(o.data().deposit_paid, 100)
  reports.push(
    'PI validation, lost prepare, reload, wrong file, closed tab after upload, same generation reused and original download'
  )
  await p.getByRole('link', { name: 'Shipping list' }).click()
  await p.getByRole('button', { name: 'My saved order requests' }).click()
  await p.getByRole('link', { name: /Open · .*報價/ }).click()
  await p.getByRole('link', { name: /Open saved order/ }).waitFor()
  reports.push('Shipping list reopens the operator’s request')
  await p.close()
  await reset()
  failStatus = true
  p = await pageAt()
  await p.getByRole('button', { name: 'Check saved status' }).waitFor()
  assert.equal(
    await p.getByRole('button', { name: 'Create Order', exact: true }).count(),
    0
  )
  failStatus = false
  await p.getByRole('button', { name: 'Check saved status' }).click()
  await add(p)
  await submit(p)
  await saved(p)
  reports.push('status failure blocks Create until a successful retry')
  if (process.env.QA_INVOICE_DATABASE_URL) {
    const { createDuplicateFixture } = await import(
      './duplicate-order-fixture.mjs'
    )
    const { duplicateBrowserCases } = await import(
      './duplicate-order-browser-cases.mjs'
    )
    duplicateFixture = await createDuplicateFixture()
    const { directInvoiceFixture } = await import(
      './direct-invoice-fixture.mjs'
    )
    directInvoices = directInvoiceFixture(
      db,
      duplicateFixture.db,
      invoiceFaults,
      async (token) => {
        assert.equal(token, 'fictional-browser-admin')
        return { uid: 'admin', email: 'admin@example.invalid' }
      }
    )
    await duplicateBrowserCases({
      fixture: duplicateFixture,
      db,
      reset,
      pageAt,
      saved,
      reports,
      setAfterIssue: (fn) => {
        afterDuplicateIssue = fn
      },
      dropReply: (action) => {
        discard = action
      }
    })
    const { directInvoiceBrowserCases } = await import(
      './direct-invoice-browser-cases.mjs'
    )
    await directInvoiceBrowserCases({
      db,
      sqlDb: duplicateFixture.db,
      reset,
      pageAt,
      add,
      submit,
      saved,
      reports,
      invoiceFaults,
      dropReply: (action) => {
        discard = action
      }
    })
  }
  await context.close()
  assert.deepEqual(errors, [])
  await writeFile(
    out + '/browser-evidence.json',
    JSON.stringify(reports, null, 2)
  )
  console.log(reports)
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await duplicateFixture?.db.close()
  await env.cleanup()
  await db.terminate()
  await deleteApp(app)
}
