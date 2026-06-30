import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { numOrNull, str, trimUpper, result, addWarning, addInfo, merge } from './domain/validation'

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
// PI item codes are messy ("D0002-230-C", "U0226", "D231"). We match brand-
// agnostically (the photo/PI may use a different brand letter than the stored
// product) on the design core, mirroring the Crystal-Bible image import.

// Strip a leading brand letter run so "D0002" and "U0002" compare equal.
const stripBrand = code => str(code).toUpperCase().replace(/[\s_]/g, '').replace(/^[A-Z]+/, '')

// Candidate match keys for a range product: its base code (brand+design_no),
// the design_no alone, and any explicit design_code — all brand-stripped.
function rangeKeys(p) {
  const keys = new Set()
  const add = v => { const k = stripBrand(v); if (k) keys.add(k) }
  add(`${p.brand_code || ''}${p.design_no || ''}`)
  add(p.design_no)
  add(p.design_code)
  return keys
}

// Try to match one PI item_code to a figurine product. Returns the product or
// null. A hit = the PI code, brand-stripped, starts with the product's design
// core (so "0002-230-C" matches product core "0002").
export function matchRangeProduct(itemCode, rangeProducts) {
  const core = stripBrand(itemCode)
  if (!core) return null
  let best = null
  for (const p of rangeProducts) {
    for (const key of rangeKeys(p)) {
      if (!key) continue
      if (core === key || key.startsWith(core)) {
        // Prefer the longest key match (most specific design core).
        if (!best || key.length > best._keyLen) best = { ...p, _keyLen: key.length }
      }
    }
  }
  return best
}

// ── orders ────────────────────────────────────────────────────────────────────

const ORDERS = () => collection(db, 'orders')
const LINES  = orderId => collection(db, 'orders', orderId, 'lines')

export const normOrder = o => ({
  source: o.source === 'in_app_quote' ? 'in_app_quote' : 'imported_pi',
  client_quote_id: o.client_quote_id || null,
  erp_pi_no: str(o.erp_pi_no),
  erp_so_no: str(o.erp_so_no),
  customer_id: o.customer_id || '',
  customer_name: str(o.customer_name),
  order_date: o.order_date || null,
  currency: ['HKD', 'RMB', 'USD', 'EUR'].includes(o.currency) ? o.currency : 'USD',
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
export async function createOrderWithLines(orderData, lines) {
  const orderRef = doc(ORDERS())
  const batch = writeBatch(db)
  batch.set(orderRef, { ...normOrder(orderData), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  ;(lines || []).forEach((l, i) => {
    const n = normLine(l)
    if (n.line_no == null) n.line_no = i + 1
    batch.set(doc(LINES(orderRef.id)), n)
  })
  await batch.commit()
  return orderRef.id
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
export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(
    query(ORDERS(), orderBy('createdAt', 'desc')),
    snap => { setOrders(snap.docs.map(orderFromDoc)); setLoading(false) },
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
        name: x.design_name || x.name || '',
        brand_code: x.brand_code || '',
        design_no: x.design_no || '',
        design_code: x.design_code || '',
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
  return (lines || []).map((l, i) => {
    const p = l.item_code ? matchRangeProduct(l.item_code, rangeProducts) : null
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
