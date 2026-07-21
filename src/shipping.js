import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { numOrNull, str, trimUpper, result, addWarning, addInfo, merge } from './domain/validation'
import { buildProductIndex, matchProductCode } from './criticalComponents'

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

const ORDERS = () => collection(db, 'orders')
const LINES  = orderId => collection(db, 'orders', orderId, 'lines')

export const normOrder = o => ({
  source: o.source === 'in_app_quote' ? 'in_app_quote' : o.source === 'duplicated' ? 'duplicated' : 'imported_pi',
  client_quote_id: o.client_quote_id || null,
  erp_pi_no: str(o.erp_pi_no),
  erp_so_no: str(o.erp_so_no),
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
  // The app's UC reference (full form, e.g. "UC4950/26"). Free text like
  // erp_pi_no — usually typed in from Cindy's list, same as today. The one
  // place this is set automatically is "Duplicate order", which allocates a
  // fresh one rather than copying the source order's.
  uc_no: str(o.uc_no),
  customer_id: o.customer_id || '',
  customer_name: str(o.customer_name),
  order_date: o.order_date || null,
  // Every currency seen on a real sales order since 2024 (measured against
  // raw.salesorder): AED, CAD, EUR, GBP, HKD, MXN, USD — plus RMB for purchases.
  // The old whitelist was ['HKD','RMB','USD','EUR'], which silently coerced a
  // GBP or CAD order to USD: same number, wrong currency, no warning. Cindy's
  // audit rate table covers GBP, CAD and MXN, so these reach the books.
  currency: ORDER_CURRENCIES.includes(o.currency) ? o.currency : 'USD',
  incoterm: INCOTERMS.includes(o.incoterm) ? o.incoterm : 'FOB',
  destination: {
    country: str(o.destination?.country),
    city: str(o.destination?.city),
    address: str(o.destination?.address),
    port: str(o.destination?.port),
  },
  status: ORDER_STATUSES.some(s => s.value === o.status) ? o.status : 'draft',
  source_file: o.source_file || null,
  notes: str(o.notes),
  subtotal:        numOrNull(o.subtotal),
  discount_pct:    numOrNull(o.discount_pct),
  discount_amount: numOrNull(o.discount_amount),
  total_amount:    numOrNull(o.total_amount),
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

export async function updateOrder(id, patch) {
  await updateDoc(doc(db, 'orders', id), { ...patch, updatedAt: serverTimestamp() })
}

// Persist reconciliation edits — write each line's classification/match back.
export async function saveOrderLines(orderId, lines) {
  const batch = writeBatch(db)
  for (const l of lines) {
    if (!l.id) continue
    batch.update(doc(db, 'orders', orderId, 'lines', l.id), normLine(l))
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
