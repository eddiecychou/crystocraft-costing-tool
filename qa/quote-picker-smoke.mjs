import { build } from 'esbuild'
import { writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from '../.qa-playwright/node_modules/playwright-core/index.mjs'

const ROOT = process.cwd()
const stubs = {
  firebase: 'export const db = {}',
  firestore: `
    export const collection = (_, name) => name
    export const orderBy = name => name
    export const query = name => name
    export const getDocs = async name => ({ docs: name === 'products'
      ? [{ id: 'p1', data: () => ({ name: 'Desk Clock', category: 'Accessories' }) }]
      : [{ id: 'r1', data: () => ({ description: 'Butterfly Freestand', design_type: 'Butterflies', variants: [
          { sku: 'D0002-001-C', ws_price_usd: 4.11 },
          { sku: 'A0002-001-C', ws_price_usd: 3.61 },
        ] }) }],
    })
  `,
}
await build({
  entryPoints: ['qa/quote-picker-preview.jsx'], bundle: true,
  outfile: 'qa/quote-picker-preview.js', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'qa' }))
    b.onResolve({ filter: /(^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'qa' }))
    b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: stubs[args.path], loader: 'js' }))
  } }],
})
execFileSync('node_modules/.bin/tailwindcss', [
  '-i', 'src/index.css', '-o', 'qa/quote-picker-preview.css',
  '--content', './src/**/*.{js,jsx},./qa/quote-picker-preview.jsx',
])
writeFileSync('qa/quote-picker-preview.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./quote-picker-preview.css"></head><body><div id="root"></div><script type="module" src="./quote-picker-preview.js"></script></body></html>')

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
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/qa/quote-picker-preview.html`)
    await page.getByRole('button', { name: /Desk Clock/ }).waitFor()
    check(`${width}: corporate products initially shown`, await page.getByRole('button', { name: /Desk Clock/ }).count() === 1)
    await page.getByRole('tab', { name: 'Gift Range' }).click()
    await page.getByRole('button', { name: /D0002-001-C/ }).waitFor()
    if (width === 1280) await page.locator('[role="tablist"]').first().locator('..').locator('..').screenshot({ path: '/private/tmp/quote-picker-range-desktop.png' })
    check(`${width}: exact Gift Range SKU shown`, await page.getByRole('button', { name: /D0002-001-C/ }).count() === 1)
    check(`${width}: already-added SKU hidden`, await page.getByRole('button', { name: /A0002-001-C/ }).count() === 0)
    await page.getByRole('button', { name: /D0002-001-C/ }).click()
    await page.getByRole('tab', { name: 'Corporate Gifts' }).click()
    await page.getByRole('button', { name: /Desk Clock/ }).click()
    await page.getByRole('button', { name: 'Add 2 Products' }).click()
    check(`${width}: mixed catalogues selected`, (await page.getByTestId('added').textContent()) === 'range_products:r1:D0002-001-C:index-0,products:p1')
    check(`${width}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${width}: no browser error`, errors.length === 0)
    if (width === 1280) await page.locator('[role="tablist"]').first().locator('..').locator('..').screenshot({ path: '/private/tmp/quote-picker-desktop.png' })
    await page.close()
  }
} finally { await browser.close(); server.close() }
console.log(`${passed} quote picker browser checks passed`)
