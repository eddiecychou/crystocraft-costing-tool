// Range / Figurine costing — build a figurine's unit cost from its critical
// components plus a few extra cost lines, mirroring the corp-gift model in
// `pricing.js`. Everything resolves to HKD via `rates` (currency → HKD).
//
// A range product carries an optional `costing` object (written only by the
// Range Costing page; products without it are simply "not costed yet"):
//   {
//     extra_lines:   [{ label, cost, currency }],          // applied to all variants
//     plating_costs: { [plating_code]: { cost, currency }},// per-plating adder
//     crystal_bom:   [{ size, scope, brand, qty }],         // stone quantities (see below)
//     markup:        number | null,                        // per-product override
//     tiers:         [{ quantity, lead_time_days }],
//   }
//
// Crystal cost is a bill-of-materials, not a flat adder: `crystal_bom` declares
// how many stones of each SIZE the design physically uses (e.g. 6× "14mm
// Octagon"). Each line is always explicit about two independent things —
// never inferred/guessed, because a stone's brand does not reliably follow
// the figurine's own crystal brand (pavé stones like PP18 are physically
// Swarovski/Preciosa regardless of whether the design itself is sold as a
// Bohemia/Asfour/Swarovski SKU):
//   - `scope`: '' = applies to every variant (a shared stone, e.g. PP18
//     Swarovski used across every D/A/U SKU); or a variant brand_code
//     (D/A/U/M) = this line applies ONLY to that one variant (used when the
//     same stone size is genuinely a different brand per variant, e.g. the
//     Bohemia SKU's 14mm Octagons vs the Asfour SKU's — three separate lines,
//     one per variant).
//   - `brand`: which priced row in the shared `crystal_unit_costs` library
//     (crystalCosting.js) to charge for this line — always an explicit pick,
//     never auto-matched against the variant's own brand name.
// A line that doesn't apply to a given variant (scope set to a different
// brand) contributes 0 to that variant with no warning — it's an intentional
// exclusion, not a missing price. Superseded per-colour `crystal_costs`
// adder is no longer read; colour remains a display-only attribute
// (crystalColors.js).
//
// Cost = Σ(component cost at qty × qty_per_unit) + Σ extra lines
//        + plating adder + crystal BOM cost  (+ tooling amortised over qty)
// Sell = ceil(cost × markup).

import { resolveRef } from './criticalComponents'
import { DEFAULT_MARKUP } from './pricing'
import { resolveCrystalCost } from './crystalCosting'

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
    const c = resolveRef(r, lib)
    // Plating scope: `all_variants` forces shared; else ref override, else the
    // component's own plating (Decision 2). '' ⇒ applies to every variant.
    const refPlat = r.all_variants ? '' : (r.plating_code || c?.plating_code || '').trim().toUpperCase()
    if (platCode !== null && refPlat && refPlat !== platCode) return sum
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

// True when a BOM line applies to a given variant: unscoped (shared) lines
// always apply; scoped lines apply only to the matching variant brand_code.
const lineAppliesTo = (line, variantBrandCode) => {
  const scope = (line.scope || '').trim().toUpperCase()
  return !scope || scope === variantBrandCode
}

// Crystal BOM cost (HKD) for one finished piece of a specific variant. Each
// line's qty is fixed per design; a line out of scope for this variant (see
// `lineAppliesTo`) contributes 0 — that's an intentional exclusion, not a
// missing price. A line in scope with no resolvable (size, brand) price also
// contributes 0 — callers that need to warn about that should check
// `missingCrystalLines` instead of relying on a silent zero.
export function crystalBomCostHKD(product, rates, variant, crystalLib) {
  const bom = Array.isArray(product?.costing?.crystal_bom) ? product.costing.crystal_bom : []
  if (!bom.length) return 0
  const variantBrandCode = (variant?.brand_code || '').trim().toUpperCase()
  return bom.reduce((sum, line) => {
    const qty = Number(line.qty) || 0
    if (!qty || !line.size) return sum
    if (!lineAppliesTo(line, variantBrandCode)) return sum
    const brand = (line.brand || '').trim()
    if (!brand) return sum
    const item = resolveCrystalCost(crystalLib, line.size, brand)
    if (!item || item.cost == null) return sum
    return sum + toHKD(item.cost, item.currency, rates) * qty
  }, 0)
}

// BOM lines that apply to this variant but resolve to no price (or have no
// brand chosen yet) — surfaced by the costing UI so it's visible, not a
// silent zero. Lines out of scope for this variant are excluded entirely
// (not "missing" — they were never meant to apply here).
export function missingCrystalLines(product, variant, crystalLib) {
  const bom = Array.isArray(product?.costing?.crystal_bom) ? product.costing.crystal_bom : []
  const variantBrandCode = (variant?.brand_code || '').trim().toUpperCase()
  return bom.filter(line => {
    const qty = Number(line.qty) || 0
    if (!qty || !line.size) return false
    if (!lineAppliesTo(line, variantBrandCode)) return false
    const brand = (line.brand || '').trim()
    if (!brand) return true
    const item = resolveCrystalCost(crystalLib, line.size, brand)
    return !item || item.cost == null
  })
}

// Per-plating adder + crystal BOM cost (HKD) for a specific variant.
export function variantAdderHKD(product, rates, variant, crystalLib) {
  const c = product?.costing || {}
  let add = 0
  const pc = c.plating_costs?.[(variant?.plating_code || '').trim().toUpperCase()]
  if (pc) add += toHKD(pc.cost, pc.currency, rates)
  add += crystalBomCostHKD(product, rates, variant, crystalLib)
  return add
}

// One-time tooling across components (HKD), amortised by the caller.
// Same plating filter as componentsCostHKD so tooling is not double-counted
// across plating variants that each carry their own tooling cost.
export function toolingHKD(product, lib, rates, variant = null) {
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const platCode = variant ? (variant.plating_code || '').trim().toUpperCase() : null
  return refs.reduce((sum, r) => {
    const c = resolveRef(r, lib)
    const refPlat = r.all_variants ? '' : (r.plating_code || c?.plating_code || '').trim().toUpperCase()
    if (platCode !== null && refPlat && refPlat !== platCode) return sum
    if (!c || !c.tooling_sample_cost) return sum
    return sum + toHKD(c.tooling_sample_cost, c.tooling_sample_cost_currency, rates)
  }, 0)
}

// Recurring (excludes tooling) unit cost in HKD for one variant at a qty.
export function variantRecurringCostHKD(product, lib, rates, variant, orderQty, crystalLib) {
  return componentsCostHKD(product, lib, rates, orderQty, variant)
    + extraLinesHKD(product, rates)
    + variantAdderHKD(product, rates, variant, crystalLib)
}

// All-in unit cost (recurring + amortised tooling) in HKD for a variant at qty.
export function variantAllInCostHKD(product, lib, rates, variant, orderQty, crystalLib) {
  const recurring = variantRecurringCostHKD(product, lib, rates, variant, orderQty, crystalLib)
  const tooling = toolingHKD(product, lib, rates, variant)
  return recurring + (orderQty > 0 ? tooling / orderQty : 0)
}

// Effective markup for a product: per-product override wins, else default.
export function productMarkup(product) {
  const m = Number(product?.costing?.markup)
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_MARKUP
}

// Sell price (HKD, rounded up) for a variant at a qty under a given markup.
export function variantSellHKD(product, lib, rates, variant, orderQty, markup, crystalLib) {
  const mk = Number.isFinite(markup) && markup > 0 ? markup : productMarkup(product)
  return Math.ceil(variantAllInCostHKD(product, lib, rates, variant, orderQty, crystalLib) * mk)
}

// True when a product has any usable costing data to publish.
export function hasCosting(product, lib, rates) {
  const refs = Array.isArray(product?.critical_components) ? product.critical_components : []
  const anyComp = refs.some(r => componentCostAtQty(resolveRef(r, lib), 1) != null)
  return anyComp || extraLinesHKD(product, rates) > 0
}
