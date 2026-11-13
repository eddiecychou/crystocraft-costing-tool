// Shared pure order schema, totals and validation. No browser/Firebase imports.
import {
  numOrNull,
  str,
  trimUpper,
  result,
  addWarning,
  addInfo,
  addError,
  merge
} from './domain/validation.js'
import { invoiceDepositError } from './invoicePayments.js'
import { invoiceReferenceRevision } from './invoiceRecoveryModel.js'

export const INCOTERMS = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP']

// Payment terms printed on the PI and the invoice — JES had this and the app
// dropped it (CuiLing, 2026-07-24). Free text on the order, because terms are
// negotiated per customer; these are the common ones offered as a datalist so
// the usual case is one click and the wording stays consistent.
export const PAYMENT_TERMS = [
  'Full Payment Before Shipment',
  'Full Payment Before 7 Days of Shipment',
  '30% Deposit, 70% Before Shipment',
  '50% Deposit, 50% Before Shipment',
  'T/T in Advance',
  'Net 30 Days'
]

// Currencies an order may be raised in. Measured, not assumed: AED, CAD, EUR,
// GBP, HKD, MXN and USD all appear on real sales orders since 2024, and RMB on
// purchases. Anything not listed here is coerced to USD by normOrder — so a
// missing currency is a silent corruption, not a validation error.
export const ORDER_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP', 'RMB', 'CAD', 'AED', 'MXN']

export const ORDER_STATUSES = [
  { value: 'draft', label: 'Draft', style: 'bg-ivory-dark text-ink-70' },
  { value: 'confirmed', label: 'Confirmed', style: 'bg-blue-50 text-blue-700' },
  { value: 'packing', label: 'Packing', style: 'bg-amber-50 text-amber-700' },
  { value: 'ready', label: 'Ready', style: 'bg-purple-50 text-purple-700' },
  { value: 'shipped', label: 'Shipped', style: 'bg-teal-50 text-teal-700' },
  { value: 'delivered', label: 'Delivered', style: 'bg-green-50 text-green-700' }
]
export const orderStatusOf = (v) =>
  ORDER_STATUSES.find((s) => s.value === v) || ORDER_STATUSES[0]

// Reasons an order legitimately never gets an app invoice. Each removes it from
// the "no invoice recorded" list, and says which of three quite different
// things happened — the list is a worklist, so an unexplained dismissal would
// just move the ambiguity somewhere less visible.
export const NO_INVOICE_REASONS = [
  {
    value: 'invoiced_in_jes',
    label: 'Invoiced in JES',
    hint: 'The invoice exists, in the old system'
  },
  {
    value: 'on_hold',
    label: 'On hold',
    hint: 'Customer is holding it up — invoice later'
  },
  { value: 'cancelled', label: 'Cancelled', hint: 'Order will not be invoiced at all' }
]
export const noInvoiceReasonOf = (v) =>
  NO_INVOICE_REASONS.find((r) => r.value === v) || null

// Line classification (reconciliation). `non_product` = charge/service, excluded
// from packing. Everything else is packable.
export const LINE_TYPES = [
  {
    value: 'range',
    label: 'Crystocraft Range',
    packable: true,
    style: 'bg-indigo-50 text-indigo-700'
  },
  {
    value: 'corp_gift',
    label: 'Corp Gift',
    packable: true,
    style: 'bg-sky-50 text-sky-700'
  },
  {
    value: 'ad_hoc',
    label: 'Ad-hoc',
    packable: true,
    style: 'bg-amber-50 text-amber-700'
  },
  {
    value: 'non_product',
    label: 'Charge',
    packable: false,
    style: 'bg-ivory-dark text-ink-60'
  }
]
export const lineTypeOf = (v) => LINE_TYPES.find((t) => t.value === v) || LINE_TYPES[2]
export const isPackable = (v) => lineTypeOf(v).packable

// The order's UC reference, wherever it happens to live.
//
// Orders created before 2026-07-21 carry it in erp_pi_no (the field then
// labelled "PI Number"); everything since carries it in uc_no. Every read must
// go through here, because treating a legacy order as having no UC is not a
// display bug — doAllocateSi() allocates a fresh UC when it finds none, which
// would issue a second UC for an order that already has one. That is the exact
// duplicate-UC slip the invoice-chained allocation was built to stop.
export const orderUc = (o) => (o && (o.uc_no || o.erp_pi_no)) || ''

// erp_so_no is really a catch-all "primary ERP document number": the import
// parser writes whatever reference it read into it, so it can hold an SO
// (SO260031), a quote (QU260709), or — for imported invoices / older JES
// records — an SI (SI260085). That's why an SI can appear under a column
// labelled "SO #" (Cindy, 2026-07-31). These two helpers split it back apart
// for display without any data migration:
//   orderSi(o)         — the order's invoice number, whether it's in its own
//                        erp_si_no field or landed in erp_so_no on import.
//   orderSoDisplay(o)  — erp_so_no ONLY when it's a real SO/QU, blank when the
//                        value is actually an SI (so the "SO #" column stops
//                        showing invoice numbers).
const looksLikeSi = (v) => /^SI/i.test((v || '').trim())
export const orderSi = (o) =>
  (o && (o.erp_si_no || (looksLikeSi(o.erp_so_no) ? o.erp_so_no.trim() : ''))) || ''
export const orderSoDisplay = (o) =>
  o && !looksLikeSi(o.erp_so_no) ? o.erp_so_no || '' : ''

// Every value a real creation path writes: 'imported_pi' (PI/PDF parsed via
// Gemini vision), 'manual' (typed by hand, no source document), 'direct_invoice'
// (the retail "Direct Invoice" flow), 'duplicated' (Shipping.jsx's Duplicate
// order), 'in_app_quote' (SH-08's server-owned quote conversion), 'woocommerce' (the
// B2C sync's importer — docs/specs/WooCommerce_B2C_Sync_Spec.md Phase 2). Anything else
// (blank/unrecognised, e.g. a pre-2026-08-17 order — see bug-fix pack B-02)
// falls back to 'imported_pi', which was every order's value before this list
// existed, so old records keep reading exactly as they did.
const ORDER_SOURCES = [
  'imported_pi',
  'manual',
  'direct_invoice',
  'duplicated',
  'in_app_quote',
  'woocommerce'
]
export const normOrder = (o) => ({
  ...(o.quote_conversion_id ? { quote_conversion_id: o.quote_conversion_id } : {}),
  ...(o.invoice_allocation_id
    ? {
        invoice_allocation_id: o.invoice_allocation_id,
        invoice_reference_revision: invoiceReferenceRevision(o)
      }
    : {}),
  source: ORDER_SOURCES.includes(o.source) ? o.source : 'imported_pi',
  client_quote_id: o.client_quote_id || null,
  // LEGACY — do not write to this, read it through orderUc() below.
  //
  // This was labelled "PI Number" and every one of the 78 orders that has it
  // holds a UC reference in it (UC4948/26, UC4946/26, …), never a PI number of
  // its own. That is not a coincidence: the team's "PI" is JES's SO, which has
  // its own field (erp_so_no), so there was never a third document number for
  // this field to hold. CuiLing reported it as a duplicate of UC# on
  // 2026-07-21 and she is right — they are one field that got entered twice.
  //
  // Kept in the schema so existing data is preserved and round-trips on save.
  // New writes go to uc_no.
  erp_pi_no: str(o.erp_pi_no),
  erp_so_no: str(o.erp_so_no),
  // The CUSTOMER's own purchase order number — their reference, not ours.
  // JES carries it as salesorder.sopono (exposed as customer_po on
  // erp_sales_order); the app had no field for it, so the packing list was
  // printing our SO number under "PO NO", which is the one number the
  // customer's own receiving desk cannot match against anything.
  customer_po: str(o.customer_po),
  // The sales invoice number (SI######). Its own field: without one, SI numbers
  // were being typed into erp_so_no, so the order list showed "SI260085" in a
  // column headed SO and the two document numbers could not be told apart.
  //
  // THE INVARIANT (owner, 2026-07-20; confirmed in the ERP): an invoice must
  // carry a UC number, but need NOT have a sales order or PI behind it. Smaller
  // retail transactions are invoiced directly.
  //
  // The data agrees emphatically. raw.salesinvoice.siref holds the UC — and
  // 0 of 516 invoices since 2024 have an empty siref. There is no SO-reference
  // column on salesinvoice at all: JES links an invoice to a UC, never to an
  // order. Roughly 19% of the registry is Online Shop / Amazon / Alibaba, the
  // retail channels this describes.
  //
  // So uc_no is the required key on the invoice path; erp_so_no and erp_pi_no
  // are optional. Anything validating an invoice must check the UC, not the SO.
  erp_si_no: str(o.erp_si_no),
  invoiced_at: o.invoiced_at || null,
  // The editable accounting date, separate from invoiced_at (the allocation
  // timestamp — stamped once, by doAllocateSi, and never touched again).
  // Printed invoice / financial reports use invoice_date, falling back to
  // invoiced_at when unset (see SalesInvoicePrint.jsx).
  invoice_date: o.invoice_date || null,
  // What finance actually records, vs total_amount (line-derived, immutable —
  // same rule as pi_total). Only meaningful once the order is invoiced.
  // adjustment = accounting_total − total_amount; adjustment_reason is
  // mandatory whenever the gap is nonzero (SR-05, enforced in ShipmentForm and
  // again server-side in /api/uc).
  accounting_total: numOrNull(o.accounting_total),
  adjustment: numOrNull(o.adjustment),
  adjustment_reason: str(o.adjustment_reason),
  // Why this order will never be invoiced in the app. Without it, a shipped
  // order with no SI can only ever be "outstanding" — so a cancelled order and
  // one the customer is sitting on look identical to one genuinely awaiting an
  // invoice, and the awaiting list can never reach zero.
  //
  // NOT a status. 'cancelled' as a pipeline status would erase the fact that
  // the goods actually shipped, and these orders keep their real status; this
  // records a separate decision about invoicing.
  no_invoice_reason: NO_INVOICE_REASONS.some((r) => r.value === o.no_invoice_reason)
    ? o.no_invoice_reason
    : '',
  no_invoice_at: o.no_invoice_at || null,
  // The app's UC reference (full form, e.g. "UC4950/26"). Free text — usually
  // typed in from Cindy's list, same as today. It is set automatically in two
  // places: "Duplicate order" allocates a fresh one rather than copying the
  // source order's, and allocating an invoice number allocates a UC if the
  // order has none.
  //
  // THE ONLY field for this reference as of 2026-07-21. Read it via orderUc()
  // so legacy orders that hold it in erp_pi_no are not treated as having none.
  uc_no: str(o.uc_no),
  customer_id: o.customer_id || '',
  // The specific customer contact this order's PI/invoice should address —
  // an override on top of the customer's default (starred) contact, picked
  // per-order via ContactPicker in ShipmentForm.jsx. Was missing from this
  // whitelist entirely (found 2026-08-19): the write path (handleSave) saved
  // it correctly, but every READ went through normOrder, which silently
  // dropped any field not listed here — so the picker reset to blank on
  // reload, and ProformaInvoicePrint.jsx/SalesInvoicePrint.jsx's
  // `order.contact_id` lookup always missed and fell back to
  // primaryContact(), regardless of what was actually selected and saved.
  contact_id: o.contact_id || null,
  customer_name: str(o.customer_name),
  order_date: o.order_date || null,
  // The projected shipment date printed on the PI — a commitment to the
  // customer, separate from the shipment record's actual date (which only
  // exists once goods have actually gone). JES's own PI template carried this
  // as "Est. Ship Date"; the app's PI dropped it when the layout was rebuilt.
  est_ship_date: o.est_ship_date || null,
  // Every currency seen on a real sales order since 2024 (measured against
  // raw.salesorder): AED, CAD, EUR, GBP, HKD, MXN, USD — plus RMB for purchases.
  // The old whitelist was ['HKD','RMB','USD','EUR'], which silently coerced a
  // GBP or CAD order to USD: same number, wrong currency, no warning. Cindy's
  // audit rate table covers GBP, CAD and MXN, so these reach the books.
  currency: ORDER_CURRENCIES.includes(o.currency) ? o.currency : 'USD',
  incoterm: INCOTERMS.includes(o.incoterm) ? o.incoterm : 'FOB',
  payment_terms: str(o.payment_terms),
  destination: {
    country: str(o.destination?.country),
    city: str(o.destination?.city),
    address: str(o.destination?.address),
    port: str(o.destination?.port)
  },
  status: ORDER_STATUSES.some((s) => s.value === o.status) ? o.status : 'draft',
  source_file: o.source_file || null,
  notes: str(o.notes),
  // subtotal / total_amount are the order's ACTUAL value, computed from the
  // lines. pi_subtotal / pi_total are the figures the imported PI stated, kept
  // only as the cross-check reference — editing lines must move the former and
  // never the latter (CuiLing, 2026-07-23: the total should follow the lines).
  subtotal: numOrNull(o.subtotal),
  discount_pct: numOrNull(o.discount_pct),
  discount_amount: numOrNull(o.discount_amount),
  deposit_paid: numOrNull(o.deposit_paid),
  total_amount: numOrNull(o.total_amount),
  pi_subtotal: numOrNull(o.pi_subtotal),
  pi_total: numOrNull(o.pi_total),
  // WooCommerce B2C sync (docs/specs/WooCommerce_B2C_Sync_Spec.md §2.1/§2.3). woo_order_id
  // is also encoded into the doc's own Firestore ID (see wooImport.js's
  // wooOrderDocId) so a re-import can never create a duplicate order even
  // under a race — but it's kept here too since a doc ID isn't queryable as a
  // field. woo_order_no is WooCommerce's OWN order number (e.g. "57844"),
  // kept separate from erp_so_no/erp_si_no/uc_no — none of which this order
  // has until it is actually invoiced — for the "easy cross-reference"
  // spec §3.4 asked for.
  channel: o.channel || null,
  woo_order_id: numOrNull(o.woo_order_id),
  woo_order_no: str(o.woo_order_no),
  // Structured fee/payout figures for the Phase 5 accounting export
  // (docs/specs/WooCommerce_B2C_Sync_Spec.md §8). Originally these only existed folded
  // into a human-readable line in `notes` (for the printed invoice's
  // Remarks) — that's fine to read, but useless to EXPORT as its own column,
  // which is exactly what §8 needs. Both now co-exist: notes keeps the
  // readable summary, these carry the same figures as real numbers/dates.
  woo_fee: numOrNull(o.woo_fee),
  woo_net_payout: numOrNull(o.woo_net_payout),
  woo_net_payout_hkd: numOrNull(o.woo_net_payout_hkd),
  woo_payout_date: o.woo_payout_date || null,
  // Print option: hide the combined "Total Qty" line on the printed PI/
  // Sales Invoice (ProformaInvoicePrint.jsx/SalesInvoicePrint.jsx). Learned
  // from the contact_id trap documented above — every field the print pages
  // or the form read back from Firestore MUST be listed here, or normOrder
  // silently drops it on every read regardless of what the write path saved.
  hide_total_qty: !!o.hide_total_qty,
  // Revision number shown on the printed PI/Invoice (2026-08-26) — a
  // customer who's seen an earlier version of the same document needs a
  // clear "this one's newer" marker after a price/qty change, not just a
  // silently updated PDF that looks identical to the last one they have.
  // 0/null prints nothing ("Original"); bumped by hand via the + New Rev
  // button in ShipmentForm.jsx, never automatically — not every edit is
  // worth telling the customer about.
  pi_revision: numOrNull(o.pi_revision)
})

export const DEFAULT_ORDER_LINE_UNIT = 'pcs'

export const normLine = (l) => {
  const type = LINE_TYPES.some((t) => t.value === l.line_type) ? l.line_type : null
  return {
    line_no: numOrNull(l.line_no),
    item_code: str(l.item_code),
    description: str(l.description),
    tier_remarks: str(l.tier_remarks),
    qty_ordered: numOrNull(l.qty_ordered),
    unit: str(l.unit) || DEFAULT_ORDER_LINE_UNIT,
    unit_price: numOrNull(l.unit_price),
    line_type: type, // null until reconciled
    packable: type ? isPackable(type) : true,
    // Optional picture for this line on the Proforma / Sales Invoice. A plain
    // URL, chosen by hand (see components/LineImagePicker) — corp-gift line
    // codes are bespoke per order, not catalogue SKUs, so there is nothing to
    // derive it from. Deliberately NOT a product reference: it says "print
    // this picture on this line", not "this line IS that catalogue product".
    line_image: str(l.line_image) || null,
    matched_product_ref: l.matched_product_ref || null,
    match_status: ['matched', 'unmatched', 'manual'].includes(l.match_status)
      ? l.match_status
      : 'unmatched'
  }
}

export function computeOrderTotals(header, lines) {
  let subtotal = 0,
    chargesTotal = 0
  for (const l of lines || []) {
    const qty = parseFloat(l.qty_ordered) || 0
    const up = parseFloat(l.unit_price) || 0
    if (qty > 0) subtotal += qty * up
    else chargesTotal += up
  }
  const discPct = parseFloat(header?.discount_pct) || 0
  const discountAmount =
    parseFloat(header?.discount_amount) ||
    (discPct > 0 ? +((subtotal * discPct) / 100).toFixed(2) : 0)
  const total = +(subtotal - discountAmount + chargesTotal).toFixed(2)
  return {
    subtotal: +subtotal.toFixed(2),
    chargesTotal: +chargesTotal.toFixed(2),
    discountAmount,
    total
  }
}

const PLATING_SUFFIXES = ['C', 'G', 'R', 'A', 'M']
// Plating inferred from the trailing item-code segment ('D0002-230-C' → 'C').
const platingOf = (code) => {
  const parts = trimUpper(code).split('-')
  const last = parts[parts.length - 1]
  return PLATING_SUFFIXES.includes(last) ? last : ''
}

export function validateOrderLine(line) {
  const r = result()
  const l = normLine(line || {})
  const label = l.item_code || (l.line_no != null ? `line ${l.line_no}` : 'line')
  if (l.line_type === 'range') {
    if (!l.matched_product_ref && l.match_status !== 'manual')
      addWarning(
        r,
        'orderline.range.match_missing',
        'matched_product_ref',
        `${label}: Crystocraft Range line not matched to a product`
      )
    if (!platingOf(l.item_code))
      addInfo(
        r,
        'orderline.range.plating_unresolved',
        'item_code',
        `${label}: plating not resolved from item code`
      )
  }
  return r
}

// validateOrder(order[, lines]). When lines are supplied, line-level results and
// a parsed-vs-computed total discrepancy are folded in. Parsed totals are never
// overwritten — a mismatch is surfaced as info (spec: snapshot historical records).
export function validateOrder(order, lines = null) {
  const o = normOrder(order || {})
  const r = result()
  const depositError = invoiceDepositError(
    order,
    Array.isArray(lines)
      ? computeOrderTotals(order, lines).total
      : (o.total_amount ?? Infinity)
  )
  if (depositError)
    addError(r, 'order.invoice.deposit_invalid', 'deposit_paid', depositError)
  if (!o.customer_id)
    addWarning(
      r,
      'order.customer.unresolved',
      'customer_id',
      'Order not linked to a customer'
    )

  // SR-05: accounting_total may differ from the calculated total (rounding,
  // fees, FX), but never silently — a nonzero gap needs a stated reason.
  // Checked against total_amount (the persisted, line-derived fact) rather
  // than recomputing from lines, so this also catches drift in stored records
  // via the Schema Audit page, not only at save time.
  if (o.accounting_total != null && o.total_amount != null) {
    const adj = Math.round((o.accounting_total - o.total_amount) * 100) / 100
    if (Math.abs(adj) > 0.005 && !o.adjustment_reason)
      addError(
        r,
        'order.invoice.adjustment_reason_required',
        'adjustment_reason',
        'Accounting total differs from the calculated total — a reason is required'
      )
  }

  if (Array.isArray(lines) && lines.length) {
    const lineResults = lines.map(validateOrderLine)
    const lineSum = lines.reduce(
      (s, l) => s + (numOrNull(l.qty_ordered) || 0) * (numOrNull(l.unit_price) || 0),
      0
    )
    const ref = o.subtotal != null ? o.subtotal : o.total_amount
    if (ref != null && lineSum > 0 && Math.abs(ref - lineSum) > Math.max(1, ref * 0.005))
      addInfo(
        r,
        'order.total.discrepancy',
        'total_amount',
        `Parsed total ${ref} differs from line sum ${lineSum.toFixed(2)}`
      )
    return merge(r, ...lineResults)
  }
  return r
}
