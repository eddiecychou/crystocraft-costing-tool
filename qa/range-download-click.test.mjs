import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const repo = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://catalogue.test/shop/figurine/qa' })
for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const originalFetch = globalThis.fetch
globalThis.fetch = () => { throw Error('Live network forbidden in Range download regressions') }
const forbidden = `()=>{throw Error('A photo download must not write business data')}`
const stubs = {
  firebase: 'export const db={}',
  firestore: `export const doc=(_, ...path)=>path.join('/');export const onSnapshot=(path,cb)=>{if(path!=='range_products/qa')throw Error('Unexpected read');cb({exists:()=>true,data:()=>globalThis.__rangeDownloadProduct});return ()=>{}}`,
  currency: 'export const useRates=()=>({});export const wsPriceFactor=()=>1;export const convertFromUSD=x=>x;export const fmtMoney=x=>String(x??"—")',
  crystalColors: 'export const useCrystalColors=()=>({colors:[]});export const colorMap=()=>({})',
  formatMoq: 'export const useFormatMoq=()=>({labels:{},moq:{}})',
  store: `const cart={items:[],has:()=>false,add:${forbidden}};export const useCart=()=>cart;export const designGroupKey=()=>'';export const formatGroupKey=()=>''`,
  useCustomerAvailability: 'export default ()=>({availability:{buildable:10,verified:true},loading:false,retry:()=>{}})',
  FavHeart: 'export default ()=>null',
}
let scratch, pages
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-range-download-'))
  await build({
    stdin: { contents: `export {default as Page} from './src/customer/FigurineDetail.jsx';export {MemoryRouter,Routes,Route} from 'react-router-dom'`, resolveDir: repo },
    bundle: true, platform: 'node', mainFields: ['module', 'main'], format: 'esm', jsx: 'automatic', outfile: join(scratch, 'page.mjs'),
    plugins: [{ name: 'offline-range-download-boundaries', setup(b) {
      b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, a => ({ path: require.resolve(a.path), external: true }))
      b.onResolve({ filter: /^firebase\/firestore$|^\.\.?\// }, a => {
        const name = basename(a.path).replace(/\.(jsx?|tsx?)$/, '')
        if (Object.hasOwn(stubs, name)) return { path: name, namespace: 'fixture' }
      })
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js' }))
    } }],
  })
  pages = await import(pathToFileURL(join(scratch, 'page.mjs')))
})
after(async () => { globalThis.fetch = originalFetch; delete globalThis.__rangeDownloadProduct; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })

for (const name of ['Heart & Sunflower Freestand', 'Mini Heart(w/ Slot)', '水晶蝴蝶音樂盒 — 特別版', '水晶蝴蝶音乐盒 & “纪念版” (14mm)', "Café & Angel's – “Edition” (14mm)"]) {
  test(`customer photo click requests a download and retains the product page: ${name}`, async () => {
    const images = [
      { url: 'https://www.crystocraft.com/wp-content/uploads/qa.jpg', caption: 'Photo (Chrome)' },
      { url: 'https://firebasestorage.googleapis.com/v0/b/demo/o/qa.jpg?alt=media&token=fixture', caption: '' },
    ]
    const product = { description: name, design_name: 'Internal design name', design_no: '0002', format_code: '236', status: 'concept', gallery: images, variants: [{ brand_code: 'D', plating_code: 'C', plating_name: 'Chrome' }] }
    globalThis.__rangeDownloadProduct = structuredClone(product)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(React.createElement(pages.MemoryRouter, { initialEntries: ['/shop/figurine/qa'], future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(pages.Routes, null, React.createElement(pages.Route, { path: '/shop/figurine/:id', element: React.createElement(pages.Page, { profile: { base_currency: 'USD' } }) })))))
      const links = [...host.querySelectorAll('a[title="Download this photo"]')]
      assert.equal(links.length, 2)
      for (const [index, link] of links.entries()) {
        assert.ok(link.hasAttribute('download'), 'Chrome must receive a download action rather than attachment-page navigation')
        assert.equal(link.download, `${name}${images[index].caption ? ` - ${images[index].caption}` : ''}.jpg`)
        assert.equal(link.target, '')
        const url = new URL(link.href)
        assert.equal(url.origin, 'https://catalogue.test')
        assert.equal(url.pathname, '/api/download-image')
        assert.equal(url.searchParams.get('url'), images[index].url)
        assert.equal(url.searchParams.get('filename'), `${name}${images[index].caption ? ` - ${images[index].caption}` : ''}.jpg`)
        assert.equal(url.searchParams.get('normalize'), index === 1 ? 'jpeg' : null)
        // Observe the actual named native download action; prevent only JSDOM's
        // unsupported save. The product link's own handler must cancel navigation.
        const downloads = []
        const observe = e => {
          if (e.target.tagName === 'A' && e.target.parentElement === document.body) {
            downloads.push({ href: e.target.href, name: e.target.download })
            e.preventDefault()
          }
        }
        document.addEventListener('click', observe, true)
        const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
        try { await act(async () => link.dispatchEvent(click)) }
        finally { document.removeEventListener('click', observe, true) }
        assert.equal(click.defaultPrevented, true)
        assert.deepEqual(downloads, [{ href: link.href, name: link.download }])
        assert.equal(document.querySelectorAll('body > a').length, 0)
        assert.equal(host.querySelector('h1').textContent, name)
        assert.equal(host.querySelector('button[aria-label="Close"]'), null)
      }
      assert.deepEqual(globalThis.__rangeDownloadProduct, product)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
}
