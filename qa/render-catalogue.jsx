// Headless render of the real RangeCataloguePDF, with data shaped exactly like
// RangeCatalogueExport builds it. Lets the layout be inspected without a
// browser, a deploy, or the owner doing the QA.
import ReactPDF from '@react-pdf/renderer'
import RangeCataloguePDF from '../src/components/RangeCataloguePDF.jsx'

// Worst cases on purpose: many price rows, long labels, a retired note, an odd
// trailing card, multi-brand row codes — everything that broke the real output.
const long = 'Bohemia AX Crystals, Chrome Plated'
const rows = n => Array.from({ length: n }, (_, i) => ({
  code: i % 2 ? `A0023-001-C` : `D0023-001-C`,
  plating: i % 3 === 0 ? long : 'Bohemia Crystals, Gold Plated',
  price: `USD ${(2 + i * 0.37).toFixed(2)}`,
}))

const product = (code, name, nRows, note) => ({
  code, name, note: note ? 'Retired Stock — no further production, while supplies last' : '',
  image: null, prices: rows(nRows),
})

const groups = [{
  title: 'ANGELS',
  products: [
    product('D/A0009-001', 'Sacred Angel Freestand', 6, true),
    product('D0010-001', 'Angel (Hymn Book) Freestand', 1, true),
    product('D0011-001', 'Sacred Angel(Lyre) Freestand', 2, false),
    product('D0018-001', 'Angel (Trumpet) Freestand', 4, true),
    product('D0019-001', 'Flying Angel(Heart) Freestand', 3, false),
    product('D0022-001', 'Mini Sacred Angel(Cross) Freestand', 6, true),
    product('M0014-236', 'Guardian Angel Music Box (Wood Body)', 2, false),
  ],
}, {
  title: 'ZODIAC',
  products: [product('D0259-001', 'Zodiac Gemini Freestand', 6, false)],
}]

ReactPDF.render(
  <RangeCataloguePDF
    account="Mascot USA" currency="USD"
    validity="Prices valid 30 days from issue · USD"
    groups={groups} generatedAt={new Date('2026-07-21')}
  />,
  process.argv[2],
).then(() => console.log('rendered ->', process.argv[2]))
 .catch(e => { console.error('RENDER FAILED:', e.message); process.exit(1) })
