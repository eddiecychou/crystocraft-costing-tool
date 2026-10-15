import { numOrNull } from './domain/validation.js'
import { bomRefApplies, colourScope, scopedVariants } from './rangeBomScope.js'
const ASSEMBLY_WEEKS_DEFAULT = 2
const PARTS_LEAD_DEFAULT = 6

export const componentMap = list => Object.fromEntries((list || []).map(c => [c.code, c]))
export const componentById = list => Object.fromEntries((list || []).map(c => [c.id, c]))

// Resolve a product's component reference to the live library record. Prefers
// the stable doc id (so renaming a component's code never breaks the link) and
// falls back to code for legacy references saved before ids were stored.
export function resolveRef(ref, lib) {
  if (!ref) return null
  const byId = componentById(lib)
  if (ref.id && byId[ref.id]) return byId[ref.id]
  const byCode = componentMap(lib)
  return byCode[(ref.code || '').toUpperCase()] || null
}

// ── Derived production signals ───────────────────────────────────────────────

const refsOf = product => (Array.isArray(product?.critical_components) ? product.critical_components : [])
const perUnit = r => { const n = Number(r?.qty_per_unit); return n > 0 ? n : 1 }

// Effective plating SCOPE of a BOM ref — the single source of truth used by MRP,
// buildable, and costing so they agree.
//   ''         ⇒ applies to ALL variants (a shared part, OR an always-needed part
//                with a fixed finish that the user flagged `all_variants`)
//   'C'/'G'/…  ⇒ a per-plating alternative: only counts for that SKU's plating
// `all_variants` is the explicit override for parts that carry a fixed finish
// (e.g. a gun-colour base used in every variant) — without it the scope would be
// wrongly inferred from the component's own plating_code (Decision 2).
export function refScopePlating(ref, lib) {
  if (ref?.all_variants) return ''
  return (ref?.plating_code || resolveRef(ref, lib)?.plating_code || '').trim().toUpperCase()
}
// Does this ref apply to a finished piece of the given SKU plating?
export function refApplies(ref, lib, skuPlating, skuColour = '') {
  return bomRefApplies(ref, resolveRef(ref, lib), { plating_code: skuPlating, crystal_code: skuColour })
}

const refPlating = (r, lib) => refScopePlating(r, lib)
const isShared = (r, lib) => !refPlating(r, lib) // scope '' ⇒ applies to all variants
const platingsTagged = (refs, lib) => [...new Set(refs.map(r => refPlating(r, lib)).filter(Boolean))]
// Plating codes the product actually offers (from its variants array).
// Returns an empty Set when no variants carry plating_code (old format → no filter applied).
const variantPlatings = product => {
  const codes = (product?.variants || [])
    .map(v => (v.plating_code || '').trim().toUpperCase())
    .filter(Boolean)
  return new Set(codes)
}

// Available component stock = on-hand − reserved (V7.13a R2). Reserved parts are
// allocated to confirmed orders and sitting on the production line, so they must
// NOT count toward what a NEW order can build — otherwise a new order would eat
// into another customer's reserved stock. Floored at 0.
export const availableOf = c =>
  Math.max(0, (Number.isFinite(c?.stock_qty) ? c.stock_qty : 0) - (Number.isFinite(c?.reserved_qty) ? c.reserved_qty : 0))

// How many finished pieces could be *assembled right now* from component stock.
// Returns { qty, bottleneck } (qty null when the product lists no critical parts).
//
// When some parts are plating-specific, a finished piece of plating P needs the
// shared parts + the parts tagged P only — NOT the parts for other platings. We
// roll up to one product number: total buildable = Σ over platings of the per-
// plating buildable, capped by the shared-parts limit (a shared body pool is
// consumed across every plating, so the product can never build more than the
// shared stock allows in total). "Soonest plating wins" semantics.
export function buildableFromComponents(product, lib) {
  const refs = refsOf(product)
  if (!refs.length) return { qty: null, bottleneck: null }

  // canMake for one ref: floor(stock / qty_per_unit), plus its code for bottleneck.
  // Components with a known short lead time (1–3 weeks) can be quickly reordered
  // and are never the limiting factor — treat as unlimited supply.
  const FAST_LEAD_WEEKS = 4   // strictly less than this = non-limiting
  const canMakeOf = r => {
    const c = resolveRef(r, lib)
    if (!c) return null
    const lt = Number(c.lead_time_weeks)
    if (lt > 0 && lt < FAST_LEAD_WEEKS) return { n: Infinity, code: c.code }
    const stock = availableOf(c)   // available = on-hand − reserved (R2)
    return { n: Math.floor(stock / perUnit(r)), code: c.code }
  }
  // Scarcest part across a list ⇒ { q, code } (q = Infinity when list is empty).
  const minOver = list => {
    let q = Infinity, code = null
    for (const r of list) { const m = canMakeOf(r); if (!m) continue; if (m.n < q) { q = m.n; code = m.code } }
    return { q, code }
  }

  if (refs.some(colourScope)) {
    // Allocate from real shared pools once, rather than summing a repeated
    // shared metal stock ceiling across colours. B0016 has one plating; this
    // conservative allocator never overstates stock for more complex BOMs.
    const remaining = new Map(lib.map(c => [c.id || c.code, availableOf(c)]))
    const byVariant = {}, bottleneckByVariant = {}
    const byPlating = {}, bottleneckByPlating = {}
    let qty = 0, bottleneck = null, unbounded = false
    for (const variant of scopedVariants(product)) {
      const applicable = refs.filter(r => refApplies(r, lib, variant.plating_code, variant.crystal_code))
      if (!applicable.some(colourScope)) continue
      let n = Infinity, driver = null, potential = Infinity, potentialDriver = null
      const demand = new Map()
      let missing = false
      for (const r of applicable) {
        const c = resolveRef(r, lib)
        if (!c) { missing = true; break }
        const key = c.id || c.code
        const lt = Number(c.lead_time_weeks)
        if (lt > 0 && lt < FAST_LEAD_WEEKS) continue
        demand.set(key, { c, qty: (demand.get(key)?.qty || 0) + perUnit(r) })
      }
      for (const [key, d] of demand) {
        const independent = Math.floor(availableOf(d.c) / d.qty)
        if (independent < potential) { potential = independent; potentialDriver = d.c.code }
        const possible = Math.floor((remaining.get(key) || 0) / d.qty)
        if (possible < n) { n = possible; driver = d.c.code }
      }
      const count = missing ? 0 : Number.isFinite(n) ? Math.max(0, n) : null
      const key = `${variant.plating_code}|${variant.crystal_code}`
      // Per-colour availability is an alternative, not leftover stock after
      // another colour's allocation. Only the aggregate consumes shared pools.
      byVariant[key] = missing ? 0 : Number.isFinite(potential) ? potential : null
      bottleneckByVariant[key] = potentialDriver
      const plating = variant.plating_code
      byPlating[plating] = count == null || byPlating[plating] === null ? null : (byPlating[plating] || 0) + count
      bottleneckByPlating[plating] = driver
      if (count != null) {
        qty += count
        for (const [key, d] of demand) remaining.set(key, remaining.get(key) - count * d.qty)
      }
      else unbounded = true
      if (driver) bottleneck = driver
    }
    return { qty: unbounded ? null : qty, bottleneck, byVariant, bottleneckByVariant, byPlating, bottleneckByPlating }
  }

  // Fast path / unchanged behaviour: no plating-specific parts ⇒ one shared group.
  const platings = platingsTagged(refs, lib)
  if (!platings.length) {
    const { q, code } = minOver(refs)
    return { qty: Number.isFinite(q) ? q : null, bottleneck: code }
  }

  const sharedCeiling = minOver(refs.filter(r => isShared(r, lib)))
  const sharedCap = Number.isFinite(sharedCeiling.q) ? sharedCeiling.q : Infinity

  // Only compute buildable for platings the product actually offers. This prevents
  // a stale or mislinked component (e.g. a GM body on a C/G-only product) from
  // creating phantom availability for a plating the product never ships in.
  const vpSet = variantPlatings(product)
  const activePlatings = vpSet.size > 0 ? platings.filter(p => vpSet.has(p)) : platings

  // Per-plating buildable: tagged parts for plating P capped by shared ceiling.
  // Also track the bottleneck per plating (shared part wins when it's the binding cap).
  const byPlating = {}
  const bottleneckByPlating = {}
  let sumTagged = 0, minTagged = Infinity, minTaggedCode = null
  for (const p of activePlatings) {
    const tg = minOver(refs.filter(r => refPlating(r, lib) === p))
    if (!Number.isFinite(tg.q)) continue
    const platBuildable = Math.min(Math.max(0, tg.q), sharedCap)
    byPlating[p] = platBuildable
    bottleneckByPlating[p] = (Number.isFinite(sharedCeiling.q) && sharedCeiling.q <= tg.q)
      ? sharedCeiling.code : tg.code
    sumTagged += Math.max(0, tg.q)
    if (tg.q < minTagged) { minTagged = tg.q; minTaggedCode = tg.code }
  }
  const qty = Math.min(sharedCap, sumTagged)
  const bottleneck = (Number.isFinite(sharedCeiling.q) && sharedCeiling.q <= sumTagged) ? sharedCeiling.code : minTaggedCode
  return { qty: Number.isFinite(qty) ? qty : null, bottleneck, byPlating, bottleneckByPlating }
}

// Lead weeks to make from scratch the scarce parts. Returns { weeks, driver };
// weeks is null when at least one plating is fully covered by stock (nothing to
// make). With plating-specific parts we report the SOONEST deliverable plating
// (min across platings of its longest-uncovered lead) so a slow/zero plating
// doesn't poison the promise for a plating we can ship faster.
export function makeLeadWeeks(product, lib, { defaultPartsLeadWeeks = PARTS_LEAD_DEFAULT } = {}) {
  const refs = refsOf(product)
  if (!refs.length) return { weeks: null, driver: null }

  // Longest-lead uncovered part in a list ⇒ { w, code } (w null when all covered).
  // When lead_time_weeks is 0 or unset on an out-of-stock component, we use
  // defaultPartsLeadWeeks as a conservative fallback — never silently promise a
  // fast turnaround on a part we have no lead time data for.
  const longestUncovered = list => {
    let w = null, code = null
    for (const r of list) {
      const c = resolveRef(r, lib)
      if (!c) continue
      const stock = availableOf(c)               // available = on-hand − reserved (R2)
      if (stock >= perUnit(r)) continue          // this part is covered
      const rawLt = Number(c.lead_time_weeks)
      const lw = rawLt > 0 ? rawLt : defaultPartsLeadWeeks
      if (w == null || lw > w) { w = lw; code = c.code }
    }
    return { w, code }
  }

  if (refs.some(colourScope)) {
    let best = null, driver = null
    for (const variant of scopedVariants(product)) {
      const applicable = refs.filter(r => refApplies(r, lib, variant.plating_code, variant.crystal_code))
      if (!applicable.some(colourScope)) continue
      const uncovered = longestUncovered(applicable)
      const weeks = uncovered.w == null ? 0 : uncovered.w
      if (best == null || weeks < best) { best = weeks; driver = uncovered.code }
    }
    return best === 0 ? { weeks: null, driver: null } : { weeks: best, driver }
  }

  const platings = platingsTagged(refs, lib)
  if (!platings.length) {
    const { w, code } = longestUncovered(refs)
    return { weeks: w, driver: code }
  }

  // Only consider platings the product actually ships in (same guard as buildableFromComponents).
  const vpSet = variantPlatings(product)
  const activePlatings = vpSet.size > 0 ? platings.filter(p => vpSet.has(p)) : platings

  // Per plating: shared + that plating's tagged parts. Soonest plating wins.
  const shared = refs.filter(r => isShared(r, lib))
  let best = null, driver = null
  for (const p of activePlatings) {
    const tagged = refs.filter(r => refPlating(r, lib) === p)
    const u = longestUncovered([...shared, ...tagged])
    const w = u.w == null ? 0 : u.w            // 0 ⇒ this plating fully covered
    if (best == null || w < best) { best = w; driver = u.code }
  }
  return best === 0 ? { weeks: null, driver: null } : { weeks: best, driver }
}

// Finished, ready-to-ship pieces (already plated). Mirrors the Range list:
// plating pool + unplated per-SKU stock, else per-variant stock.
export function finishedStockOf(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : []
  const pool = product?.plating_stock && Object.keys(product.plating_stock).length ? product.plating_stock : null
  const pos = n => (Number(n) > 0 ? Number(n) : 0)
  if (pool) {
    const poolSum = Object.values(pool).reduce((s, n) => s + pos(n), 0)
    const unplated = variants.reduce((s, v) => s + (!(v.plating_code || '').trim() ? pos(v.stock_finished) : 0), 0)
    return poolSum + unplated
  }
  return variants.reduce((s, v) => s + pos(v.stock_finished), 0)
}

// Compose the single customer-facing promise from lifecycle status + live
// availability. A non-empty product.delivery_note overrides everything.
// Returns { promise, leadWeeks, finished, buildable, bottleneck, effectiveMoq }.
// effectiveMoq: 0 for last-stock (sell whatever remains, no minimum), else product.moq.
export function productAvailability(product, lib, { defaultPartsLeadWeeks = PARTS_LEAD_DEFAULT } = {}) {
  // Concept — not tooled, no stock. No buildable/lead/MOQ math; enquiry only.
  if (product?.status === 'concept') {
    const promise = 'Concept — enquire to register interest.'
    return { promise, customerPromise: promise, status: 'concept', leadWeeks: null,
      finished: 0, buildable: null, bottleneck: null, byPlating: {}, bottleneckByPlating: {}, effectiveMoq: 0 }
  }
  // Retired — last-stock has fully sold out; no stock left and no re-run.
  if (product?.status === 'retired') {
    const promise = 'Retired — no stock remaining.'
    return { promise, customerPromise: promise, status: 'retired', leadWeeks: null,
      finished: 0, buildable: 0, bottleneck: null, byPlating: {}, bottleneckByPlating: {}, effectiveMoq: 0 }
  }
  const status = product?.status === 'stock' ? 'stock' : 'active'   // 'active' = Made to Order
  const finished = finishedStockOf(product)
  const refs = refsOf(product)
  const { qty: buildable, bottleneck, byPlating, bottleneckByPlating } = buildableFromComponents(product, lib)
  const make = makeLeadWeeks(product, lib, { defaultPartsLeadWeeks })
  const assembly = numOrNull(product?.lead_time_weeks) ?? ASSEMBLY_WEEKS_DEFAULT
  const moq = numOrNull(product?.moq)
  const moqTxt = moq ? `, MOQ ${moq}` : ''

  // Canonical availability status (spec: ProductAvailabilityResult). Additive —
  // it sits alongside the human-readable promise and changes no existing string.
  const availStatus =
    status === 'stock' ? (buildable > 0 ? 'last_stock_only' : 'sold_out')
      : !refs.length    ? 'buildable_mto'
      : buildable == null ? 'review_needed'
      : 'buildable_mto'

  const note = (product?.delivery_note || '').trim()
  if (note) return { promise: note, customerPromise: note, status: availStatus, leadWeeks: null, finished, buildable, bottleneck, byPlating, bottleneckByPlating, effectiveMoq: moq ?? 0 }

  // `promise` is the internal/admin string (may name the bottleneck part code).
  // `customerPromise` is the portal-safe version — same facts, never an ERP code.
  let promise, leadWeeks, effectiveMoq, customerPromise
  if (status === 'stock') {                       // Retired Stock — availability from remaining parts
    effectiveMoq = 0
    if (byPlating && Object.keys(byPlating).length) {
      const parts = Object.entries(byPlating).map(([p, n]) => `${p}: ${n}`).join(' · ')
      promise = buildable > 0
        ? `Final stock — no re-runs. (${parts})`
        : 'Sold out — no parts remaining.'
    } else {
      promise = buildable > 0
        ? `Final stock — ${buildable} buildable from remaining parts, no re-runs.`
        : 'Sold out — no parts remaining.'
    }
    leadWeeks = buildable > 0 ? assembly : null
  } else if (!refs.length) {                       // no critical parts tracked — assume default parts lead
    effectiveMoq = moq ?? 0
    const w = defaultPartsLeadWeeks + assembly
    promise = `Made to order — ~${w} weeks${moqTxt}.`
    leadWeeks = w
  } else if (buildable && buildable > 0) {         // parts on hand, just assemble
    effectiveMoq = moq ?? 0
    promise = `Made to order — ~${assembly} weeks${moqTxt} (${buildable} buildable from stock now).`
    leadWeeks = assembly
  } else {                                         // must source the scarce part first
    effectiveMoq = moq ?? 0
    // Total = component procurement lead + assembly. If no component data, fall back to assembly alone.
    const w = make.weeks != null ? make.weeks + assembly : assembly
    const drv = make.driver ? ` — waiting on ${make.driver}` : ''
    promise = `Made to order — ~${w} weeks${moqTxt}${drv}.`
    customerPromise = `Made to order — ~${w} weeks${moqTxt}.`   // no internal part code
    leadWeeks = w
  }
  // Other branches carry no internal code, so the customer string matches the promise.
  if (customerPromise == null) customerPromise = promise
  return { promise, customerPromise, status: availStatus, leadWeeks, finished, buildable, bottleneck, byPlating, bottleneckByPlating, effectiveMoq }
}

