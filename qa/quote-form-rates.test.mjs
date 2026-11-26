import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_RATES } from '../src/domain/customerCurrency.js'

const dom = new JSDOM('<div id="root"></div>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { Simulate } = await import('react-dom/test-utils')
const host = document.getElementById('root')

let root, readRates, writes
globalThis.quoteRateFixture = {
  reference: (_db, ...path) => path.join('/'),
  async getDocFromServer(path) {
    assert.equal(path, 'settings/exchange_rates')
    const rates = await readRates()
    return { exists: () => rates != null, data: () => rates }
  },
  async addDoc(path, quote) {
    assert.equal(path, 'client_quotes')
    writes.push(quote)
    return { id: 'fictional-quote' }
  },
}
const stubs = {
  '../firebase': 'export const db = {}',
  'firebase/firestore': `const {reference, getDocFromServer, addDoc} = globalThis.quoteRateFixture;
    export { reference as collection, reference as doc, getDocFromServer, addDoc };
    export const serverTimestamp = () => 'fictional timestamp';`,
  '../domain/customer': `export const loadCustomers = async () => [];
    export const primaryContact = () => null, contactAddress = () => '', CRM_CATEGORIES = [], RETAIL_TAG = 'retail';`,
  '../components/ContactPicker': 'export default function ContactPicker() { return null }',
}
const { outputFiles } = await build({
  entryPoints: ['src/pages/QuoteForm.jsx'], bundle: true, platform: 'node', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-router-dom'],
  plugins: [{ name: 'fictional-quote-io', setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(stubs, path) ? { path, namespace: 'fixture' } : null)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: stubs[path] }))
  } }],
})
const bundled = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const QuoteForm = bundled.exports.default

const input = currency => host.querySelector(`#quote-${currency.toLowerCase()}_to_hkd`)
const rateValues = () => ['RMB', 'USD', 'EUR'].map(currency => input(currency).value)
const button = (label = 'Create Quote') => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const status = () => host.querySelector('#quote-rate-status').textContent
const fill = (element, value) => act(async () => Simulate.change(element, { target: { value } }))
const submit = () => act(async () => Simulate.submit(host.querySelector('form')))
const click = label => act(async () => button(label).click())
const completeRates = { RMB: 1.1686, USD: 8, EUR: 9.45 }

async function open(loader) {
  readRates = loader
  writes = []
  root = createRoot(host)
  await act(async () => root.render(React.createElement(MemoryRouter, {
    initialEntries: ['/quotes/new'], future: { v7_startTransition: true, v7_relativeSplatPath: true },
  }, React.createElement(QuoteForm))))
  await fill(host.querySelector('#quote-client-name'), 'Fictional Buyer')
}
afterEach(async () => { await act(async () => root?.unmount()); root = null })
after(() => dom.window.close())

async function assertSavedRates(expected) {
  assert.equal(button().disabled, false)
  await submit()
  assert.equal(writes.length, 1)
  const quote = writes[0]
  assert.equal(quote.client_name, 'Fictional Buyer')
  assert.deepEqual([quote.rmb_to_hkd, quote.usd_to_hkd, quote.eur_to_hkd], expected)
}

test('a delayed read fills untouched rates and saves the staff-entered rate at full precision', async () => {
  const pending = Promise.withResolvers()
  await open(() => pending.promise)
  await fill(input('USD'), '7.95125')
  assert.match(status(), /Loading exchange rates/)
  assert.equal(button().disabled, true)
  await submit()
  assert.deepEqual(writes, [])
  await act(async () => pending.resolve(completeRates))
  assert.deepEqual(rateValues(), ['1.1686', '7.95125', '9.45'])
  await assertSavedRates([1.1686, 7.95125, 9.45])
})

test('a field cleared before Settings returns remains blank and cannot be saved', async () => {
  const pending = Promise.withResolvers()
  await open(() => pending.promise)
  await fill(input('USD'), '7.95')
  await fill(input('USD'), '')
  await act(async () => pending.resolve(completeRates))
  assert.deepEqual(rateValues(), ['1.1686', '', '9.45'])
  assert.match(status(), /Enter a positive rate for USD/)
  for (const invalid of ['', '0', '-8', '1e999']) {
    await fill(input('USD'), invalid)
    assert.equal(button().disabled, true)
    await submit()
    assert.deepEqual(writes, [])
  }
  await fill(input('USD'), '8.001')
  await assertSavedRates([1.1686, 8.001, 9.45])
})

for (const [name, settings] of [
  ['missing document', null], ['missing currency', { ...completeRates, USD: undefined }],
  ['numeric string', { ...completeRates, USD: '8' }], ['text', { ...completeRates, USD: 'invalid' }],
  ['zero', { ...completeRates, USD: 0 }], ['negative', { ...completeRates, USD: -8 }],
  ['infinite', { ...completeRates, USD: Infinity }],
]) {
  test(`a ${name} requires manual entry or explicit use of suggested rates`, async () => {
    await open(() => settings)
    assert.equal(input('USD').value, '')
    assert.equal(input('USD').placeholder, String(DEFAULT_RATES.USD))
    assert.equal(button().disabled, true)
    await submit()
    assert.deepEqual(writes, [])
    await fill(input('EUR'), '9.555')
    await click('Use suggested rates')
    await assertSavedRates([settings?.RMB ?? DEFAULT_RATES.RMB, DEFAULT_RATES.USD, 9.555])
  })
}

test('a failed Settings read can be retried without losing a manually entered rate', async () => {
  await open(() => Promise.reject(Error('Fictional rate read failed')))
  assert.match(status(), /Could not load exchange rates/)
  await fill(input('USD'), '7.95')
  const pending = Promise.withResolvers()
  readRates = () => pending.promise
  await click('Retry rates')
  assert.match(status(), /Loading exchange rates/)
  await act(async () => pending.resolve(completeRates))
  await assertSavedRates([1.1686, 7.95, 9.45])
})

test('a complete set of explicitly entered rates can be saved during a slow read', async () => {
  const pending = Promise.withResolvers()
  await open(() => pending.promise)
  await fill(input('RMB'), '1.19')
  await fill(input('USD'), '7.95')
  await fill(input('EUR'), '9.48')
  await assertSavedRates([1.19, 7.95, 9.48])
  await act(async () => pending.resolve(completeRates))
  assert.deepEqual(rateValues(), ['1.19', '7.95', '9.48'])
})
