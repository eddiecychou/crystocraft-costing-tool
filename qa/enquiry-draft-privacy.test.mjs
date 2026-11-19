import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('switching buyers replaces the mounted draft and restores only the returning buyer’s items', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import { act } from 'react'
      import { createRoot } from 'react-dom/client'
      import { CartProvider, useCart } from './src/customer/store'
      const root = createRoot(document.getElementById('root'))
      function Draft() {
        const cart = useCart()
        window.cart = cart
        return <div>{cart.items.map(i => i.note).join(', ')}</div>
      }
      window.showBuyer = uid => act(() => root.render(<CartProvider uid={uid}><Draft /></CartProvider>))
      window.change = callback => act(callback)
    ` },
    jsx: 'automatic', bundle: true, write: false,
    plugins: [{ name: 'offline-firebase', setup(b) {
      b.onResolve({ filter: /^(\.\.\/firebase|firebase\/firestore)$/ }, () => ({path: 'firebase', namespace: 'fixture'}))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({contents: 'export const db={},doc=undefined,onSnapshot=undefined,setDoc=undefined,serverTimestamp=undefined'}))
    } }],
  })
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://buyer.example/', runScripts: 'outside-only' })
  const browser = dom.window
  try {
    browser.IS_REACT_ACT_ENVIRONMENT = true
    browser.eval(bundle.outputFiles[0].text)
    const storage = browser.localStorage
    storage.setItem('cc_cart', JSON.stringify([{ id: 'legacy', note: 'Unattributed' }]))
    const text = () => browser.document.body.textContent
    browser.showBuyer('buyer-a')
    assert.equal(text(), '')
    browser.change(() => browser.cart.add({ type: 'corporate', id: 'same-product', qty: 7, note: 'Only A' }))
    const oldCart = browser.cart
    browser.showBuyer('buyer-b')
    assert.equal(text(), '')
    browser.change(() => browser.cart.add({ type: 'corporate', id: 'same-product', qty: 14, note: 'Only B' }))
    browser.change(() => oldCart.clear())
    assert.equal(text(), 'Only B')
    browser.showBuyer(null)
    assert.equal(text(), '')
    browser.showBuyer('buyer-a')
    assert.equal(text(), 'Only A')
    assert.equal(browser.cart.items[0].qty, 7)
    browser.change(() => browser.cart.clear())
    browser.showBuyer('buyer-b')
    assert.equal(text(), 'Only B')
    assert.equal(browser.cart.items[0].qty, 14)
  } finally { browser.close() }
})
