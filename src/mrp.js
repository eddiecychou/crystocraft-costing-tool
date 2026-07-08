// Material Requirements (light MRP) for figurine PIs.
//
// Given one or more confirmed PIs, explode each figurine line into its critical
// components (plating-aware), aggregate the gross requirement per component code
// across all lines/PIs, subtract current component stock, and report the net
// shortage to order. Read-only — no stock is mutated here (that is Phase 2).
//
// Pure and dependency-light so the core is headless-testable. Relies only on
// resolveRef + VALID_PLATINGS from criticalComponents.

import { resolveRef, VALID_PLATINGS } from './criticalComponents'

const PLATING_LETTERS = new Set(VALID_PLATINGS.filter(Boolean))  // C,G,R,A,M

// Plating of a finished SKU, parsed from its item code. Codes are
// `design-format-<plating><colour?>`, e.g. U0257-001-GAB → 'G'. Returns '' when
// the plating can't be determined (caller decides how to treat that).
export function platingFromItemCode(itemCode) {
  const parts = String(itemCode || '').trim().toUpperCase().split('-')
  const seg = parts[2] || ''
  const ch = seg[0] || ''
  return PLATING_LETTERS.has(ch) ? ch : ''
}

const perUnit = r => { const n = Number(r?.qty_per_unit); return n > 0 ? n : 1 }
// Effective plating of a component ref: explicit override wins, else the resolved
// component's own plating. Blank ⇒ shared part (applies to every plating).
const refPlating = (r, lib) => (r.plating_code || resolveRef(r, lib)?.plating_code || '').trim().toUpperCase()

// A line references a range_product via matched_product_ref { collection, id, name }.
const lineProductId = l => (l?.matched_product_ref?.collection === 'range_products' ? l.matched_product_ref.id : null)

// Compute component requirements + shortages for a set of order lines.
//   lines        : order lines across the selected PIs, each optionally tagged
//                  with `order_label` for traceability
//   productsById : { [range_product id]: product }  (product.critical_components[])
//   lib          : range_components array (stock_qty, lead_time_weeks, plating_code)
// Returns { rows, warnings, skipped }.
export function computeRequirements({ lines = [], productsById = {}, lib = [] }) {
  const req = {}          // code → { code, name, plating_code, required, leadWeeks, usedBy:Set }
  const warnings = []     // { item_code, order, reason }
  const skipped = []      // non-figurine / unmatched lines (informational)

  const bump = (comp, qty, productName) => {
    const key = comp.code
    if (!req[key]) req[key] = { code: comp.code, name: comp.name || '', plating_code: comp.plating_code || '', required: 0, leadWeeks: numOrNull(comp.lead_time_weeks), usedBy: new Set() }
    req[key].required += qty
    if (productName) req[key].usedBy.add(productName)
  }

  for (const l of lines) {
    const qty = Number(l.qty_ordered)
    const pid = lineProductId(l)
    const order = l.order_label || ''
    if (!pid) { skipped.push({ item_code: l.item_code || '', order, reason: 'not a matched figurine line' }); continue }
    if (!(qty > 0)) { warnings.push({ item_code: l.item_code || '', order, reason: 'no order quantity' }); continue }
    const product = productsById[pid]
    if (!product) { warnings.push({ item_code: l.item_code || '', order, reason: 'matched product not found' }); continue }

    const refs = Array.isArray(product.critical_components) ? product.critical_components : []
    if (!refs.length) { warnings.push({ item_code: l.item_code || '', order, reason: `no critical components on ${product.name || pid}` }); continue }

    const plating = platingFromItemCode(l.item_code)
    const taggedPlatings = new Set(refs.map(r => refPlating(r, lib)).filter(Boolean))
    // Plating couldn't be parsed but this product HAS plating-specific parts →
    // we can only count shared parts; flag so nothing is silently under-ordered.
    if (!plating && taggedPlatings.size) {
      warnings.push({ item_code: l.item_code || '', order, reason: `plating not determined — plating-specific parts not counted for ${product.name || pid}` })
    }

    let matchedAnyPlatingPart = false
    for (const ref of refs) {
      const refPl = refPlating(ref, lib)
      const include = !refPl || (plating && refPl === plating)   // shared, or this SKU's plating
      if (!include) continue
      if (refPl) matchedAnyPlatingPart = true
      const comp = resolveRef(ref, lib)
      if (!comp || !comp.code) { warnings.push({ item_code: l.item_code || '', order, reason: `component ${ref.code || ref.id || '?'} not found` }); continue }
      bump(comp, qty * perUnit(ref), product.name || product.design_code || pid)
    }
    // Parsed a plating, product has plating-tagged parts, but none matched it.
    if (plating && taggedPlatings.size && !matchedAnyPlatingPart) {
      warnings.push({ item_code: l.item_code || '', order, reason: `no components tagged for plating ${plating} on ${product.name || pid}` })
    }
  }

  const stockByCode = {}
  for (const c of lib) if (c?.code) stockByCode[c.code.toUpperCase()] = Number.isFinite(c.stock_qty) ? c.stock_qty : 0

  const rows = Object.values(req).map(r => {
    const inStock = stockByCode[r.code.toUpperCase()] ?? 0
    return {
      code: r.code, name: r.name, plating_code: r.plating_code,
      required: r.required, inStock, shortage: Math.max(0, r.required - inStock),
      leadWeeks: r.leadWeeks, usedBy: [...r.usedBy].sort(),
    }
  }).sort((a, b) => (b.shortage - a.shortage) || a.code.localeCompare(b.code))

  return { rows, warnings, skipped }
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
