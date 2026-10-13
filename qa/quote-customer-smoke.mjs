import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from '../.qa-playwright/node_modules/playwright-core/index.mjs'

const stubs = {
  firebase: 'export const db = {}',
  firestore: `
    export const collection = () => ({})
    export const addDoc = async () => ({ id: 'new-quote' })
    export const serverTimestamp = () => new Date()
    export const doc = () => ({})
    export const getDoc = async () => ({ exists: () => false })
  `,
  customer: `
    export const CRM_CATEGORIES = ['Distributor', 'Small B2B', 'Gift / OEM', 'Crystal Fabric']
    export const RETAIL_TAG = 'Retail Customer'
    export const loadCustomers = async () => [
      { id: 'business', company_name: 'Acme Corporate', crm_category: 'Gift / OEM', tags: [], contacts: [{ id: 'c1', name: 'Annie' }] },
      { id: 'retail', company_name: 'Bella Shopper', crm_category: '', tags: ['Retail Customer'], contacts: [{ id: 'c2', name: 'Bella' }] },
      { id: 'both', company_name: 'Cross Channel', crm_category: 'Distributor', tags: ['Retail Customer'], contacts: [{ id: 'c3', name: 'Chris' }] },
      { id: 'unknown', company_name: 'Unclassified Client', crm_category: '', tags: [], contacts: [] },
    ]
    export const primaryContact = contacts => contacts?.[0] || null
    export const contactAddress = () => ''
  `,
  picker: 'export default function ContactPicker() { return null }',
}

await build({
  entryPoints: ['qa/quote-customer-preview.jsx'], bundle: true,
  outfile: 'qa/quote-customer-preview.js', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)domain\/customer$/ }, () => ({ path: 'customer', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)components\/ContactPicker$/ }, () => ({ path: 'picker', namespace: 'qa' }))
    b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: stubs[args.path], loader: 'js' }))
  } }],
})
execFileSync('node_modules/.bin/tailwindcss', [
  '-i', 'src/index.css', '-o', 'qa/quote-customer-preview.css',
  '--content', './src/**/*.{js,jsx},./qa/quote-customer-preview.jsx',
])
writeFileSync('qa/quote-customer-preview.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./quote-customer-preview.css"></head><body><div id="root"></div><script type="module" src="./quote-customer-preview.js"></script></body></html>')

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = join(process.cwd(), decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''))
  try { const body = readFileSync(path); res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }); res.end(body) }
  catch { res.writeHead(404); res.end('not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let passed = 0
const check = (name, condition) => { if (!condition) throw Error(name); passed++; console.log('ok', name) }

try {
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/qa/quote-customer-preview.html`)
    const customer = page.getByRole('combobox', { name: 'Select Existing Customer' })
    await page.getByRole('button', { name: 'B2C 2' }).waitFor()
    check(`${width}: URL-prefilled retail customer switches to B2C`, await page.getByRole('button', { name: 'B2C 2' }).getAttribute('aria-pressed') === 'true')
    check(`${width}: retail and overlapping accounts shown`, (await customer.locator('option').allTextContents()).some(s => s.includes('Bella Shopper')) && (await customer.locator('option').allTextContents()).some(s => s.includes('Cross Channel')))
    await page.getByRole('button', { name: 'B2B 2' }).click()
    check(`${width}: retail-only account retained as current selection`, (await customer.locator('option').allTextContents()).some(s => s.includes('Bella Shopper · current selection')))
    check(`${width}: B2B options exclude retail-only`, (await customer.locator('option').allTextContents()).some(s => s.includes('Acme Corporate')))
    await page.getByRole('searchbox', { name: 'Search customers' }).fill('Annie')
    check(`${width}: contact search narrows results`, (await customer.locator('option').allTextContents()).some(s => s.includes('Acme Corporate')) && !(await customer.locator('option').allTextContents()).some(s => s.includes('Cross Channel')))
    await customer.selectOption('business')
    check(`${width}: selection pre-fills client`, await page.getByRole('textbox', { name: 'Company / Client Name *' }).inputValue() === 'Acme Corporate')
    await page.getByRole('button', { name: 'All 4' }).click()
    check(`${width}: All includes unclassified`, (await customer.locator('option').allTextContents()).some(s => s.includes('Unclassified Client')))
    check(`${width}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${width}: no browser error`, errors.length === 0)
    if (width === 1280) await page.locator('form').screenshot({ path: '/private/tmp/quote-customer-desktop.png' })
    await page.close()
  }
} finally { await browser.close(); server.close() }
console.log(`${passed} quote customer browser checks passed`)
