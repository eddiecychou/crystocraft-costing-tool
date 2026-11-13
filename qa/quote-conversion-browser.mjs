// Isolated native Chrome, actual pages/Web SDK/Admin endpoint and demo emulator.
// No production credentials, real counters, customer email or owner browser.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { build } from 'esbuild'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { createQuoteConversionRepository } from '../netlify/functions/lib/quoteConversionRepository.js'
import { createQuoteConversionHandler } from '../netlify/functions/lib/quoteConversionHandler.js'
const out = 'qa/out/quote-conversion-recovery',
  projectId = 'demo-quote-conversion-browser'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
await mkdir(out, { recursive: true })
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':'),
  app = initializeApp({ projectId }, 'conversion-browser'),
  db = getFirestore(app)
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: await readFile('firestore.rules', 'utf8') }
})
const repo = createQuoteConversionRepository(db, () => FieldValue.serverTimestamp())
let failCommit = false,
  loseCommit = false,
  losePrepare = false,
  server,
  browser
const handler = createQuoteConversionHandler({
  verifyToken: async (t) => {
    if (t !== 'fictional-browser-admin') throw Error()
    return { uid: 'admin' }
  },
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo: {
    ...repo,
    async prepare(...args) {
      const result = await repo.prepare(...args)
      if (losePrepare) {
        losePrepare = false
        throw Error('Fictional prepared response lost')
      }
      return result
    },
    async commit(...args) {
      if (failCommit) throw Error('Fictional commit unavailable')
      const result = await repo.commit(...args)
      if (loseCommit) {
        loseCommit = false
        throw Error('Fictional committed response lost')
      }
      return result
    }
  }
})
const firebase = `import{initializeApp}from'firebase/app';import{getFirestore,connectFirestoreEmulator}from'firebase/firestore';export const db=getFirestore(initializeApp({projectId:'${projectId}',apiKey:'fictional-api',appId:'fictional-app'}));connectFirestoreEmulator(db,'${host}',${Number(port)},{mockUserToken:{sub:'admin'}});export const storage={};export const authHeader=async()=>({Authorization:'Bearer fictional-browser-admin'});`
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
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import Page from'./src/pages/ShipmentForm.jsx';import Quote from'./src/pages/QuoteDetail.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><main className="p-4 max-w-6xl mx-auto"><p className="text-sm mb-4">FICTIONAL CONVERSION QA · isolated demo</p><Link className="btn-secondary mb-4" to="/elsewhere">Fictional other page</Link><Routes><Route path="/shipments/new" element={<Page/>}/><Route path="/shipments/:id" element={<Page/>}/><Route path="/quotes/:id" element={<Quote/>}/><Route path="/elsewhere" element={<p>Fictional other page</p>}/></Routes></main></BrowserRouter>);`
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
const quote = {
  quote_no: 'FICTIONAL-QUOTE',
  quote_type: 'built',
  customer_id: 'fictional-customer',
  client_name: 'Fictional 中文 Buyer',
  quote_currency: 'USD',
  notes: 'Keep original 中文 notes',
  attachments: [
    { name: '原件 & evidence.pdf', url: 'https://example.invalid/original.pdf' }
  ],
  quote_date: '2026-11-08'
}
const item = {
  is_custom: true,
  product_name: 'Fictional Rosaline pear crystal — original drawing and application',
  product_unit: 'pcs',
  tiers: [
    { quantity: 1000, price: 1.222, remarks: 'Keep original tier notes 中文' },
    { quantity: 2000, price: 1.111 }
  ]
}
const reset = async () => {
  failCommit = loseCommit = losePrepare = false
  await env.clearFirestore()
  await db.doc('users/admin').set({ role: 'admin', status: 'approved' })
  await db.doc('client_quotes/fictional-quote').set(quote)
  await db
    .doc('client_quotes/fictional-quote/items/item')
    .set({ ...item, createdAt: FieldValue.serverTimestamp() })
  await db
    .doc('counters/so_' + String(new Date().getUTCFullYear()).slice(-2))
    .set({ last: 100, kind: 'so' })
}
const orderCount = async () => (await db.collection('orders').get()).size
try {
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/quote-order-conversion') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const response = await handler(
          new Request('http://127.0.0.1/api/quote-order-conversion', {
            method: req.method,
            headers: req.headers,
            body: Buffer.concat(chunks)
          })
        )
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(await response.text())
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
    } catch {
      res.writeHead(500)
      res.end('Fictional QA server error')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const require = createRequire(
      new URL('../.qa-playwright/package.json', import.meta.url)
    ),
    { chromium } = require('playwright-core')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1280, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }),
      page = await context.newPage(),
      errors = []
    page.setDefaultTimeout(20000)
    page.on('pageerror', (e) => errors.push(e.message))
    const start = async () => {
      await page.goto(origin + '/shipments/new?from_quote=fictional-quote')
      await page.getByRole('button', { name: 'Create Order', exact: true }).waitFor()
    }
    const snap = async (name) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
      assert.equal(overflow, false, name + ' horizontal overflow')
      await page.screenshot({ path: `${out}/${width}-${name}.png`, fullPage: true })
    }
    const save = async () => {
      await page.getByRole('button', { name: 'Create Order', exact: true }).click()
      await page.waitForURL(/\/shipments\/[A-Za-z0-9_-]+$/)
    }
    await reset()
    await start()
    await snap('new')
    await save()
    assert.equal(await orderCount(), 1)
    const first = await db.collection('orders').get(),
      firstId = first.docs[0].id,
      original = first.docs[0].data()
    await page.goBack()
    await page.getByRole('link', { name: 'Open order', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Create Order', exact: true }).count(),
      0
    )
    await snap('existing')
    await page
      .getByRole('button', { name: 'Create additional order', exact: true })
      .click()
    await page
      .getByLabel('Reason for an additional order')
      .fill('Reviewed second 500 pieces · 中文')
    await page
      .getByRole('button', { name: 'Review additional order', exact: true })
      .click()
    await page.getByPlaceholder('Qty', { exact: true }).fill('500')
    await page.getByPlaceholder('e.g. 56909', { exact: true }).fill('Fictional partial B')
    await snap('additional')
    await save()
    assert.equal(await orderCount(), 2)
    assert.deepEqual((await db.doc('orders/' + firstId).get()).data(), original)
    await page.goBack()
    await page.getByRole('link', { name: 'Open order', exact: true }).first().waitFor()
    assert.equal(
      await page.getByRole('link', { name: 'Open order', exact: true }).count(),
      2
    )
    reports.push({
      width,
      case: 'Back/default Open and explicit additional partial order',
      pass: true,
      orders: 2
    })
    await reset()
    await start()
    losePrepare = true
    await page.getByRole('button', { name: 'Create Order', exact: true }).click()
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .waitFor()
    assert.equal(await orderCount(), 0)
    await snap('prepared')
    await page.reload()
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .click()
    await page.waitForURL(/\/shipments\/[A-Za-z0-9_-]+$/)
    assert.equal(await orderCount(), 1)
    reports.push({
      width,
      case: 'Lost prepare response and reload/Resume',
      pass: true,
      orders: 1
    })
    await reset()
    await start()
    loseCommit = true
    await page.getByRole('button', { name: 'Create Order', exact: true }).click()
    await page.getByRole('link', { name: 'Open order', exact: true }).waitFor()
    assert.equal(await orderCount(), 1)
    assert.equal(
      await page.getByRole('button', { name: 'Create Order', exact: true }).count(),
      0
    )
    await snap('lost-commit')
    reports.push({
      width,
      case: 'Lost commit response opens existing result',
      pass: true,
      orders: 1
    })
    await reset()
    await start()
    failCommit = true
    await page.getByRole('button', { name: 'Create Order', exact: true }).click()
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .waitFor()
    await db
      .doc('client_quotes/fictional-quote/items/item')
      .update({ product_name: 'Changed source' })
    failCommit = false
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'quote or its items changed' })
      .waitFor()
    assert.equal(await orderCount(), 0)
    await page
      .getByRole('button', { name: 'Cancel uncommitted request', exact: true })
      .click()
    await page.getByLabel('Cancellation reason').fill('Review updated source')
    await page
      .getByRole('button', { name: 'Confirm request cancellation', exact: true })
      .click()
    await page.getByRole('button', { name: 'Create Order', exact: true }).waitFor()
    await save()
    assert.equal(await orderCount(), 1)
    reports.push({
      width,
      case: 'Source conflict, explicit cancellation and fresh review',
      pass: true,
      orders: 1
    })
    await reset()
    await start()
    failCommit = true
    await page.getByRole('button', { name: 'Create Order', exact: true }).click()
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .waitFor()
    await db.doc('client_quotes/fictional-quote').update({ quote_type: 'uploaded' })
    await page.goto(origin + '/quotes/fictional-quote')
    await page.getByRole('link', { name: 'Resume saved conversion', exact: true }).click()
    await page
      .getByRole('button', { name: 'Resume saved conversion', exact: true })
      .waitFor()
    await page.getByRole('alert').filter({ hasText: 'uploaded document' }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Create Order', exact: true }).count(),
      0
    )
    await page
      .getByRole('button', { name: 'Cancel uncommitted request', exact: true })
      .click()
    await page.getByLabel('Cancellation reason').fill('Review changed document type')
    await page
      .getByRole('button', { name: 'Confirm request cancellation', exact: true })
      .click()
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    await db.doc('client_quotes/fictional-quote').update({ quote_type: 'built' })
    failCommit = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByRole('button', { name: 'Create Order', exact: true }).waitFor()
    await save()
    await db
      .doc('client_quotes/fictional-quote/items/item')
      .update({ product_name: 'Changed source' })
    reports.push({
      width,
      case: 'Uploaded-source recovery remains accessible; new Create stays blocked until source review',
      pass: true,
      orders: 1
    })
    await page.goto(origin + '/quotes/fictional-quote')
    await page.locator('input[value="Changed source"]').waitFor()
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await page.waitForURL(
      (u) => u.pathname.startsWith('/quotes/') && u.pathname !== '/quotes/fictional-quote'
    )
    await page.getByRole('link', { name: 'Convert to PI', exact: true }).waitFor()
    const copiedId = new URL(page.url()).pathname.split('/').at(-1),
      copy = (await db.doc('client_quotes/' + copiedId).get()).data()
    assert.equal(copy.converted_order_id, undefined)
    assert.deepEqual(copy.attachments, quote.attachments)
    assert.equal(
      (await db.collection('client_quotes/' + copiedId + '/items').get()).size,
      1
    )
    reports.push({
      width,
      case: 'Actual quote Duplicate retains original files/items and no old conversion link',
      pass: true
    })
    assert.deepEqual(errors, [])
    await context.close()
  }
  // Independent browser tabs loaded before the first result share one intent.
  await reset()
  const context = await browser.newContext(),
    a = await context.newPage(),
    b = await context.newPage()
  for (const page of [a, b]) {
    page.setDefaultTimeout(20000)
    await page.goto(origin + '/shipments/new?from_quote=fictional-quote')
    await page.getByRole('button', { name: 'Create Order', exact: true }).waitFor()
  }
  await Promise.all([
    a.getByRole('button', { name: 'Create Order', exact: true }).click(),
    b.getByRole('button', { name: 'Create Order', exact: true }).click()
  ])
  for (const page of [a, b]) {
    await page.waitForFunction(
      () =>
        (location.pathname.startsWith('/shipments/') &&
          location.pathname !== '/shipments/new') ||
        [...document.querySelectorAll('a')].some((a) => a.textContent === 'Open order')
    )
    if (new URL(page.url()).pathname === '/shipments/new') {
      await page.getByRole('link', { name: 'Open order', exact: true }).click()
      await page.waitForURL(
        (u) => u.pathname.startsWith('/shipments/') && u.pathname !== '/shipments/new'
      )
    }
  }
  assert.equal(a.url(), b.url())
  assert.equal(await orderCount(), 1)
  await context.close()
  reports.push({
    case: 'Two actual Chrome tabs/same reviewed draft',
    pass: true,
    orders: 1
  })
  await writeFile(
    out + '/browser-evidence.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        projectId,
        method:
          'Actual current pages, native Web SDK source hashes, real Node conversion handler/Admin transactions, unchanged test accounts and loopback emulator; actual dist CSS. Isolated headless Chrome.',
        cases: reports
      },
      null,
      2
    ) + '\n'
  )
  console.log(JSON.stringify({ passed: reports.length, out }))
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await env.cleanup()
  await db.terminate()
  await deleteApp(app)
}
