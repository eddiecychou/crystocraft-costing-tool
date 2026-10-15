import { build } from 'esbuild'
import { writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

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
          { sku: 'D0002-001-C', brand_name: 'Bohemia', ws_price_usd: 4.11 },
          { sku: 'D0002-001-C', brand_name: 'Asfour', ws_price_usd: 3.61 },
          { sku: 'A0002-001-C', ws_price_usd: 3.61 },
        ] }) }, { id: 'r2', data: () => ({ description: 'Ballerina Freestand', design_code: '0327', design_type: 'Musical', variants: [{ sku: 'D0327-001-C', ws_price_usd: 3.37 }] }) }],
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
await new Promise(resolve => server.listen(5191, '127.0.0.1', resolve))
console.log('Quote picker fixture ready: http://127.0.0.1:5191/qa/quote-picker-preview.html')
