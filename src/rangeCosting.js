// Range / Figurine costing — build a figurine's unit cost from its critical
// components plus a few extra cost lines, mirroring the corp-gift model in
// `pricing.js`. Everything resolves to HKD via `rates` (currency → HKD).
//
// A range product carries an optional `costing` object (written only by the
// Range Costing page; products without it are simply "not costed yet"):
//   {
//     extra_lines:   [{ label, cost, currency }],          // applied to all variants
//     plating_costs: { [plating_code]: { cost, currency }},// per-plating adder
//     crystal_costs: { [crystal_code]: { cost, currency }},// per-crystal adder
//     markup:        number | null,                        // per-product override
//     tiers:         [{ quantity, lead_time_days }],
//   }
//
// Cost = Σ(component cost at qty × qty_per_unit) + Σ extra lines
//        + plating adder + crystal adder  (+ tooling amortised over qty)
// Sell = ceil(cost × markup).

import { resolveRef } from './criticalComponents'
import { DEFAULT_MARKUP } from './pricing'

const toHKD = (amount, currency, rates) =>
  (Number(amount) || 0) * (rates?.[currency] || 1)

const perUnit = r => { const n = Number(r?.qty_per_unit); return n > 0 ? n : 1 }

// Unit cost of one component at an order quantity, honouring its volume tiers.
export function componentCostAtQty(component, orderQty) {
  if (!component || component.unit_cost == null) return null
  const tiers = component.volume_tiers
  if (Array.isArray(tiers) && tiers.length) {
    const applicable = tiers
      .filter(t => t.min_qty <= orderQty)
      .sort((a, b) => b.min_qty - a.min_qty)[0]
    if (applicable) return Number(applicable.unit_cost)
  }
  return Number(component.unit_cost)
}

// Recurring component cost (HKD) for one finished piece at a given order qty.
// When variant is provided, refs tagged with a plating_code only contribute if
// their plating matches the variant. Untagged refs (plating_code absent or '')
// always apply — they are shared parts (bodies, NFC chips, boxes, etc.).
export function componentsCostHKD(product, lib, rates, orderQty, variant = null) {
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const platCode = variant ? (variant.plating_code || '').trim().toUpperCase() : null
  return refs.reduce((sum, r) => {
    const refPlat = (r.plating_code || '').trim().toUpperCase()
    if (platCode !== null && refPlat && refPlat !== platCode) return sum
    const c = resolveRef(r, lib)
    const unit = componentCostAtQty(c, orderQty)
    if (unit == null) return sum
    return sum + toHKD(unit, c.unit_cost_currency, rates) * perUnit(r)
  }, 0)
}

// Sum of the product's flat extra lines (HKD), applied to every variant.
export function extraLinesHKD(product, rates) {
  const lines = product?.costing?.extra_lines
  if (!Array.isArray(lines)) return 0
  return lines.reduce((s, l) => s + toHKD(l.cost, l.currency, rates), 0)
}

// Per-plating / per-crystal adder (HKD) for a specific variant.
export function variantAdderHKD(product, rates, variant) {
  const c = product?.costing || {}
  let add = 0
  const pc = c.plating_costs?.[(variant?.plating_code || '').trim().toUpperCase()]
  if (pc) add += toHKD(pc.cost, pc.currency, rates)
  // A variant may carry several selectable crystal colours; charge the dearest
  // so the quoted cost is never understated.
  const crystals = Array.isArray(variant?.crystal_colors) && variant.crystal_colors.length
    ? variant.crystal_colors
    : (variant?.crystal_code ? [variant.crystal_code] : [])
  let crystalAdd = 0
  for (const code of crystals) {
    const cc = c.crystal_costs?.[(code || '').trim().toUpperCase()]
    if (cc) crystalAdd = Math.max(crystalAdd, toHKD(cc.cost, cc.currency, rates))
  }
  return add + crystalAdd
}

// One-time tooling across components (HKD), amortised by the caller.
// Same plating filter as componentsCostHKD so tooling is not double-counted
// across plating variants that each carry their own tooling cost.
export function toolingHKD(product, lib, rates, variant = null) {
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const platCode = variant ? (variant.plating_code || '').trim().toUpperCase() : null
  return refs.reduce((sum, r) => {
    const refPlat = (r.plating_code || '').trim().toUpperCase()
    if (platCode !== null && refPlat && refPlat !== platCode) return sum
    const c = resolveRef(r, lib)
    if (!c || !c.tooling_sample_cost) return sum
    return sum + toHKD(c.tooling_sample_cost, c.tooling_sample_cost_currency, rates)
  }, 0)
}

// Recurring (excludes tooling) unit cost in HKD for one variant at a qty.
export function variantRecurringCostHKD(product, lib, rates, variant, orderQty) {
  return componentsCostHKD(product, lib, rates, orderQty, variant)
    + extraLinesHKD(product, rates)
    + variantAdderHKD(product, rates, variant)
}

// All-in unit cost (recurring + amortised tooling) in HKD for a variant at qty.
export function variantAllInCostHKD(product, lib, rates, variant, orderQty) {
  const recurring = variantRecurringCostHKD(product, lib, rates, variant, orderQty)
  const tooling = toolingHKD(product, lib, rates, variant)
  return recurring + (orderQty > 0 ? tooling / orderQty : 0)
}

// Effective markup for a product: per-product override wins, else default.
export function productMarkup(product) {
  const m = Number(product?.costing?.markup)
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_MARKUP
}

// Sell price (HKD, rounded up) for a variant at a qty under a given markup.
export function variantSellHKD(product, lib, rates, variant, orderQty, markup) {
  const mk = Number.isFinite(markup) && markup > 0 ? markup : productMarkup(product)
  return Math.ceil(variantAllInCostHKD(product, lib, rates, variant, orderQty) * mk)
}

// True when a product has any usable costing data to publish.
export function hasCosting(product, lib, rates) {
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const anyComp = refs.some(r => componentCostAtQty(resolveRef(r, lib), 1) != null)
  return anyComp || extraLinesHKD(product, rates) > 0
}
