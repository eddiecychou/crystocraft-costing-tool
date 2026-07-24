// What the PI CSV export produces, and — the point of the feature — proof that
// the unpriced file carries no pricing.
//
// The page is admin-gated so the buttons cannot be clicked headlessly. This
// mirrors the column definitions from ProformaInvoicePrint.exportCsv and runs
// them through the real toCsv, so the file XiangXia opens can be read here.
//
// Prices below are deliberately distinctive (18.14, 460, 435.36) so a leak into
// the unpriced file is unmistakable rather than a plausible-looking number.
import { toCsv } from '../src/exportCsv.js'

let failed = 0
const check = (label, cond) => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
}

const cur = 'EUR'
const productLines = [
  { item_code: 'D0504-001-GMX', description: 'Triple Rose Bud - Free Stand', qty_ordered: 24, unit: 'pcs', unit_price: 18.14 },
  { item_code: '0001-179', description: '容興竹木製品有限公司 base', qty_ordered: 96, unit: 'pcs', unit_price: 2.5 },
]
const chargeLines = [
  { item_code: '', description: 'Freight', qty_ordered: null, unit_price: 460 },
]

// Mirrors exportCsv() in ProformaInvoicePrint.
function build(withPrices) {
  const rows = [
    ...productLines.map((l, i) => ({ n: i + 1, l, charge: false })),
    ...chargeLines.map((l, i) => ({ n: productLines.length + i + 1, l, charge: true })),
  ]
  const qtyOf = r => (r.charge ? '' : (parseFloat(r.l.qty_ordered) || 0))
  const upOf = r => (parseFloat(r.l.unit_price) || 0)
  const columns = [
    { label: '#', value: r => r.n },
    { label: 'Item Code', value: r => r.l.item_code || '', text: true },
    { label: 'Description', value: r => r.l.description || '' },
    { label: 'Qty', value: qtyOf },
    { label: 'Unit', value: r => (r.charge ? '' : (r.l.unit || '')) },
    ...(withPrices ? [
      { label: `Unit Price (${cur})`, value: upOf },
      { label: `Amount (${cur})`, value: r => (r.charge ? upOf(r) : (parseFloat(r.l.qty_ordered) || 0) * upOf(r)) },
    ] : []),
  ]
  return toCsv(columns, rows)
}

const priced = build(true)
const unpriced = build(false)

console.log('— with prices\n'); console.log(priced)
console.log('\n— no prices\n'); console.log(unpriced); console.log()

check('priced file has the unit price', priced.includes('18.14'))
check('priced file computes the amount 24 x 18.14 = 435.36', priced.includes('435.36'))
check('priced file carries the freight charge', priced.includes('460'))
check('priced file names the currency in the headers', priced.includes('Unit Price (EUR)'))

// The safety property, asserted several ways.
check('UNPRICED has no unit price', !unpriced.includes('18.14'))
check('UNPRICED has no line amount', !unpriced.includes('435.36'))
check('UNPRICED has no freight amount', !unpriced.includes('460'))
check('UNPRICED has no price column headers', !/price|amount/i.test(unpriced))
check('UNPRICED mentions no currency', !unpriced.includes(cur))

// It must still be a useful production document.
check('unpriced keeps the item code, text-forced', unpriced.includes('"=""D0504-001-GMX"""'))
check('unpriced keeps a code that Excel would otherwise eat', unpriced.includes('"=""0001-179"""'))
check('unpriced keeps the description', unpriced.includes('Triple Rose Bud'))
check('unpriced keeps Chinese text intact', unpriced.includes('容興竹木製品有限公司'))
check('unpriced keeps the quantity', unpriced.includes('"24"'))
check('unpriced still lists the charge line', unpriced.includes('Freight'))
check('charge line has a blank qty, as it prints', unpriced.split('\r\n').pop().includes('"3","","Freight","",""'))

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
