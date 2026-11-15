// The actual Woo importer and page, with fictional orders on loopback Firestore.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocsFromServer, getDocFromServer, setDoc } from 'firebase/firestore'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const projectId = 'demo-woo-import'
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/)
let env, db, scratch, app
const fixture = globalThis.__wooImportFixture = {}
const ledgerIds = []
const ledgerHistory = new Map([[900102, 'invoice'], [900103, 'uc'], [900105, 'invoice']])
fixture.verify = id => {
  ledgerIds.push(id)
  if (fixture.failLedgerRead) throw Error('Could not verify invoice and UC history. Please try again.')
  return ledgerHistory.get(id) ?? null
}
const woo = id => ({
  id, number: String(id), customer_name: 'Fictional buyer ' + id,
  currency: 'USD', date_created: '2026-11-14T13:00:00', subtotal: 20, total: 20,
  discount_total: 0, shipping_total: 0, tax_total: 0,
  line_items: [{ sku: 'NEW-FICTIONAL', name: 'Fictional item', quantity: 2, subtotal: 20, discount: 0, tax: 0, total: 20 }],
})
const orderPath = id => `orders/woo-${id}`
const readHeader = id => getDocFromServer(doc(db, orderPath(id)))
async function readLines(id) {
  const snapshot = await getDocsFromServer(collection(db, orderPath(id), 'lines'))
  return snapshot.docs.map(row => ({ id: row.id, ...row.data() }))
}
const historicLine = { item_code: 'OLD-FICTIONAL', qty_ordered: 9, unit_price: 31.25, remarks: 'Original source' }
async function seedSurvivor(id) {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), orderPath(id), 'lines', 'original'), historicLine))
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.rules', 'utf8') } })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c => {
    for (const uid of ['woo-fixture-a', 'woo-fixture-b']) {
      await setDoc(doc(c.firestore(), 'users', uid), { role: 'staff', modules: ['shipping', 'woo'] })
    }
    await setDoc(doc(c.firestore(), 'users', 'woo-fixture-no-shipping'), { role: 'staff', modules: ['woo'] })
  })
  fixture.db = db = env.authenticatedContext('woo-fixture-a').firestore()
  const sources = {
    firebase: 'export const db=globalThis.__wooImportFixture.db',
    firestore: `export * from 'firebase/firestore';
      import {getDocsFromServer as read} from 'firebase/firestore';
      export async function getDocsFromServer(query) {
        if(globalThis.__wooImportFixture.failLineRead) throw Error('Fictional line read failed')
        return read(query)
      }`,
    criticalComponents: 'export const buildProductIndex=()=>null,matchProductCode=()=>null',
    wooCache: `export const loadWooOrdersCache=async()=>globalThis.__wooImportFixture.cache;
      export const saveWooOrdersCache=()=>{},loadWooCustomerScanCache=async()=>null,saveWooCustomerScanCache=()=>{}`,
    wooSyncApi: `const fail=()=>{throw Error('Live WooCommerce is disabled')};
      export const verifyWooOrderImport=(...args)=>globalThis.__wooImportFixture.verify(...args);
      export {fail as listWooOrders,fail as searchWooOrders,fail as wooOrderMeta,fail as wooProbePayout}`,
    customer: 'export const loadCustomers=async()=>[]',
    CustomerAccounts: 'export const CustomerPicker=()=>null',
    wooCustomerSync: `const fail=()=>{throw Error('Unexpected customer sync')};
      export {fail as scanWooCustomers,fail as classifyWooCustomers,fail as createWooRetailCustomers}`,
  }
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/woo-import-'))
  const entry = join(scratch, 'app.mjs')
  await build({
    stdin: {
      contents: `export {default as Page} from './src/pages/WooCommerceSync.jsx';
        export {importWooOrder,checkWooOrderImports} from './src/wooImport.js'`, resolveDir: process.cwd(),
    },
    outfile: entry, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'fictional-woo-boundaries', setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, a => a.namespace === 'fixture'
        ? { path: a.path, external: true } : { path: 'firestore', namespace: 'fixture' })
      builder.onResolve({ filter: /^(react(?:\/.*)?|react-router-dom|lucide-react)$/ }, a => ({ path: a.path, external: true }))
      builder.onResolve({ filter: /^\./ }, a => {
        const name = basename(a.path).replace(/\.jsx?$/, '')
        if (Object.hasOwn(sources, name)) return { path: name, namespace: 'fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: sources[a.path], loader: 'js' }))
    } }],
  })
  app = await import(pathToFileURL(entry).href)
})

after(async () => {
  delete globalThis.__wooImportFixture
  if (env) await env.cleanup()
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test('fresh Woo import creates one draft and retry preserves its exact header and lines', async () => {
  const id = 901111
  assert.deepEqual(await app.importWooOrder(woo(id)), { id: 'woo-901111', created: true })
  const first = (await readHeader(id)).data()
  const lines = await readLines(id)
  assert.equal(first.status, 'draft')
  assert.equal(first.erp_si_no, '')
  assert.equal(first.uc_no, '')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].item_code, 'NEW-FICTIONAL')
  assert.deepEqual(await app.importWooOrder({ ...woo(id), total: 100, line_items: [] }), { id: 'woo-901111', created: false })
  assert.deepEqual((await readHeader(id)).data(), first)
  assert.deepEqual(await readLines(id), lines)
  assert.deepEqual(ledgerIds.filter(n => n === id), [id])
})

test('missing header with unnumbered historical lines gets Needs review on every retry', async () => {
  const id = 901112
  await seedSurvivor(id)
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await app.importWooOrder(woo(id)), { id: 'woo-901112', created: false, reviewReason: 'saved_lines' })
    assert.equal((await readHeader(id)).exists(), false)
    assert.deepEqual(await readLines(id), [{ id: 'original', ...historicLine }])
  }
  assert.deepEqual(await app.checkWooOrderImports([id, 901111, 901115]), new Map([[id, 'saved_lines'], [901111, 'imported']]))
  assert.equal(ledgerIds.includes(id), false)
})

test('ledger-only, UC-only and split/reissued histories block order and line writes on every retry', async () => {
  for (const [id, reviewReason] of ledgerHistory) {
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await app.importWooOrder({ ...woo(id), number: 'different display number' }), {
        id: 'woo-' + id, created: false, reviewReason,
      })
      assert.equal((await readHeader(id)).exists(), false)
      assert.deepEqual(await readLines(id), [])
    }
    assert.deepEqual(ledgerIds.filter(n => n === id), [id, id])
  }
})

test('overlapping imports from two sessions create and acknowledge one order and one line', async () => {
  const id = 901113
  fixture.db = env.authenticatedContext('woo-fixture-b').firestore()
  const second = (await import(pathToFileURL(join(scratch, 'app.mjs')).href + '?session=b')).importWooOrder
  fixture.db = db
  const inputs = [app.importWooOrder(woo(id)), second(woo(id))]
  const outcomes = await Promise.all(inputs)
  assert.deepEqual(outcomes.map(r => r.id), ['woo-901113', 'woo-901113'])
  assert.deepEqual(outcomes.map(r => r.created).sort(), [false, true])
  assert.equal((await readHeader(id)).exists(), true)
  assert.equal((await readLines(id)).length, 1)
})

test('failed line preflight writes nothing and staff without Shipping remain denied', async () => {
  const id = 901114
  fixture.failLineRead = true
  try { await assert.rejects(app.importWooOrder(woo(id)), /Fictional line read failed/) }
  finally { delete fixture.failLineRead }
  assert.equal((await readHeader(id)).exists(), false)
  assert.deepEqual(await readLines(id), [])
  fixture.db = env.authenticatedContext('woo-fixture-no-shipping').firestore()
  try {
    const denied = (await import(pathToFileURL(join(scratch, 'app.mjs')).href + '?session=denied')).importWooOrder
    await assert.rejects(denied(woo(id)), error => error.code === 'permission-denied')
  } finally { fixture.db = db }
  assert.equal((await readHeader(id)).exists(), false)
})

test('real Woo table shows the review reason and allows retry after a failed verification', async () => {
  const known = 901116, stale = 901117, fresh = 901118
  const invoice = 900102, uc = 900103
  await seedSurvivor(known)
  fixture.cache = { rows: [known, stale, fresh, invoice, uc].map(woo), refunds: [] }
  const dom = new JSDOM('<div id="woo"></div>', { url: 'https://fictional.invalid/woo-sync' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router-dom')
  const host = document.getElementById('woo'), root = createRoot(host)
  const row = id => [...host.querySelectorAll('tr')].find(r => r.textContent.includes('Fictional buyer ' + id))
  const findImport = id => [...row(id).querySelectorAll('button')].find(b => b.textContent.trim() === 'Import')
  async function waitFor(predicate) {
    for (let i = 0; i < 80 && !predicate(); i++) await act(() => new Promise(resolve => setTimeout(resolve, 25)))
    assert.ok(predicate(), host.textContent.slice(-1800))
  }
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, {
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, React.createElement(app.Page))))
    await waitFor(() => row(known)?.textContent.includes('Needs review'))
    assert.equal(findImport(known), undefined)
    assert.ok(findImport(stale))
    await seedSurvivor(stale)
    await act(async () => findImport(stale).click())
    await waitFor(() => row(stale).textContent.includes('Needs review'))
    assert.equal(findImport(stale), undefined)
    assert.equal((await readHeader(stale)).exists(), false)
    assert.deepEqual(await readLines(stale), [{ id: 'original', ...historicLine }])
    for (const [id, message] of [[invoice, 'matching sales invoice'], [uc, 'matching UC Registry entry']]) {
      await act(async () => findImport(id).click())
      await waitFor(() => row(id).querySelector('[role=status]')?.textContent.includes(message))
      assert.equal(findImport(id), undefined)
    }
    fixture.failLedgerRead = true
    await act(async () => findImport(fresh).click())
    await waitFor(() => host.querySelector('[role=alert]')?.textContent.includes('Please try again.'))
    assert.ok(findImport(fresh))
    assert.equal((await readHeader(fresh)).exists(), false)
    assert.deepEqual(await readLines(fresh), [])
    delete fixture.failLedgerRead
    await act(async () => findImport(fresh).click())
    await waitFor(() => row(fresh).querySelector(`a[href="/shipments/woo-${fresh}"]`)?.textContent.includes('Imported'))
    assert.equal((await readLines(fresh)).length, 1)
  } finally {
    delete fixture.failLedgerRead
    await act(async () => root.unmount())
    dom.window.close()
    delete globalThis.window
    delete globalThis.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    delete fixture.cache
  }
})
