// Seeded, write-free browser smoke of the real QuoteDetail -> product picker ->
// quote-line flow. Firestore and Storage are in-memory stubs; no live writes.
import { build } from 'esbuild'
import { writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from '../.qa-playwright/node_modules/playwright-core/index.mjs'

const ROOT = process.cwd()
const stubs = {
  firebase: 'export const db = {}; export const storage = {}',
  storage: `
    export const ref = () => ({})
    export const uploadBytes = async () => ({})
    export const getDownloadURL = async () => ''
    export const deleteObject = async () => ({})
  `,
  bank: `
    export const listBankAccounts = async () => []
    export const accountForCurrency = () => null
    export const formatBankDetails = () => ''
  `,
  assets: `
    export const loadCustomerAssets = async () => []
    export const TYPE_LABEL = {}
    export const CATEGORIES = []
    export const CATEGORY_LABEL = {}
  `,
  export: 'export default function QuoteExport() { return null }',
  firestore: `
    let rows = []
    let itemListener = null
    const quote = { client_name: 'Test Client', quote_currency: 'HKD', rmb_to_hkd: 1.16, usd_to_hkd: 7.8, eur_to_hkd: 8.9, status: 'draft', item_count: 0 }
    export const collection = (_, ...parts) => parts.join('/')
    export const doc = (_, ...parts) => parts.join('/')
    export const orderBy = () => null
    export const query = path => path
    export const serverTimestamp = () => 'now'
    export const onSnapshot = (_, cb) => { itemListener = cb; queueMicrotask(() => cb({ docs: rows.map((data, index) => ({ id: 'i' + index, data: () => data })) })); return () => { itemListener = null } }
    export const getDoc = async path => ({ exists: () => true, data: () => path === 'settings/exchange_rates' ? { USD: 7.8 } : quote })
    export const getDocs = async path => ({ docs: path === 'products' ? [{ id: 'p1', data: () => ({ name: 'Desk Clock', category: 'Accessories' }) }]
      : path === 'range_products' ? [{ id: 'r1', data: () => ({ description: 'Sacred Angel Freestand', design_type: 'Angels', moq: 100, gallery: [], variants: [
        { sku: 'D0011-001-C', description: 'Bohemia, Chrome', ws_price_usd: 6.44 },
        { sku: 'D0011-001-G', description: 'Bohemia, Gold', ws_price_usd: null },
      ] }) }]
      : [] })
    export const addDoc = async (path, data) => { if (path === 'client_quotes/q1/items') { rows.push(data); itemListener?.({ docs: rows.map((row, index) => ({ id: 'i' + index, data: () => row })) }) }; return { id: 'i' + (rows.length - 1) } }
    export const updateDoc = async (path, patch) => { if (path === 'client_quotes/q1') Object.assign(quote, patch); else if (path.startsWith('client_quotes/q1/items/')) { const index = Number(path.split('/').at(-1).slice(1)); Object.assign(rows[index], patch); itemListener?.({ docs: rows.map((row, i) => ({ id: 'i' + i, data: () => row })) }) } }
    export const deleteDoc = async () => {}
  `,
}
await build({
  entryPoints: ['qa/quote-detail-preview.jsx'], bundle: true,
  outfile: 'qa/quote-detail-preview.js', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'qa' }))
    b.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: 'storage', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)bankAccounts$/ }, () => ({ path: 'bank', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)customerAssets$/ }, () => ({ path: 'assets', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)QuoteExport$/ }, () => ({ path: 'export', namespace: 'qa' }))
    b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: stubs[args.path], loader: 'js' }))
  } }],
})
execFileSync('node_modules/.bin/tailwindcss', [
  '-i', 'src/index.css', '-o', 'qa/quote-detail-preview.css',
  '--content', './src/**/*.{js,jsx},./qa/quote-detail-preview.jsx',
])
writeFileSync('qa/quote-detail-preview.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./quote-detail-preview.css"></head><body><div id="root"></div><script type="module" src="./quote-detail-preview.js"></script></body></html>')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''))
  try { const body = readFileSync(path); res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(body) }
  catch { res.writeHead(404); res.end('not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let passed = 0
const check = (name, ok) => { if (!ok) throw Error(name); passed++; console.log('ok', name) }

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${server.address().port}/qa/quote-detail-preview.html`)
  await page.getByRole('button', { name: '+ Add Products' }).click()
  await page.getByRole('tab', { name: 'Crystocraft Range' }).click()
  await page.getByRole('button', { name: /D0011-001-C/ }).waitFor()
  await page.getByRole('button', { name: /D0011-001-C/ }).click()
  await page.getByRole('button', { name: 'Add 1 Product' }).click()
  await page.getByText('Sacred Angel Freestand · D0011-001-C').waitFor()
  check('priced live-shape variant added to quote', await page.getByText('Sacred Angel Freestand · D0011-001-C').count() === 1)
  check('MOQ 100 populated', await page.locator('input[type="number"][min="1"]').first().inputValue() === '100')
  check('USD 6.44 converted to HKD 50.23', await page.locator('input[type="number"][step="0.01"]').first().inputValue() === '50.23')
  check('priced line permits export', await page.getByRole('button', { name: 'Export', exact: true }).isEnabled())

  await page.getByRole('button', { name: '+ Add Products' }).click()
  await page.getByRole('tab', { name: 'Crystocraft Range' }).click()
  await page.getByRole('button', { name: /D0011-001-G/ }).click()
  await page.getByRole('button', { name: 'Add 1 Product' }).click()
  await page.getByText('Sacred Angel Freestand · D0011-001-G').waitFor()
  check('unpriced variant disables export', !(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled()))
  check('unpriced variant disables PI conversion', !(await page.getByRole('button', { name: /Convert to PI/ }).isEnabled()))
  check('no browser errors', errors.length === 0)
  await page.close()
} finally { await browser.close(); server.close() }
console.log(`${passed} quote detail browser checks passed`)
