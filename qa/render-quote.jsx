// Headless render of the real QuotePDF — verifies the 2026-08-27 fixes
// (image/description gap, footer-as-fixed, page-break grouping) without a
// browser or a deploy. See qa/README.md for the run steps.
//
// A tiny solid-colour PNG stands in for a real product photo — good enough
// to check the gap fix, and keeps this file self-contained (no external
// asset to keep in sync).
import ReactPDF from '@react-pdf/renderer'
import QuotePDF from '../src/components/QuotePDF.jsx'

const TEST_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGOsmHaCAQaY4Cy8HABcgAHeAk3NjAAAAABJRU5ErkJggg=='

// Worst case on purpose: enough items with enough tiers each to force a
// real page break partway through the item table, so the footer-on-every-
// page and closing-section-grouping fixes actually get exercised.
const quote = {
  client_name: 'La Salle Primary School PTA',
  contact_name: 'Heymans Ho',
  contact_email: 'heymans12@hotmail.com',
  contact_phone: '',
  contact_address: '',
  quote_currency: 'HKD',
  quote_no: 'QU260826-1',
  ref_no: '',
  quote_date: '2026-08-26',
  bank_snapshot: [
    'Beneficiary: United Art Metals Factory Limited',
    'Beneficiary Bank: HSBC Mong Kok Branch',
    'Bank Address: 2/F., HSBC Building Mong Kok, 673 Nathan Road, Mong Kok, Hong Kong, Hong Kong',
    'Account No: 004-534-754262-001',
    'SWIFT: HSBCHKHHHKH',
    'Accepted Payments: FPS 轉數快 ID: 167979624',
  ].join('\n'),
  notes: 'Payment terms : 50% deposit, balance before shipment.\nDelivery : Hong Kong (one time shipment).',
}

const items = Array.from({ length: 7 }, (_, i) => ({
  product_name: `Sample Product ${i + 1}`,
  product_category: 'Corp Gift',
  product_description: 'A reasonably long description line to check the gap between the product image and this text column, wrapping across two or more lines.',
  item_remarks: i % 2 === 0 ? 'Custom remark for this line item.' : '',
  _imageData: TEST_IMG,
  tiers: [
    { quantity: 100, price: 30 },
    { quantity: 200, price: 25 },
    { quantity: 500, price: 20 },
    { quantity: 1000, price: 18 },
  ],
}))

ReactPDF.render(
  <QuotePDF quote={quote} items={items} includeTotal={false} />,
  process.argv[2],
).then(() => console.log('rendered ->', process.argv[2]))
 .catch(e => { console.error('RENDER FAILED:', e.message); process.exit(1) })
