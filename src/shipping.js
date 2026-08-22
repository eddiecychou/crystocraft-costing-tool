import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, runTransaction,
} from 'firebase/firestore'
import { db } from './firebase'
import { numOrNull, str, trimUpper, result, addWarning, addInfo, addError, merge } from './domain/validation'
import { buildProductIndex, matchProductCode } from './criticalComponents'
import { JES_SEED_BY_YEAR, soYear, formatSoNo } from './soNumber'

// Shipping module — Phase 12.0. An `order` is the commercial anchor for a
// shipment, sourced from an in-app won quote (Path A) or an imported ERP
// proforma invoice (Path B, figurine-only for v1). The app CONSUMES the PI; it
// never authors it (guardrail 1). Order lines are classified in reconciliation
// (guardrail 4) — every line gets a type, and only packable lines reach the
// packing list.
//
//   orders/{id}
//   orders/{id}/lines/{lineId}

// ── Constants ─────────────────────────────────────────────────────────────────

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
  'Net 30 Days',
]

// Currencies an order may be raised in. Measured, not assumed: AED, CAD, EUR,
// GBP, HKD, MXN and USD all appear on real sales orders since 2024, and RMB on
// purchases. Anything not listed here is coerced to USD by normOrder — so a
// missing currency is a silent corruption, not a validation error.
export const ORDER_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP', 'RMB', 'CAD', 'AED', 'MXN']

export const ORDER_STATUSES = [
  { value: 'draft',     label: 'Draft',     style: 'bg-gray-100 text-gray-600' },
  { value: 'confirmed', label: 'Confirmed', style: 'bg-blue-50 text-blue-700' },
  { value: 'packing',   label: 'Packing',   style: 'bg-amber-50 text-amber-700' },
  { value: 'ready',     label: 'Ready',     style: 'bg-purple-50 text-purple-700' },
  { value: 'shipped',   label: 'Shipped',   style: 'bg-teal-50 text-teal-700' },
  { value: 'delivered', label: 'Delivered', style: 'bg-green-50 text-green-700' },
]
export const orderStatusOf = v => ORDER_STATUSES.find(s => s.value === v) || ORDER_STATUSES[0]

// Reasons an order legitimately never gets an app invoice. Each removes it from
// the "no invoice recorded" list, and says which of three quite different
// things happened — the list is a worklist, so an unexplained dismissal would
// just move the ambiguity somewhere less visible.
export const NO_INVOICE_REASONS = [
  { value: 'invoiced_in_jes', label: 'Invoiced in JES',  hint: 'The invoice exists, in the old system' },
  { value: 'on_hold',         label: 'On hold',          hint: 'Customer is holding it up — invoice later' },
  { value: 'cancelled',       label: 'Cancelled',        hint: 'Order will not be invoiced at all' },
]
export const noInvoiceReasonOf = v => NO_INVOICE_REASONS.find(r => r.value === v) || null


// Line classification (reconciliation). `non_product` = charge/service, excluded
// from packing. Everything else is packable.
export const LINE_TYPES = [
  { value: 'range',       label: 'Figurine',  packable: true,  style: 'bg-indigo-50 text-indigo-700' },
  { value: 'corp_gift',   label: 'Corp Gift', packable: true,  style: 'bg-sky-50 text-sky-700' },
  { value: 'ad_hoc',      label: 'Ad-hoc',    packable: true,  style: 'bg-amber-50 text-amber-700' },
  { value: 'non_product', label: 'Charge',    packable: false, style: 'bg-gray-100 text-gray-500' },
]
export const lineTypeOf = v => LINE_TYPES.find(t => t.value === v) || LINE_TYPES[2]
export const isPackable = v => lineTypeOf(v).packable

// ── SKU matcher (PI line → figurine product) ─────────────────────────────────
// Delegates to the shared, format-aware matcher (buildProductIndex +
// matchProductCode) so PI reconciliation, the stock-list import, and the MRP
// explosion all agree. Matching on design core ALONE is wrong: "D0355-001"
// (Mini Rose Freestand, format 001) and "D0355-230" (Mini Rose w/ Crystal Bible,
// format 230) share design 0355 but are different products — the format
// disambiguates them.
export function matchRangeProduct(itemCode, rangeProducts) {
  return itemCode ? matchProductCode(itemCode, buildProductIndex(rangeProducts)) : null
}

// ── orders ────────────────────────────────────────────────────────────────────

// The order's UC reference, wherever it happens to live.
//
// Orders created before 2026-07-21 carry it in erp_pi_no (the field then
// labelled "PI Number"); everything since carries it in uc_no. Every read must
// go through here, because treating a legacy order as having no UC is not a
// display bug — doAllocateSi() allocates a fresh UC when it finds none, which
// would issue a second UC for an order that already has one. That is the exact
// duplicate-UC slip the invoice-chained allocation was built to stop.
export const orderUc = o => (o && (o.uc_no || o.erp_pi_no)) || ''

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
const looksLikeSi = v => /^SI/i.test((v || '').trim())
export const orderSi = o => (o && (o.erp_si_no || (looksLikeSi(o.erp_so_no) ? o.erp_so_no.trim() : ''))) || ''
export const orderSoDisplay = o => (o && !looksLikeSi(o.erp_so_no) ? (o.erp_so_no || '') : '')

const ORDERS = () => collection(db, 'orders')
const LINES  = orderId => collection(db, 'orders', orderId, 'lines')

// Every value a real creation path writes: 'imported_pi' (PI/PDF parsed via
// Gemini vision), 'manual' (typed by hand, no source document), 'direct_invoice'
// (the retail "Direct Invoice" flow), 'duplicated' (Shipping.jsx's Duplicate
// order), 'in_app_quote' (reserved — quote-to-order conversion doesn't exist
// yet; no code writes this today, kept for when it does), 'woocommerce' (the
// B2C sync's importer — WooCommerce_B2C_Sync_Spec.md Phase 2). Anything else
// (blank/unrecognised, e.g. a pre-2026-08-17 order — see bug-fix pack B-02)
// falls back to 'imported_pi', which was every order's value before this list
// existed, so old records keep reading exactly as they did.
const ORDER_SOURCES = ['imported_pi', 'manual', 'direct_invoice', 'duplicated', 'in_app_quote', 'woocommerce']
export const normOrder = o => ({
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
  no_invoice_reason: NO_INVOICE_REASONS.some(r => r.value === o.no_invoice_reason)
    ? o.no_invoice_reason : '',
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
    port: str(o.destination?.port),
  },
  status: ORDER_STATUSES.some(s => s.value === o.status) ? o.status : 'draft',
  source_file: o.source_file || null,
  notes: str(o.notes),
  // subtotal / total_amount are the order's ACTUAL value, computed from the
  // lines. pi_subtotal / pi_total are the figures the imported PI stated, kept
  // only as the cross-check reference — editing lines must move the former and
  // never the latter (CuiLing, 2026-07-23: the total should follow the lines).
  subtotal:        numOrNull(o.subtotal),
  discount_pct:    numOrNull(o.discount_pct),
  discount_amount: numOrNull(o.discount_amount),
  total_amount:    numOrNull(o.total_amount),
  pi_subtotal:     numOrNull(o.pi_subtotal),
  pi_total:        numOrNull(o.pi_total),
  // WooCommerce B2C sync (WooCommerce_B2C_Sync_Spec.md §2.1/§2.3). woo_order_id
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
  // (WooCommerce_B2C_Sync_Spec.md §8). Originally these only existed folded
  // into a human-readable line in `notes` (for the printed invoice's
  // Remarks) — that's fine to read, but useless to EXPORT as its own column,
  // which is exactly what §8 needs. Both now co-exist: notes keeps the
  // readable summary, these carry the same figures as real numbers/dates.
  woo_fee: numOrNull(o.woo_fee),
  woo_net_payout: numOrNull(o.woo_net_payout),
  woo_payout_date: o.woo_payout_date || null,
})

export const normLine = l => {
  const type = LINE_TYPES.some(t => t.value === l.line_type) ? l.line_type : null
  return {
    line_no: numOrNull(l.line_no),
    item_code: str(l.item_code),
    description: str(l.description),
    qty_ordered: numOrNull(l.qty_ordered),
    unit: str(l.unit) || 'pcs',
    unit_price: numOrNull(l.unit_price),
    line_type: type,                       // null until reconciled
    packable: type ? isPackable(type) : true,
    // Optional picture for this line on the Proforma / Sales Invoice. A plain
    // URL, chosen by hand (see components/LineImagePicker) — corp-gift line
    // codes are bespoke per order, not catalogue SKUs, so there is nothing to
    // derive it from. Deliberately NOT a product reference: it says "print
    // this picture on this line", not "this line IS that catalogue product".
    line_image: str(l.line_image) || null,
    matched_product_ref: l.matched_product_ref || null,
    match_status: ['matched', 'unmatched', 'manual'].includes(l.match_status) ? l.match_status : 'unmatched',
  }
}

const orderFromDoc = d => ({ id: d.id, ...normOrder(d.data()), _raw: d.data() })

export async function getOrder(id) {
  const snap = await getDoc(doc(db, 'orders', id))
  return snap.exists() ? { id: snap.id, ...normOrder(snap.data()) } : null
}

export async function getOrderLines(orderId) {
  const snap = await getDocs(query(LINES(orderId), orderBy('line_no')))
  return snap.docs.map(d => ({ id: d.id, ...normLine(d.data()) }))
}

// Create an order with its lines in one batch. Returns the new order id.
// Returns the new order id synchronously (available before the write lands) plus
// the commit promise. With persistentLocalCache the write is durable in the
// local cache immediately and syncs in the background, so callers can navigate
// optimistically instead of blocking on the server ack (which can hang if the
// network stalls — the doc is already "saved" locally either way).
export function createOrderWithLines(orderData, lines) {
  const orderRef = doc(ORDERS())
  const batch = writeBatch(db)
  batch.set(orderRef, { ...normOrder(orderData), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  ;(lines || []).forEach((l, i) => {
    const n = normLine(l)
    if (n.line_no == null) n.line_no = i + 1
    batch.set(doc(LINES(orderRef.id)), n)
  })
  return { id: orderRef.id, commit: batch.commit() }
}

// Same as createOrderWithLines, but the order lands at a CALLER-CHOSEN doc
// ID rather than an auto-generated one, and refuses to create a second order
// there if one already exists. This is the actual idempotency mechanism for
// the WooCommerce importer (WooCommerce_B2C_Sync_Spec.md §2.3/§2.4): the doc
// ID is derived from the WooCommerce order id (wooOrderDocId in wooImport.js),
// so re-running an import for an order already brought in is a no-op instead
// of a duplicate order — the check-then-create happens inside one
// transaction, so two overlapping imports of the same order cannot both pass
// the check and both write (a plain getDoc-then-set has exactly that race).
// Returns { id, created: bool } — created:false means it already existed and
// nothing was written.
export async function createOrderWithLinesAtId(id, orderData, lines) {
  const orderRef = doc(db, 'orders', id)
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(orderRef)
    if (existing.exists()) return { id, created: false }
    tx.set(orderRef, { ...normOrder(orderData), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    ;(lines || []).forEach((l, i) => {
      const n = normLine(l)
      if (n.line_no == null) n.line_no = i + 1
      tx.set(doc(LINES(id)), n)
    })
    return { id, created: true }
  })
}

// Same as createOrderWithLines, but optionally allocates the order's SO
// number INSIDE the same Firestore transaction, so the two either both land
// or neither does.
//
// Before this (bug-fix pack B-02), ShipmentForm.jsx allocated the SO number
// first (its own runTransaction against counters/so_<yy>, see soNumber.js)
// and only THEN wrote the order in a separate batch. If that second write
// failed — a network hiccup, a rules rejection, anything after the number
// was already burned — the SO series got a real, permanent gap: the number
// is gone and no order exists to explain why. Reads the SAME counter doc and
// seed table soNumber.js's own allocateSoNo() uses, so the two paths can
// never issue conflicting numbers.
export async function createOrderWithLinesAllocatingSo(orderData, lines, { allocateSo } = {}) {
  return runTransaction(db, async (tx) => {
    let so = orderData.erp_so_no || ''
    if (allocateSo && !so) {
      const yy = soYear()
      const seed = Number(JES_SEED_BY_YEAR[yy]) || 0
      const counterRef = doc(db, 'counters', `so_${yy}`)
      // Firestore transactions require every read before any write.
      const snap = await tx.get(counterRef)
      const last = snap.exists() ? (Number(snap.data().last) || 0) : seed
      const next = last + 1
      so = formatSoNo(yy, next)
      tx.set(counterRef, { last: next, year: yy, kind: 'so', updated_at: new Date().toISOString() }, { merge: true })
    }
    const orderRef = doc(ORDERS())
    tx.set(orderRef, { ...normOrder({ ...orderData, erp_so_no: so }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    ;(lines || []).forEach((l, i) => {
      const n = normLine(l)
      if (n.line_no == null) n.line_no = i + 1
      tx.set(doc(LINES(orderRef.id)), n)
    })
    return { id: orderRef.id, so }
  })
}

export async function updateOrder(id, patch) {
  await updateDoc(doc(db, 'orders', id), { ...patch, updatedAt: serverTimestamp() })
}

// Reconcile the order's lines subcollection to exactly the lines passed in:
// update existing, create new, delete removed. One batch, so it is atomic.
//
// This replaced a version that did `batch.update` per line and skipped any line
// with no id. Three ways that silently lost CuiLing's edits (all reproduced):
//   - a newly added line has no id, so it was skipped and never saved;
//   - a line whose doc no longer exists made `update` throw NOT_FOUND, which
//     failed the WHOLE batch — every edit in that save was lost, while the
//     header (written separately) still saved, so it looked like nothing stuck;
//   - a removed line was only dropped from form state, never from Firestore, so
//     it reappeared on the next load.
// `set(..., { merge:true })` creates-or-updates and cannot throw on a missing
// doc, and the diff deletes what the user removed. The lines subcollection ends
// up matching the form, whatever state it was in before.
export async function saveOrderLines(orderId, lines) {
  const existing = await getDocs(LINES(orderId))
  const keep = new Set()
  const batch = writeBatch(db)
  for (const l of (lines || [])) {
    const ref = l.id ? doc(db, 'orders', orderId, 'lines', l.id)
                     : doc(collection(db, 'orders', orderId, 'lines'))
    keep.add(ref.id)
    batch.set(ref, normLine(l), { merge: true })
  }
  for (const d of existing.docs) {
    if (!keep.has(d.id)) batch.delete(d.ref)
  }
  await batch.commit()
}

export async function deleteOrder(id) {
  const lines = await getDocs(LINES(id))
  const batch = writeBatch(db)
  lines.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, 'orders', id))
  await batch.commit()
}

// Live order list.
// No orderBy('createdAt') here — Firestore's orderBy is a FILTER as well as a
// sort: any doc missing that field (or, transiently, one whose serverTimestamp()
// hasn't resolved from a pending write yet — e.g. right after createOrderWithLines)
// is silently excluded from the query results entirely, not just left unsorted.
// That's exactly why a newly-created PI could vanish from every screen that reads
// useOrders() (Orders list, MRP Requirements picker, Dashboard). Fetch everything,
// sort client-side instead — same fix already applied to loadCustomers.
export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(
    ORDERS(),
    snap => {
      const list = snap.docs.map(orderFromDoc)
      list.sort((a, b) => (b._raw?.createdAt?.seconds || 0) - (a._raw?.createdAt?.seconds || 0))
      setOrders(list)
      setLoading(false)
    },
    () => setLoading(false),
  ), [])
  return { orders, loading }
}

// All figurine products (for SKU matching during import / reconciliation).
export async function loadRangeProductsLite() {
  try {
    const snap = await getDocs(collection(db, 'range_products'))
    return snap.docs.map(d => {
      const x = d.data()
      return {
        id: d.id,
        // The product's real display name is entered in the Description field
        // (RangeForm has no separate design-name input — design_name/name are
        // legacy/unused on current products), so that must be the last fallback.
        name: x.design_name || x.name || x.description || '',
        brand_code: x.brand_code || '',
        design_no: x.design_no || '',
        design_code: x.design_code || '',
        format_code: x.format_code || '',   // required to disambiguate same-design products by format
      }
    })
  } catch {
    return []
  }
}

// Apply auto-match to freshly-extracted PI lines. Sets line_type=range +
// matched_product_ref + match_status on hits; leaves the rest unmatched for the
// user to classify (ad_hoc / non_product). "Promote to catalogue" is deferred.
export function autoMatchLines(lines, rangeProducts) {
  const index = buildProductIndex(rangeProducts)   // build once, reuse per line
  return (lines || []).map((l, i) => {
    const p = l.item_code ? matchProductCode(l.item_code, index) : null
    if (p) {
      return {
        ...l, line_no: l.line_no ?? i + 1,
        line_type: 'range', packable: true,
        matched_product_ref: { collection: 'range_products', id: p.id, name: p.name },
        match_status: 'matched',
        // Fill Description from the catalogue match, but only if it's still
        // empty — never clobber a description already extracted from the PI
        // or typed by hand (which can carry customer-specific detail like
        // "Tunes: You are my Sunshine" that isn't in the catalogue record).
        description: l.description || p.name || l.description,
      }
    }
    return { ...l, line_no: l.line_no ?? i + 1, line_type: null, match_status: 'unmatched' }
  })
}

// Re-run auto-match on already-loaded lines, PRESERVING any line the user
// classified manually (match_status 'manual'). Used by the reconciliation
// "Re-match" button to correct PIs that were auto-matched by the old matcher.
export function rematchLines(lines, rangeProducts) {
  const index = buildProductIndex(rangeProducts)
  return (lines || []).map((l, i) => {
    if (l.match_status === 'manual') return l
    const p = l.item_code ? matchProductCode(l.item_code, index) : null
    if (p) {
      return {
        ...l, line_no: l.line_no ?? i + 1,
        line_type: 'range', packable: true,
        matched_product_ref: { collection: 'range_products', id: p.id, name: p.name },
        match_status: 'matched',
        description: l.description || p.name || l.description,
      }
    }
    return { ...l, line_no: l.line_no ?? i + 1, line_type: null, matched_product_ref: null, match_status: 'unmatched' }
  })
}

// Subtotal/discount/total derived from line items, mirroring the "Order
// Totals" card shown in the editor. Used both to render that card and, as a
// fallback on save, to persist a value when the PI extraction never captured
// a stated total — otherwise the order silently has no total_amount even
// though a correct one is computable and was visible on screen.
//
// A line with no quantity (e.g. a flat Freight/Insurance charge — the
// extractor leaves qty_ordered null for pure charges, putting the flat amount
// in unit_price) is a lump sum, not a per-unit price for zero units. Those
// lines are kept OUT of `subtotal` (which mirrors the PI's own product-only
// "Subtotal" field, so the ✓/⚠ comparison against header.subtotal stays
// meaningful) and rolled into `chargesTotal` instead, which IS added into the
// final total — otherwise freight/insurance silently vanish from the total.
export function computeOrderTotals(header, lines) {
  let subtotal = 0, chargesTotal = 0
  for (const l of (lines || [])) {
    const qty = parseFloat(l.qty_ordered) || 0
    const up = parseFloat(l.unit_price) || 0
    if (qty > 0) subtotal += qty * up
    else chargesTotal += up
  }
  const discPct = parseFloat(header?.discount_pct) || 0
  const discountAmount = parseFloat(header?.discount_amount) || (discPct > 0 ? +(subtotal * discPct / 100).toFixed(2) : 0)
  const total = +(subtotal - discountAmount + chargesTotal).toFixed(2)
  return { subtotal: +subtotal.toFixed(2), chargesTotal: +chargesTotal.toFixed(2), discountAmount, total }
}

// ── Validators (shared guardrail result format) ───────────────────────────────
// validateOrder / validateOrderLine return { ok, errors, warnings, infos } so the
// write path and the read-only Schema Audit page share one set of rules. These
// are advisory for now (warnings/infos) — the spec's hard blocks on unresolved
// figurine plating land with the A-1 procurement build, not this foundation pass.

const PLATING_SUFFIXES = ['C', 'G', 'R', 'A', 'M']
// Plating inferred from the trailing item-code segment ('D0002-230-C' → 'C').
const platingOf = code => {
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
      addWarning(r, 'orderline.range.match_missing', 'matched_product_ref',
        `${label}: figurine line not matched to a product`)
    if (!platingOf(l.item_code))
      addInfo(r, 'orderline.range.plating_unresolved', 'item_code',
        `${label}: plating not resolved from item code`)
  }
  return r
}

// validateOrder(order[, lines]). When lines are supplied, line-level results and
// a parsed-vs-computed total discrepancy are folded in. Parsed totals are never
// overwritten — a mismatch is surfaced as info (spec: snapshot historical records).
export function validateOrder(order, lines = null) {
  const o = normOrder(order || {})
  const r = result()
  if (!o.customer_id) addWarning(r, 'order.customer.unresolved', 'customer_id',
    'Order not linked to a customer')

  // SR-05: accounting_total may differ from the calculated total (rounding,
  // fees, FX), but never silently — a nonzero gap needs a stated reason.
  // Checked against total_amount (the persisted, line-derived fact) rather
  // than recomputing from lines, so this also catches drift in stored records
  // via the Schema Audit page, not only at save time.
  if (o.accounting_total != null && o.total_amount != null) {
    const adj = Math.round((o.accounting_total - o.total_amount) * 100) / 100
    if (Math.abs(adj) > 0.005 && !o.adjustment_reason)
      addError(r, 'order.invoice.adjustment_reason_required', 'adjustment_reason',
        'Accounting total differs from the calculated total — a reason is required')
  }

  if (Array.isArray(lines) && lines.length) {
    const lineResults = lines.map(validateOrderLine)
    const lineSum = lines.reduce((s, l) =>
      s + (numOrNull(l.qty_ordered) || 0) * (numOrNull(l.unit_price) || 0), 0)
    const ref = o.subtotal != null ? o.subtotal : o.total_amount
    if (ref != null && lineSum > 0 && Math.abs(ref - lineSum) > Math.max(1, ref * 0.005))
      addInfo(r, 'order.total.discrepancy', 'total_amount',
        `Parsed total ${ref} differs from line sum ${lineSum.toFixed(2)}`)
    return merge(r, ...lineResults)
  }
  return r
}
