import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const dom = new JSDOM('<body><div id="root"></div></body>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

// Render the actual OC editor. Fake the Firestore boundary only.
const substitutes = {
  '../firebase': 'export const db = {}',
  './firebase': 'export const db = {}',
  '../accountPricing': 'export const loadAccountPricing = async () => ({})',
  'firebase/firestore': 'export const { doc, collection, query, orderBy, getDoc, getDocFromServer, getDocs, onSnapshot, updateDoc, setDoc, writeBatch, addDoc, deleteDoc, serverTimestamp, deleteField } = globalThis.corporatePricingFixture',
}
const { outputFiles } = await build({
  entryPoints: ['src/pages/PricingTiers.jsx'],
  bundle: true, platform: 'node', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-router-dom'],
  plugins: [{ name: 'fictional-corporate-pricing', setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) =>
      Object.hasOwn(substitutes, path) ? { path, namespace: 'fixture' } : null)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: substitutes[path] }))
  } }],
})

const productPath = 'products/fictional-product'
const tierPath = `${productPath}/pricing_tiers/fictional-tier`
const buyerPricePath = `${productPath}/customer_prices/fictional-buyer`
const agreedQuotePath = 'client_quotes/fictional-existing-quote'
const originalProduct = {
  name: 'Fictional gift', prices_published_at: { seconds: 1760000000 },
  prices_signature: 'original signature', pricing_summary: [{ quantity: 100, price_hkd: 1499 }],
}
const originalTier = { quantity: 100, price_hkd: 1499, production_lead_time_days: 21 }
const originalBuyerPrice = { tiers: [{ quantity: 100, price_hkd: 1399, lead_time_days: 21 }] }
const agreedQuote = { status: 'sent', quote_currency: 'HKD', rmb_to_hkd: 1.23, usd_to_hkd: 8.25, eur_to_hkd: 9.45 }
const priorPrices = [originalProduct, originalTier, originalBuyerPrice, agreedQuote]

let root, records, writes, userReads, readRates
const host = document.getElementById('root')
const snapshot = (path, data) => ({
  id: path.split('/').at(-1), exists: () => data != null, data: () => structuredClone(data),
})
const list = path => ({ docs: [...records.entries()]
  .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  .map(([key, data]) => snapshot(key, data)) })
const save = async (path, patch) => {
  writes.push(path)
  records.set(path, { ...records.get(path), ...structuredClone(patch) })
}
const ref = (_db, ...path) => path.join('/')
globalThis.corporatePricingFixture = {
  doc: ref, collection: ref, query: path => path, orderBy: () => null,
  getDoc: async path => {
    assert.notEqual(path, 'settings/exchange_rates', 'Publication must use a server read')
    return snapshot(path, records.get(path))
  },
  getDocFromServer: async path => {
    assert.equal(path, 'settings/exchange_rates')
    return snapshot(path, await readRates())
  },
  getDocs: async path => {
    if (path === 'users') userReads++
    return list(path)
  },
  onSnapshot(path, next) {
    next(path === 'settings/pricing_groups' ? snapshot(path, null) : list(path))
    return () => {}
  },
  updateDoc: save, setDoc: save,
  writeBatch() {
    const pending = []
    return { set: (...args) => pending.push(args), commit: () => Promise.all(pending.map(args => save(...args))) }
  },
  addDoc: () => assert.fail('Unexpected addition'), deleteDoc: () => assert.fail('Unexpected deletion'),
  serverTimestamp: () => 'fictional server timestamp', deleteField: () => null,
}

const bundled = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const PricingTiers = bundled.exports.default

async function open(rates, quoteFields = {}) {
  readRates = rates
  writes = []
  userReads = 0
  records = new Map([
    [productPath, originalProduct], [tierPath, originalTier], [buyerPricePath, originalBuyerPrice], [agreedQuotePath, agreedQuote],
    [`${productPath}/components/part`, { name: 'Fictional part', qty_per_product: 1 }],
    [`${productPath}/components/part/supplier_quotes/source`, { is_preferred: true, unit_cost: 100, unit_cost_currency: 'USD', ...quoteFields }],
    ['users/fictional-buyer', { role: 'customer', status: 'approved' }],
  ])
  root = createRoot(host)
  await act(async () => root.render(React.createElement(MemoryRouter, {
    initialEntries: [`/${productPath}/pricing`], future: { v7_startTransition: true, v7_relativeSplatPath: true },
  }, React.createElement(Routes, null, React.createElement(Route, {
    path: '/products/:id/pricing', element: React.createElement(PricingTiers),
  })))))
}
afterEach(async () => { await act(async () => root?.unmount()); root = null })
after(() => dom.window.close())

const button = (label = /^(Publish prices|Re-publish)$/) => [...host.querySelectorAll('button')].find(b => label.test(b.textContent))
async function expectBlocked(message) {
  assert.match(host.querySelector('[role="status"]').textContent, message)
  assert.match(host.textContent, /Last published prices are kept/)
  assert.equal(button().disabled, true)
  await act(async () => button().click())
  assert.equal(userReads, 0)
  assert.deepEqual(writes, [])
  assert.deepEqual([productPath, tierPath, buyerPricePath, agreedQuotePath].map(path => records.get(path)), priorPrices)
}

async function expectPublished(price) {
  assert.equal(button().disabled, false)
  await act(async () => button().click())
  assert.match(host.textContent, /Published prices to 1 customer/)
  assert.deepEqual(writes, [buyerPricePath, tierPath, productPath])
  assert.equal(records.get(buyerPricePath).tiers[0].price_hkd, price)
  assert.equal(records.get(tierPath).price_hkd, price)
  assert.equal(records.get(productPath).pricing_summary[0].price_hkd, price)
  assert.deepEqual(records.get(agreedQuotePath), agreedQuote)
}

test('waiting for a required rate preserves previous prices until an explicit publish', async () => {
  const pending = Promise.withResolvers()
  await open(() => pending.promise)
  await expectBlocked(/Loading exchange rates for USD/)
  await act(async () => pending.resolve({ USD: 8, EUR: '' }))
  assert.deepEqual(writes, [])
  await expectPublished(1600)
})

test('a missing Settings document blocks publication', async () => {
  await open(() => null)
  await expectBlocked(/No exchange rates have been configured.*USD/)
})

for (const [name, value] of Object.entries({ missing: undefined, text: 'invalid', 'numeric text': '8', zero: 0, negative: -8, infinite: Infinity, NaN })) {
  test(`a ${name} required Settings rate blocks publication`, async () => {
    await open(() => ({ RMB: 1.21, USD: value }))
    await expectBlocked(/No valid HKD exchange rate for USD/)
  })
}

test('a failed read can be retried, and CNY tooling requires a configured RMB rate', async () => {
  await open(() => Promise.reject(Error('Fictional Settings failure')), {
    unit_cost_currency: 'HKD', volume_tiers: [{ min_qty: 100, unit_cost: 80 }],
    tooling_sample_cost: 500, tooling_sample_cost_currency: 'CNY',
  })
  await expectBlocked(/Could not load exchange rates.*RMB/)
  const pending = Promise.withResolvers()
  readRates = () => pending.promise
  await act(async () => button(/^Retry rates$/).click())
  await expectBlocked(/Loading exchange rates for RMB/)
  await act(async () => pending.resolve({ RMB: 1.2, HKD: 25 }))
  await expectPublished(172)
})

test('HKD-only quotes can publish while unrelated rates are loading or invalid', async () => {
  const pending = Promise.withResolvers()
  await open(() => pending.promise, { unit_cost_currency: 'HKD' })
  await expectPublished(200)
  await act(async () => pending.resolve({ USD: 8, RMB: 0, HKD: 25 }))
  assert.equal(button().textContent, 'Re-publish')
  assert.match(host.textContent, /Up to date/)
})
