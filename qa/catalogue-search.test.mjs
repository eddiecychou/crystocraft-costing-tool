import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import * as fixtures from './fixtures/catalogue-search.mjs'

// Render the real four page components. Only network-backed dependencies and
// unrelated image/export widgets are replaced; matching, keys, filters,
// visibility, URL constraints, storage and pagination run production code.
const rootDir = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const fixturePath = fileURLToPath(new URL('./fixtures/catalogue-search.mjs', import.meta.url))
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://catalogue.test' })
for (const key of ['window', 'document', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
dom.window.scrollTo = () => {}
const originalFetch = globalThis.fetch
globalThis.fetch = () => { throw Error('Network is forbidden in catalogue search tests') }
const { createRoot } = await import('react-dom/client')
let scratch, pages, Router, root, host, errors, originalError
const empty = 'export default function Empty(){return null}'
const stubs = {
  firebase: 'export const db={}; export const auth={currentUser:null}',
  criticalComponents: 'const components=[]; export const useComponents=()=>({components}); export const buildableFromComponents=()=>({qty:0,byPlating:{}})',
  crystalColors: 'const colors=[];export const useCrystalColors=()=>({colors});export const colorMap=()=>({})',
  currency: 'const rates={USD:7.8,HKD:1};export const useRates=()=>rates;export const wsPriceFactor=()=>1;export const convertFromUSD=x=>x;export const convertFromHKD=x=>x;export const fmtMoney=x=>String(x??"—")',
  formatMoq: 'export const useFormatMoq=()=>({labels:{},moq:{}})',
  useInViewOnce: 'export default ()=>[null,false]',
  CardImageCarousel: empty, ErpProductImport: empty, RangeCatalogueExport: empty,
  LoadingBar: empty, CollectionBand: empty, FavHeart: empty,
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-catalogue-search-'))
  await build({
    stdin: { contents: `export {default as adminRange} from './src/pages/Range.jsx';export {default as adminCorp} from './src/pages/Products.jsx';export {default as customerRange} from './src/customer/FigurineShop.jsx';export {default as customerCorp} from './src/customer/CorporateShop.jsx';export {MemoryRouter} from 'react-router-dom'`, resolveDir: rootDir },
    bundle: true, platform: 'node', mainFields: ['module', 'main'], format: 'esm', jsx: 'automatic', outfile: join(scratch, 'pages.mjs'),
    plugins: [{ name: 'offline-catalogue-boundaries', setup(b) {
      b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }))
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: fixturePath, external: true }))
      b.onResolve({ filter: /^\.\.?\// }, args => {
        const name = basename(args.path).replace(/\.(jsx?|tsx?)$/, '')
        if (Object.hasOwn(stubs, name)) return { path: name, namespace: 'catalogue-mock' }
      })
      b.onLoad({ filter: /.*/, namespace: 'catalogue-mock' }, args => ({ contents: stubs[args.path], loader: 'js' }))
    } }],
  })
  pages = await import(pathToFileURL(join(scratch, 'pages.mjs')))
  Router = pages.MemoryRouter
})
after(async () => { globalThis.fetch = originalFetch; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })
beforeEach(() => {
  sessionStorage.clear(); fixtures.reset(fixtures.catalogueData())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  errors = []; originalError = console.error; console.error = (...args) => errors.push(args.join(' '))
})
afterEach(async () => {
  try { await act(async () => root.unmount()) }
  finally { host.remove(); console.error = originalError }
  assert.deepEqual(errors, [], 'React errors/duplicate row keys must fail the test')
})
const surfaces = [
  { name: 'admin figurine', page: 'adminRange', prefix: 'rf', card: 'range-card-', term: 'ball', match: ['ball-1','ball-2','ball-late','hidden','retired'], category: 'Musical', categoryMatch: ['ball-1','ball-late','hidden','retired'] },
  { name: 'admin corporate', page: 'adminCorp', prefix: 'pf', card: 'product-card-', term: 'bottle', match: ['bottle-1','bottle-2','bottle-late','hidden','retired'], category: 'Accessories', categoryMatch: ['bottle-1','bottle-late','hidden','retired'] },
  { name: 'customer figurine', page: 'customerRange', prefix: 'fs', card: 'fig-card-', term: 'ball', match: ['ball-1','ball-2','ball-late'], category: 'Musical', categoryMatch: ['ball-1','ball-late'] },
  { name: 'customer corporate', page: 'customerCorp', prefix: 'cs', card: 'corp-card-', term: 'bottle', match: ['bottle-1','bottle-2','bottle-late'], category: 'Accessories', categoryMatch: ['bottle-1','bottle-late'] },
]
async function mount(s, route = '/', profile = {}) {
  await act(async () => root.render(React.createElement(Router, { initialEntries: [route], future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(pages[s.page], { profile: { base_currency:'USD', ...profile } }))))
}
const cards = s => [...host.querySelectorAll(`a[id^="${s.card}"]`)]
const ids = s => cards(s).map(el => el.id.slice(s.card.length)).sort()
async function search(value) {
  const input = [...host.querySelectorAll('input')].find(el => el.placeholder.startsWith('Search'))
  assert.ok(input, 'real catalogue search field must be present')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function click(label) {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent.trim().startsWith(label))
  assert.ok(button, `missing button ${label}`)
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
}
for (const s of surfaces) {
  test(`${s.name}: repeated search, case, no match and clear reconcile exact rows`, async () => {
    await mount(s)
    const initial = ids(s); assert.equal(initial.length, 24)
    for (const query of [s.term, s.term.toUpperCase(), 'no-such-product-xyz', s.term, '']) {
      await search(query)
      assert.deepEqual(ids(s), query === '' ? initial : query === 'no-such-product-xyz' ? [] : [...s.match].sort())
      assert.equal(new Set(cards(s).map(el => el.id)).size, cards(s).length)
    }
  })
  test(`${s.name}: searches beyond first page and resets expanded pagination`, async () => {
    await mount(s); await click('Load more'); assert.ok(ids(s).length > 24)
    await search(s.term); assert.ok(ids(s).includes(s.match.find(id => id.endsWith('late'))))
    await search(''); assert.equal(ids(s).length, 24)
  })
  test(`${s.name}: valid saved category/search survive loading and remount`, async () => {
    sessionStorage.setItem(`${s.prefix}-cat`, s.category); sessionStorage.setItem(`${s.prefix}-search`, s.term)
    fixtures.reset(fixtures.catalogueData(), { ready: false }); await mount(s)
    assert.equal(sessionStorage.getItem(`${s.prefix}-cat`), s.category)
    await act(async () => fixtures.publish())
    assert.deepEqual(ids(s), [...s.categoryMatch].sort())
    await act(async () => root.unmount()); root = createRoot(host); await mount(s)
    assert.deepEqual(ids(s), [...s.categoryMatch].sort())
  })
  test(`${s.name}: obsolete saved category cannot silently empty search results`, async () => {
    sessionStorage.setItem(`${s.prefix}-cat`, 'Deleted category'); await mount(s); await search(s.term)
    assert.equal(sessionStorage.getItem(`${s.prefix}-cat`), '')
    assert.deepEqual(ids(s), [...s.match].sort())
  })
  test(`${s.name}: new snapshot products join the current search without reload`, async () => {
    await mount(s); await search(s.term)
    const next = fixtures.catalogueData(), collection = s.page.endsWith('Range') ? 'range_products' : 'products'
    next[collection].push({ ...next[collection].find(p => p.id === s.match[0]), id: 'new-match' })
    await act(async () => fixtures.publish(next))
    assert.deepEqual(ids(s), [...s.match, 'new-match'].sort())
  })
}
for (const s of surfaces.filter(s => s.page !== 'customerCorp')) {
  test(`${s.name}: saved availability status still intersects with text search`, async () => {
    sessionStorage.setItem(`${s.prefix}-status`, 'concept')
    await mount(s); await search(s.term)
    assert.deepEqual(ids(s), [s.page === 'adminCorp' ? 'bottle-2' : 'ball-2'])
    await search('no-such-product-xyz'); assert.deepEqual(ids(s), [])
    await search(s.term.toUpperCase()); assert.deepEqual(ids(s), [s.page === 'adminCorp' ? 'bottle-2' : 'ball-2'])
  })
}
for (const s of surfaces.filter(s => s.page.endsWith('Range'))) {
  test(`${s.name}: design-code search works with repeated variant SKUs`, async () => {
    await mount(s); await search('D0327-001'); assert.deepEqual(ids(s), ['ball-1','ball-2'])
    if (s.page === 'adminRange') { await search('d0327-001-c'); assert.deepEqual(ids(s), ['ball-1','ball-2']) }
  })
}
test('customer figurine: URL design/format constraints still narrow text search', async () => {
  const s = surfaces[2]; await mount(s, '/?design=0327&format=001'); await search('ball')
  assert.deepEqual(ids(s), ['ball-1','ball-2']); await search('Zebra'); assert.deepEqual(ids(s), [])
})
test('customer corporate: search cannot restore a photo blocked for a sensitive customer', async () => {
  const data = fixtures.catalogueData()
  data['products/bottle-1/images'] = [{ id:'private', file_url:'https://example.test/private.jpg', visibility:'public', branded_for_customer_id:'other-client' }]
  data['products/bottle-2/images'] = [{ id:'safe', file_url:'https://example.test/safe.jpg', visibility:'public', branded_for_customer_id:'our-client' }]
  fixtures.reset(data); const s = surfaces[3]; await mount(s, '/', { sensitive:true, customer_id:'our-client' }); await search('bottle')
  assert.deepEqual(ids(s), ['bottle-2'])
  assert.ok(!host.innerHTML.includes('private.jpg'))
})
