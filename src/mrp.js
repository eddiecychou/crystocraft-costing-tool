// Material Requirements (light MRP) for figurine PIs.
//
// Given one or more confirmed PIs, explode each figurine line into its critical
// components (plating-aware), aggregate the gross requirement per component code
// across all lines/PIs, subtract current component stock, and report the net
// shortage to order. Read-only — no stock is mutated here (that is Phase 2).
//
// Pure and dependency-light so the core is headless-testable. Plating inclusion
// goes through the shared refApplies helper so MRP agrees with buildable/costing.

import { resolveRef, refApplies, refScopePlating, buildProductIndex, matchProductCode, VALID_PLATINGS, availableOf } from './criticalComponents'
import { crystalRequirement } from './crystalBom'

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

// Colourway of a finished SKU, from the tail of the plating segment:
// D0092-001-GMX → 'MX', U0257-001-GAB → 'AB'. Empty when the code carries no
// colour, which is normal for corp-gift and charge lines.
export function colourFromItemCode(itemCode) {
  const parts = String(itemCode || '').trim().toUpperCase().split('-')
  const seg = parts[2] || ''
  return PLATING_LETTERS.has(seg[0]) ? seg.slice(1) : seg
}

// A range product's real display name is entered in the Description field —
// RangeForm has no separate name input, so `name`/`design_name` are legacy/
// unset on current products. Fall through to description, then design_code
// (always present), before ever showing the raw Firestore doc id.
const productLabel = p => p?.name || p?.description || p?.design_code || p?.id || '?'

// Does this item code look like a figurine SKU (brand letter(s) + design digits)?
// Used to tell a genuine-but-unknown figurine (flag loudly) from a corp-gift /
// charge / ad-hoc line that legitimately has no figurine code (skip quietly).
export function looksLikeFigurineCode(code) {
  return /^[A-Z]{1,2}\d{3,4}/.test(String(code || '').trim().toUpperCase())
}

// A line's range_product. A user-confirmed MANUAL match wins; otherwise we
// re-derive from the item code with the current format-aware matcher (auto
// matches may be stale/wrong from the old core-only matcher, and unreconciled
// lines have no ref at all). Falls back to any stored ref if the code matches
// nothing.
function lineProduct(l, productsById, index) {
  const ref = l?.matched_product_ref
  const stored = (ref?.collection === 'range_products' && ref.id && productsById[ref.id]) ? productsById[ref.id] : null
  if (l?.match_status === 'manual' && stored) return stored
  const m = matchProductCode(l.item_code, index)
  if (m && productsById[m.id]) return productsById[m.id]
  return stored
}

// Compute component requirements + shortages for a set of order lines.
//   lines    : order lines across the selected PIs, each optionally tagged with
//              `order_label` for traceability
//   products : range_products array (each with critical_components[])
//   lib      : range_components array (stock_qty, lead_time_weeks, plating_code)
// Returns { rows, warnings, skipped }.
export function computeRequirements({ lines = [], products = [], lib = [], crystals = [] }) {
  const productsById = {}
  for (const p of products) if (p?.id) productsById[p.id] = p
  const index = buildProductIndex(products)

  const req = {}          // code → { code, name, plating_code, required, leadWeeks, usedBy:Set }
  const creq = {}         // same, for crystal stones
  const warnings = []     // { item_code, order, reason }
  const unmatched = []    // figurine-looking codes NOT in the product range (flag loudly)
  const skipped = []      // genuinely non-figurine lines (corp gift / charge) — informational

  const bumpCrystal = (code, name, qty, productName) => {
    if (!creq[code]) creq[code] = { code, name: name || '', required: 0, usedBy: new Set() }
    creq[code].required += qty
    if (productName) creq[code].usedBy.add(productName)
  }

  const bump = (comp, qty, productName) => {
    const key = comp.code
    if (!req[key]) req[key] = { code: comp.code, name: comp.name || '', plating_code: comp.plating_code || '', required: 0, leadWeeks: numOrNull(comp.lead_time_weeks), usedBy: new Set() }
    req[key].required += qty
    if (productName) req[key].usedBy.add(productName)
  }

  for (const l of lines) {
    const qty = Number(l.qty_ordered)
    const order = l.order_label || ''
    const product = lineProduct(l, productsById, index)
    if (!product) {
      const code = (l.item_code || '').trim()
      if (looksLikeFigurineCode(code)) {
        unmatched.push({ item_code: code, description: l.description || '', qty: numOrNull(l.qty_ordered), order })
      } else {
        skipped.push({ item_code: code, order, reason: 'not a figurine line (no matching code)' })
      }
      continue
    }
    if (!(qty > 0)) { warnings.push({ item_code: l.item_code || '', order, reason: 'no order quantity' }); continue }

    const refs = Array.isArray(product.critical_components) ? product.critical_components : []
    const label = productLabel(product)

    // Crystals, before the critical-components early-exit: a figurine can carry
    // a crystal BOM and no critical components, and skipping it here would drop
    // the stones silently.
    if (crystals.length && product.crystal_components) {
      const colour = colourFromItemCode(l.item_code)
      const { lines: cl, unresolved } = crystalRequirement(product.crystal_components, colour, crystals)
      for (const c of cl) bumpCrystal(c.code, c.crystal?.name, qty * c.qty, label)
      for (const u of unresolved) {
        // Never let an unresolved stone vanish into a zero. Each of these is a
        // real requirement the app cannot price or reserve yet.
        const detail =
          u.reason === 'mix-not-defined' ? `mix ${u.code} has no recipe on ${label} — ${u.qty} stones/unit unaccounted`
          : u.reason === 'not-in-inventory' ? `crystal ${u.code} is not in crystal stock (${label})`
          : `no ${u.shape} ${u.size} stone in colour ${u.colour || '?'} for ${label}`
        warnings.push({ item_code: l.item_code || '', order, reason: detail })
      }
    }

    if (!refs.length) { warnings.push({ item_code: l.item_code || '', order, reason: `no critical components on ${label}` }); continue }

    const plating = platingFromItemCode(l.item_code)
    // Refs scoped to a specific plating (alternatives). `all_variants` / shared
    // parts have scope '' and always apply, so they are excluded here.
    const scoped = refs.filter(r => refScopePlating(r, lib))
    if (!plating && scoped.length) {
      warnings.push({ item_code: l.item_code || '', order, reason: `plating not determined — plating-specific parts not counted for ${label}` })
    }

    let matchedScoped = false
    for (const ref of refs) {
      if (!refApplies(ref, lib, plating)) continue
      if (refScopePlating(ref, lib)) matchedScoped = true
      const comp = resolveRef(ref, lib)
      if (!comp || !comp.code) { warnings.push({ item_code: l.item_code || '', order, reason: `component ${ref.code || ref.id || '?'} not found` }); continue }
      bump(comp, qty * perUnit(ref), label)
    }
    if (plating && scoped.length && !matchedScoped) {
      warnings.push({ item_code: l.item_code || '', order, reason: `no components tagged for plating ${plating} on ${label}` })
    }
  }

  // "In stock" for planning = AVAILABLE (on-hand − reserved): reserved parts are
  // already committed to confirmed orders, so they can't cover new demand (R2).
  const stockByCode = {}
  for (const c of lib) if (c?.code) stockByCode[c.code.toUpperCase()] = availableOf(c)

  const rows = Object.values(req).map(r => {
    const inStock = stockByCode[r.code.toUpperCase()] ?? 0
    return {
      code: r.code, name: r.name, plating_code: r.plating_code,
      required: r.required, inStock, shortage: Math.max(0, r.required - inStock),
      leadWeeks: r.leadWeeks, usedBy: [...r.usedBy].sort(),
    }
  }).sort((a, b) => (b.shortage - a.shortage) || a.code.localeCompare(b.code))

  // Crystal stock. These live in their own collection with their own ledger, so
  // availability is computed here rather than borrowed from availableOf, which
  // is shaped for range_components.
  const crystalStock = {}
  for (const c of crystals) {
    if (!c?.code) continue
    const onHand = Number(c.stock_qty) || 0
    const reserved = Number(c.reserved_qty) || 0
    crystalStock[String(c.code).toUpperCase()] = onHand - reserved
  }

  const crystalRows = Object.values(creq).map(r => {
    const inStock = crystalStock[r.code.toUpperCase()] ?? 0
    return {
      code: r.code, name: r.name,
      required: r.required, inStock, shortage: Math.max(0, r.required - inStock),
      usedBy: [...r.usedBy].sort(),
    }
  }).sort((a, b) => (b.shortage - a.shortage) || a.code.localeCompare(b.code))

  return { rows, crystalRows, warnings, unmatched, skipped }
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
