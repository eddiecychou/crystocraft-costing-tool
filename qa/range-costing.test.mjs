import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { componentUnitCostAtQty, DEFAULT_MARKUP, totalUnitCostAtQty } from '../src/pricingCore.js'
import { projectRangeProduct } from '../netlify/functions/lib/customerRange.js'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

// Bundle the real page and calculations. Only file and network boundaries use fixtures.
const substitutes = {
  'firebase/firestore': `
    const fixture = () => globalThis.rangeCostingFixture
    const unexpected = () => { throw Error('Unexpected catalogue query') }
    export { unexpected as collection, unexpected as getDocs, unexpected as query,
      unexpected as where, unexpected as limit }
    export const doc = (_db, ...path) => path.join('/')
    const snapshot = data => ({ exists: () => data != null, data: () => data })
    export const getDoc = async path => {
      const data = await (path === 'settings/exchange_rates' ? fixture().rates : fixture().product)
      return snapshot(data)
    }
    export const updateDoc = async (path, patch) => {
      fixture().writes.push({ path, patch })
      fixture().product = { ...fixture().product, ...patch }
    }
    export const runTransaction = async (_db, run) => {
      const pending = []
      const result = await run({ get: getDoc, update: (...args) => pending.push(args) })
      for (const args of pending) await updateDoc(...args)
      return result
    }
    export const serverTimestamp = () => 'fictional server timestamp'
    export const setDoc = () => { throw Error('Unexpected settings write') }
    export const onSnapshot = (_path, next) => {
      next({ exists: () => true, data: () => ({ items: fixture().stones }) })
      return () => {}
    }
  `,
  '../firebase': 'export const db = {}; export const authedUser = async () => ({ uid: "fictional-pricing" })',
  './firebase': 'export const db = {}',
  '../criticalComponents': `
    export { resolveRef } from ${JSON.stringify(resolve('src/availability.js'))}
    export const useComponents = () => ({ components: globalThis.rangeCostingFixture.parts, loading: false })
  `,
  '../erpBomCoverage': 'export const checkBomCoverage = () => { throw Error("Unexpected ERP read") }',
  'react-router-dom': `
    import React from 'react'
    export const useParams = () => ({ id: 'fictional-design' })
    export const Link = ({ children }) => React.createElement('a', null, children)
  `,
}

const { outputFiles } = await build({
  stdin: {
    contents: 'export { default as Page } from "./src/pages/RangeCosting.jsx"; export * from "./src/rangeCosting.js"',
    resolveDir: process.cwd(),
  },
  platform: 'node',
  bundle: true,
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  plugins: [{
    name: 'fictional-costing-records',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(substitutes, path) ? { path, namespace: 'fixture' } : null)
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: substitutes[path],
        resolveDir: process.cwd(),
      }))
    },
  }],
})
const moduleFixture = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(
  createRequire(import.meta.url), moduleFixture, moduleFixture.exports,
)
const { Page, componentCostAtQty, rangePriceEstimate, variantAllInCostHKD } = moduleFixture.exports

const usdRate = 8
const completeRates = { HKD: 1, USD: usdRate, EUR: 8, RMB: 1.1 }
const variant = { brand_code: 'D', plating_code: 'G', plating_name: 'Gold', sku: 'DEMO-G' }
const basePart = { id: 'base', code: 'DEMO-PART', unit_cost: 10, unit_cost_currency: 'HKD' }
const euroPart = { id: 'eur', code: 'DEMO-EUR', unit_cost: 5, unit_cost_currency: 'EUR' }
const baseProduct = {
  design_no: '9999',
  format_code: '001',
  critical_components: [{ id: basePart.id }, { id: euroPart.id }],
  variants: [variant],
}
const estimate = (product, parts, rates, selected = variant, stones = []) =>
  rangePriceEstimate(product, parts, rates, selected, 10, stones)

test('both pricing flows use the base for blank legacy tiers and keep a priced zero', () => {
  for (const [price, expected] of [[undefined, 8], [null, 8], ['', 8], ['  ', 8], [0, 0], ['6', 6]]) {
    const quote = { unit_cost: 8, volume_tiers: [{ min_qty: 5, unit_cost: 7 }, { min_qty: 10, unit_cost: price }] }
    assert.equal(componentCostAtQty(quote, 10), expected)
    assert.equal(componentUnitCostAtQty(quote, 10), expected)
    assert.equal(componentCostAtQty(quote, 9), 7)
    assert.equal(componentCostAtQty(quote, 4), 8)
  }
  assert.equal(componentCostAtQty({ unit_cost: '' }, 10), null)
})

test('mixed currencies match Corporate Gifts and missing or unusable rates suppress the whole estimate', () => {
  const parts = [basePart, euroPart]
  const corporate = parts.map(preferred_quote => ({ preferred_quote, qty_per_product: 1 }))
  assert.equal(totalUnitCostAtQty(corporate, completeRates, 10), 50)
  assert.equal(variantAllInCostHKD(baseProduct, parts, completeRates, variant, 10, []), 50)
  assert.deepEqual(estimate(baseProduct, parts, completeRates).value, { costUSD: 6.25, sellUSD: 12.5 })
  for (const rate of [undefined, null, 0, -1, NaN]) {
    const rates = { ...completeRates, EUR: rate }
    assert.equal(totalUnitCostAtQty(corporate, rates, 10), null)
    assert.deepEqual(estimate(baseProduct, parts, rates), { value: null, reason: 'Exchange rate unavailable for EUR.' })
  }
  assert.match(estimate(baseProduct, parts, { ...completeRates, USD: 0 }).reason, /for USD/)
})

test('extra, plating, crystal and tooling costs all require a rate in their applicable scope', () => {
  const rates = { HKD: 1, USD: usdRate }
  const unsupportedCost = { cost: 5, currency: 'EUR' }
  const product = { ...baseProduct, critical_components: [{ id: basePart.id }] }
  const stone = { size: 'Demo stone', brand: 'Demo crystal' }
  const crystalLine = { ...stone, scope: 'D', qty: 2 }
  for (const [costing, parts = [basePart], stones = []] of [
    [{ extra_lines: [unsupportedCost] }],
    [{ plating_costs: { G: unsupportedCost } }],
    [{ crystal_bom: [crystalLine] }, [basePart], [{ ...stone, ...unsupportedCost }]],
    [{}, [{ ...basePart, tooling_sample_cost: 50, tooling_sample_cost_currency: 'EUR' }]],
  ]) {
    assert.match(estimate({ ...product, costing }, parts, rates, variant, stones).reason, /for EUR/)
  }
  const tooling = { ...basePart, tooling_sample_cost: 50, tooling_sample_cost_currency: 'HKD' }
  assert.deepEqual(estimate(product, [tooling], rates).value, { costUSD: 15 / 8, sellUSD: 30 / 8 })
  assert.equal(estimate({
    ...product,
    costing: { plating_costs: { C: unsupportedCost }, crystal_bom: [{ ...crystalLine, scope: 'A' }] },
  }, [basePart], rates).reason, '')
})

async function mount(fixture) {
  globalThis.rangeCostingFixture = fixture
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(React.createElement(Page)))
  const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label)
  return {
    host,
    button,
    click: label => act(async () => button(label).click()),
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('Range page isolates the affected colour, saves the draft, then publishes with complete rates', async () => {
  const fixture = {
    product: {
      ...baseProduct,
      variants: [{ ...variant, crystal_colors: ['BL', 'RE'] }],
      critical_components: [
        { id: basePart.id },
        { id: 'blue', crystal_code: 'BL', plating_code: 'G' },
        { id: euroPart.id, crystal_code: 'RE', plating_code: 'G' },
      ],
      costing: { tiers: [{ quantity: 10 }] },
    },
    parts: [basePart, { ...basePart, id: 'blue', unit_cost: 6 }, euroPart],
    rates: { USD: usdRate },
    stones: [],
    writes: [],
  }
  let view = await mount(fixture)
  try {
    const [blueRow, redRow] = view.host.querySelectorAll('tbody tr')
    assert.match(blueRow.textContent, /BL.*2\.00.*4\.00/)
    assert.match(redRow.textContent, /RE.*Exchange rate unavailable for EUR/)
    assert.equal(view.button('Save & publish').disabled, true)
    await view.click('Save & publish')
    assert.equal(fixture.writes.length, 0)
    await view.click('Save costing')
    assert.equal(fixture.writes.length, 1)
    assert.equal(fixture.writes[0].path, 'range_products/fictional-design')
    assert.equal(fixture.writes[0].patch.costing.published_at, undefined)
    assert.match(view.host.textContent, /Costing saved\./)

    await view.close()
    fixture.rates = { USD: usdRate, EUR: 8 }
    view = await mount(fixture)
    assert.match(view.host.querySelectorAll('tbody tr')[1].textContent, /RE.*6\.25.*12\.50/)
    assert.equal(view.button('Save & publish').disabled, false)
    await view.click('Save & publish')
    assert.equal(fixture.writes.length, 2)
    assert.equal(fixture.writes[1].patch.costing.published_at, 'fictional server timestamp')
    assert.match(view.host.textContent, /Costing saved and published\./)
  } finally {
    await view.close()
  }
})

test('a missing Settings document and the existing B0016 hold prevent publishing', async () => {
  for (const [product, rates, expected] of [
    [{ ...baseProduct, critical_components: [] }, undefined, /Exchange rate unavailable for USD/],
    [{ ...baseProduct, design_no: '0016', format_code: '000' }, completeRates, /B0016 pricing is on hold/],
    [{ ...baseProduct, design_no: '0016', format_code: '000', pricing_hold: { active: false } },
      completeRates, /B0016 pricing is on hold/],
  ]) {
    const fixture = { product, rates, parts: [basePart, euroPart], stones: [], writes: [] }
    const view = await mount(fixture)
    try {
      assert.match(view.host.textContent, expected)
      assert.equal(view.button('Save & publish').disabled, true)
      assert.equal(view.button('Save costing').disabled, false)
      assert.equal(view.button('Clear costing hold'), undefined)
      if (product.design_no === '0016') {
        assert.equal(view.button('Set costing hold'), undefined)
        await view.click('Save costing')
        assert.deepEqual(Object.keys(fixture.writes[0].patch), ['costing'])
        assert.equal(fixture.writes[0].patch.costing.published_at, undefined)
      }
    } finally {
      await view.close()
    }
  }
})

async function fill(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('a hold set in a second tab blocks stale publishing and preserves the first tab draft and buyer price', async () => {
  const product = { ...baseProduct, active: true, variants: [{ ...variant, ws_price_usd: 12 }] }
  const fixture = { product, rates: completeRates, parts: [basePart, euroPart], stones: [], writes: [] }
  const buyerBefore = projectRangeProduct('fictional-design', product, { ws_discount_pct: 90 })
  const tab = await mount(fixture)
  const otherTab = await mount(fixture)
  try {
    const draftMarkup = tab.host.querySelector(`input[placeholder="${DEFAULT_MARKUP.toFixed(2)}"]`)
    await fill(draftMarkup, '2.75')
    const reason = otherTab.host.querySelector('#range-costing-hold-reason')
    assert.equal(otherTab.button('Set costing hold').disabled, true)
    await fill(reason, '  Confirm packaging cost  ')
    await otherTab.click('Set costing hold')
    assert.deepEqual(Object.keys(fixture.writes[0].patch), ['pricing_hold'])
    assert.equal(fixture.product.pricing_hold.reason, 'Confirm packaging cost')
    assert.equal(tab.button('Save & publish').disabled, false)
    await tab.click('Save & publish')
    assert.equal(fixture.writes.length, 1)
    assert.equal(tab.host.querySelector('[role="alert"]').textContent, 'Error: Confirm packaging cost')
    assert.equal(tab.button('Save & publish').disabled, true)
    assert.equal(draftMarkup.value, '2.75')
    await tab.click('Save costing')
    assert.deepEqual(Object.keys(fixture.writes[1].patch), ['costing'])
    assert.equal(fixture.product.costing.markup, 2.75)
    assert.equal(fixture.product.costing.published_at, undefined)
    assert.equal(fixture.product.pricing_hold.active, true)
    assert.deepEqual(projectRangeProduct('fictional-design', fixture.product, { ws_discount_pct: 90 }), buyerBefore)
    assert.equal(buyerBefore.variants[0].customer_price_usd, 10.8)

    await tab.click('Clear costing hold')
    assert.equal(fixture.product.pricing_hold.active, false)
    assert.equal(tab.button('Save & publish').disabled, false)
    await tab.click('Save & publish')
    assert.equal(fixture.product.costing.published_at, 'fictional server timestamp')
    assert.equal(fixture.product.costing.markup_used, 2.75)
    assert.deepEqual(projectRangeProduct('fictional-design', fixture.product, { ws_discount_pct: 90 }), buyerBefore)
  } finally {
    await tab.close()
    await otherTab.close()
  }
})

test('stale publication keeps local edits when another tab has changed the costing', async () => {
  const fixture = { product: baseProduct, rates: completeRates, parts: [basePart, euroPart], stones: [], writes: [] }
  const view = await mount(fixture)
  try {
    const draftMarkup = view.host.querySelector(`input[placeholder="${DEFAULT_MARKUP.toFixed(2)}"]`)
    await fill(draftMarkup, '2.75')
    fixture.product = { ...baseProduct, costing: { markup: 3 } }
    await view.click('Save & publish')
    assert.match(view.host.querySelector('[role="alert"]').textContent, /Costing changed in another tab/)
    assert.equal(draftMarkup.value, '2.75')
    assert.equal(fixture.writes.length, 0)
    assert.equal(fixture.product.costing.markup, 3)
  } finally { await view.close() }
})
