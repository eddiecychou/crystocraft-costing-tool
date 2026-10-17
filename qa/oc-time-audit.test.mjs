import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { asOcDate, ocDateOnly, ocYear, ocDaysSince, formatOcDate, formatOcTime, formatOcDateTime, previousOcMonth, inOcLast30Days } from '../src/ocTime.js'
import { inDateRange, toCsv } from '../src/exportCsv.js'
import { summarySource } from '../src/customerSummary.js'

const zones = ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Asia/Hong_Kong']
function acrossZones(fn) {
  const previous = process.env.TZ
  try { for (const zone of zones) { process.env.TZ = zone; fn(zone) } }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
}
test('OC human timestamps, times and dates are identical across device zones', () => acrossZones(() => {
  assert.equal(formatOcDate('2026-10-17T16:30:00Z'), '18/10/2026')
  assert.equal(formatOcTime('2026-10-17T16:30:00Z'), '00:30:00')
  assert.equal(formatOcDateTime('2026-10-17T16:30:00Z'), '18/10/2026, 00:30:00')
  assert.equal(formatOcDateTime({ seconds: 1792254600 }), formatOcDateTime(new Date(1792254600000)))
  assert.equal(formatOcDateTime(undefined), ''); assert.equal(formatOcDate('invalid'), '')
}))
test('entered business dates and timezone-less OC/ERP wall times preserve Hong Kong meaning', () => acrossZones(() => {
  assert.equal(formatOcDate('2026-10-17'), '17/10/2026')
  assert.equal(formatOcDate('17 Oct 2026'), '17/10/2026')
  assert.equal(formatOcDate('2026/10/17'), '17/10/2026')
  assert.equal(formatOcDateTime('2026-10-17 09:15:00'), '17/10/2026, 09:15:00')
  assert.equal(asOcDate('2026-10-17T09:15').toISOString(), '2026-10-17T01:15:00.000Z')
  assert.equal(asOcDate('2026-10-17T09:15:00-04:00').toISOString(), '2026-10-17T13:15:00.000Z')
  assert.equal(asOcDate('2026-10-17').toISOString(), '2026-10-16T16:00:00.000Z')
}))
test('Hong Kong date defaults, numbering year and previous-month window cross midnight/year correctly', () => acrossZones(() => {
  const now = new Date('2026-12-31T16:00:00Z')
  assert.equal(ocDateOnly(now), '2027-01-01'); assert.equal(ocYear(now), 2027)
  assert.deepEqual(previousOcMonth(now), { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual(previousOcMonth(new Date('2028-02-29T16:00:00Z')), { from: '2028-02-01', to: '2028-02-29' })
  assert.equal(ocDaysSince('2026-10-17T15:59:00Z', new Date('2026-10-17T16:01:00Z')), 1)
}))
test('CSV date filters include a full Hong Kong day and last-30-days excludes future/older dates', () => acrossZones(() => {
  assert.equal(inDateRange(new Date('2026-10-17T16:00:00Z'), '2026-10-18', '2026-10-18'), true)
  assert.equal(inDateRange(new Date('2026-10-18T15:59:59Z'), '2026-10-18', '2026-10-18'), true)
  assert.equal(inDateRange(new Date('2026-10-18T16:00:00Z'), '2026-10-18', '2026-10-18'), false)
  assert.equal(inDateRange('2026-10-18', '2026-10-18', '2026-10-18'), true)
  assert.match(toCsv([{label:'Date',value:r=>r.date}],[{date:new Date('2026-10-17T16:30:00Z')}]),/2026-10-18/)
  const now = new Date('2026-10-17T16:00:00Z')
  assert.equal(inOcLast30Days('2026-09-19', now), true)
  assert.equal(inOcLast30Days('2026-09-18', now), false)
  assert.equal(inOcLast30Days('2026-10-19', now), false)
}))
test('AI evidence labels follow Hong Kong dates without changing stored instants', () => acrossZones(() => {
  const date = new Date('2026-10-17T16:30:00Z'), original = date.toISOString()
  assert.match(summarySource([{ date, description: 'Sample requested' }]).text, /\[2026-10-18\]/)
  assert.equal(date.toISOString(), original)
}))

let scratch, actual
const require = createRequire(import.meta.url)
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-time-audit-'))
  await build({ stdin: { contents: `export {default as QuotePDF} from './src/components/QuotePDF.jsx'; export {soYear} from './src/soNumber.js'; export {puYear} from './src/puNumber.js'`, resolveDir: process.cwd() },
    outfile: join(scratch, 'actual.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'no-live-clock-fixture', setup(b) {
      b.onResolve({ filter: /^(react(?:\/.*)?|@react-pdf\/renderer)$/ }, a => ({ path: require.resolve(a.path), external: true }))
      b.onResolve({ filter: /\.(ttf|png)$/ }, a => ({ path: resolve(a.resolveDir, a.path), namespace: 'asset' }))
      b.onLoad({ filter: /.*/, namespace: 'asset' }, a => ({ contents: `export default ${JSON.stringify(a.path)}`, loader: 'js' }))
      b.onResolve({ filter: /firebase\/firestore$|\/firebase$/ }, () => ({ path: 'no-writes', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const db={};export const doc=()=>{throw Error('Live write forbidden')};export const runTransaction=doc;`, loader: 'js' }))
    } }] })
  actual = await import(pathToFileURL(join(scratch, 'actual.mjs')))
})
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }) })
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '') }
test('real quote PDF and number generators use Hong Kong dates across device zones', () => acrossZones(() => {
  const now = new Date('2026-12-31T16:00:00Z')
  assert.equal(actual.soYear(now), '27'); assert.equal(actual.puYear(now), '27')
  const tree = actual.QuotePDF({ quote: { client_name: 'QA date fixture', quote_date: '2026-10-17', quote_currency: 'HKD' }, items: [], includeTotal: false })
  assert.match(text(tree), /17 October 2026/)
}))
async function sourceFiles(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.[jt]sx?$/.test(e.name) ? [join(dir, e.name)] : []))).flat() }
test('source audit blocks device-local date formatting, calendar getters and UTC today defaults', async () => {
  const violations = []
  for (const file of await sourceFiles('src')) {
    if (file === 'src/ocTime.js') continue
    const source = await readFile(file, 'utf8')
    for (const [name, pattern] of [
      ['date/time locale bypass', /\.toLocale(?:Date|Time)String\s*\(/],
      ['device calendar getter', /\.get(?:FullYear|Month|Date|Day|Hours|Minutes)\s*\(/],
      ['device midnight', /\.setHours\s*\(/],
      ['UTC today default', /new Date\(\)\.toISOString\(\)\.(?:slice\(0,\s*10\)|split\(['"]T['"]\))/],
      ['timestamp locale bypass', /\.toDate\?*\.?\([^\n]*\.toLocaleString/],
    ]) if (pattern.test(source)) violations.push(`${file}: ${name}`)
  }
  assert.deepEqual(violations, [])
})
