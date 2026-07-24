// What the production-order component export actually produces.
//
// The card sits on an admin-gated order page, so the button cannot be clicked
// headlessly. This runs the real toCsv with the same column definitions, so the
// file XiangXia opens in Excel can be read here — the point being the Excel
// handling (BOM, text-forcing, formula guarding), which is what a naive join
// would get wrong.
//
//   node qa/bundle-headless.mjs qa/components-csv.mjs /tmp/c.mjs && node /tmp/c.mjs
import { toCsv } from '../src/exportCsv.js'

let failed = 0
const check = (label, cond) => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
}

// Pre-reserve preview: the richer shape.
const items = [
  { code: '0001-179', name: 'Butterfly body, gold', required: 480, inStock: 1200, after: 720 },
  { code: 'FM-2201', name: '容興竹木製品有限公司 base', required: 96, inStock: 40, after: -56 },
  { code: '00123', name: '=cmd|calc', required: 12, inStock: 12, after: 0 },
]
const requiredCsv = toCsv([
  { label: 'Component', value: r => r.code, text: true },
  { label: 'Name', value: r => r.name || '' },
  { label: 'Required', value: r => r.required },
  { label: 'In stock', value: r => r.inStock },
  { label: 'After reserve', value: r => r.after },
], items)

console.log('— required (pre-reserve)\n')
console.log(requiredCsv)
console.log()

check('code is text-forced so 0001-179 is not read as a date', requiredCsv.includes('"=""0001-179"""'))
check('leading zeros survive on 00123', requiredCsv.includes('"=""00123"""'))
check('Chinese supplier name passes through', requiredCsv.includes('容興竹木製品有限公司'))
check('a name starting with = is neutralised', requiredCsv.includes("'=cmd|calc"))
check('negative "after" stays a number, not text', requiredCsv.includes('"-56"'))
check('CRLF line endings for Excel', requiredCsv.includes('\r\n'))

// The formula guard must still hold for anything that is not a bare number.
const evil = toCsv([{ label: 'X', value: r => r.v }], [
  { v: "-2+cmd|' /C calc'!A0" }, { v: '=1+1' }, { v: '@SUM(A1)' }, { v: '+cmd' }, { v: '-3.5' },
])
console.log('\n— formula guard\n')
console.log(evil)
check('a formula disguised with a leading - is still neutralised', evil.includes(`'-2+cmd`))
check('= is neutralised', evil.includes("'=1+1"))
check('@ is neutralised', evil.includes("'@SUM(A1)"))
check('+ is neutralised', evil.includes("'+cmd"))
check('a negative decimal stays numeric', evil.includes('"-3.5"'))

// Reserved / consumed: stored lines are code + qty, names resolved at export.
const lines = [{ code: '0001-179', qty: 480 }, { code: 'FM-2201', qty: 96 }]
const nameByCode = { '0001-179': 'Butterfly body, gold', 'FM-2201': '容興竹木製品有限公司 base' }
const reservedCsv = toCsv([
  { label: 'Component', value: r => r.code, text: true },
  { label: 'Name', value: r => nameByCode[String(r.code || '').toUpperCase()] || '' },
  { label: 'Qty', value: r => r.qty },
], lines)

console.log('\n— reserved / consumed\n')
console.log(reservedCsv)
console.log()
check('stored lines get their names back', reservedCsv.includes('Butterfly body, gold'))
check('an unknown code still exports with a blank name, not a crash',
  toCsv([{ label: 'Component', value: r => r.code, text: true },
          { label: 'Name', value: r => nameByCode[r.code] || '' }], [{ code: 'NOPE' }]).includes('"=""NOPE"""'))

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
