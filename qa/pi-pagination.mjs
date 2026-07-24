// Does a long PI paginate without slicing a line in half?
//
// CuiLing reported that on a 52-line invoice, row 50's amount printed as "1,"
// with the rest lost across the page boundary, and row 49's total came out cut
// through the middle. That is a print-only fault: it does not appear on screen
// and no amount of linting sees it.
//
// This renders the PI's REAL print CSS — extracted from ProformaInvoicePrint.jsx
// rather than retyped, so it cannot drift from what ships — over 52 rows of
// mixed height, prints to PDF with the system Chrome (headless, no download),
// and rasterises each page so the boundaries can be looked at.
//
//   node qa/pi-pagination.mjs
//
// HONEST LIMIT (2026-07-24): this does NOT reproduce the artifact CuiLing
// reported. With the fix stripped out, headless Chrome still paginated cleanly
// here — it already avoids splitting a table row in this fixture — so the check
// passes either way and cannot prove the fix is what cured her PDF. Her render
// path differs (her own Chrome's print dialog, and a real PI has the header and
// bill-to block above the table, which moves every page boundary). What this
// does prove is that the shipped CSS paginates a long, mixed-height invoice
// cleanly across 3 pages with headers repeated and no block split. Treat a pass
// as "not broken", not as "her bug is fixed" — that needs her to re-print.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const run = promisify(execFile)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')

let failed = 0
const check = (label, cond) => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
}

// The print CSS exactly as it ships: the template literal inside <style>{`…`}</style>.
const src = fs.readFileSync(path.join(ROOT, 'src/pages/ProformaInvoicePrint.jsx'), 'utf8')
const css = src.slice(src.indexOf('<style>{`') + 9, src.indexOf('`}</style>'))
if (!css.includes('table.pi-lines')) { console.error('could not extract the print CSS'); process.exit(1) }
console.log(`extracted ${css.length} chars of the shipped print CSS`)

// 52 lines, matching the invoice that failed.
//
// Row HEIGHT has to vary. A first attempt used one uniform description, every
// row the same height, and they happened to land either side of the page
// boundary — so the check passed with the fix AND without it, which makes it no
// check at all. CuiLing's invoice has descriptions like "Crystal Teddy Bear
// Freestand with Blue Sapphire Heart Crystal" that wrap to two lines, and it is
// a tall row straddling the boundary that gets sliced. So the fixture mixes
// one-, two- and three-line descriptions to guarantee one lands on the break.
const DESCS = [
  'Mini Globe Music Box (Wood)',
  'Crystal Teddy Bear Freestand with Blue Sapphire Heart Crystal — gold plated, presented in a printed gift box',
  'Ballerina Music Box (Wood)',
  'Mini Hooded Owl Mobile Freestand (Gold plated with BOHEMIA Bordeaux crystals) supplied with a matching stand and an outer carton',
]
const AMOUNTS = []
const rows = Array.from({ length: 52 }, (_, i) => {
  const qty = 72
  const up = 10 + (i % 9) + i / 100
  const amt = (qty * up).toFixed(2)
  AMOUNTS.push(amt)
  return `<tr>
    <td>${i + 1}</td>
    <td class="pi-code">D0${String(500 + i)}-236-GC1</td>
    <td class="desc">${i + 1}. ${DESCS[i % DESCS.length]}</td>
    <td class="r">${qty} pcs</td>
    <td class="r">${up.toFixed(2)}</td>
    <td class="r">${amt}</td>
  </tr>`
}).join('\n')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="pi-doc">
<table class="pi-lines">
  <thead><tr><th>#</th><th>Item Code</th><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="pi-totals"><table><tbody>
  <tr><td class="k">Subtotal</td><td class="v">EUR 23,869.68</td></tr>
  <tr class="grand"><td class="k">Total</td><td class="v">EUR 23,869.68</td></tr>
</tbody></table></div>
<div class="pi-sign"><div><div class="space"></div><div class="line">ISSUED BY</div></div>
<div><div class="space"></div><div class="line">CONFIRMED BY</div></div></div>
</div></body></html>`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-'))
const htmlPath = path.join(tmp, 'pi.html')
const pdfPath = path.join(tmp, 'pi.pdf')
fs.writeFileSync(htmlPath, html)

await run(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox',
  `--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer',
  `file://${htmlPath}`,
], { timeout: 120000 })

const pages = (fs.readFileSync(pdfPath, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
console.log(`\nrendered ${pages} page(s)`)
check('the invoice really is multi-page (so the bug could occur)', pages >= 2)

// There is no text extractor on this machine (no pdftotext / mutool / qpdf) and
// a PDF's text streams are compressed, so reading the raw bytes proves nothing.
// Rasterise instead and LOOK at the page boundary — the same render/extract/
// rasterise loop qa/README.md sets out for the catalogue, and the only check
// that sees what CuiLing sees.
const OUT = path.join(ROOT, 'qa', 'out')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(pdfPath, path.join(OUT, 'pi-pagination.pdf'))

for (const n of Array.from({ length: pages }, (_, i) => i + 1)) {
  const one = path.join(OUT, `pi-page${n}.pdf`)
  await run('node', [path.join(ROOT, 'qa', 'extract-page.cjs'), pdfPath, String(n), one], { timeout: 60000 })
  // qlmanage only ever renders page 1, which is why each page is pulled out first.
  await run('qlmanage', ['-t', '-s', '1400', '-o', OUT, one], { timeout: 120000 }).catch(() => {})
}
const pngs = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).sort()
check('every page rasterised to a PNG to be looked at', pngs.length === pages)
console.log(`\n-> qa/out/  ${pngs.join('  ')}`)
console.log('   Look at the boundary between pages: no row may be sliced.')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${failed === 0 ? 'rendered — now look at the PNGs' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
