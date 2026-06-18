import { useState, useEffect } from 'react'
import { doc, onSnapshot, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Fallback markup when a customer has no group/override (cost × this).
export const DEFAULT_MARKUP = 2.0

// ---- Pricing groups (settings/pricing_groups) --------------------------------
// Shape: { groups: [{ id, name, markup }], updatedAt }

export function usePricingGroups() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(doc(db, 'settings', 'pricing_groups'),
    s => { const d = s.exists() ? s.data() : {}; setGroups(Array.isArray(d.groups) ? d.groups : []); setLoading(false) },
    () => { setGroups([]); setLoading(false) }), [])
  return { groups, loading }
}

export async function loadPricingGroups() {
  const s = await getDoc(doc(db, 'settings', 'pricing_groups'))
  const d = s.exists() ? s.data() : {}
  return Array.isArray(d.groups) ? d.groups : []
}

// Effective markup for a storefront user: a per-customer override wins, else the
// assigned group's markup, else the global default.
export function effectiveMarkup(user, groups) {
  const ov = Number(user?.corp_markup_override)
  if (Number.isFinite(ov) && ov > 0) return ov
  const g = (groups || []).find(g => g.id === user?.pricing_group)
  const gm = Number(g?.markup)
  if (Number.isFinite(gm) && gm > 0) return gm
  return DEFAULT_MARKUP
}

export function markupLabel(user, groups) {
  const ov = Number(user?.corp_markup_override)
  if (Number.isFinite(ov) && ov > 0) return `${ov.toFixed(2)}× (override)`
  const g = (groups || []).find(g => g.id === user?.pricing_group)
  if (g && Number(g.markup) > 0) return `${Number(g.markup).toFixed(2)}× · ${g.name}`
  return `${DEFAULT_MARKUP.toFixed(2)}× (default)`
}

// ---- Cost computation (pure, shared by PricingTiers + publish) ----------------
// Each `component` is expected as { qty_per_product, preferred_quote } where the
// quote carries { unit_cost, unit_cost_currency, volume_tiers, tooling_sample_cost,
// tooling_sample_cost_currency }. `rates` maps currency → HKD.

export function componentUnitCostAtQty(q, orderQty) {
  if (!q || q.unit_cost == null) return null
  const tiers = q.volume_tiers
  if (tiers && tiers.length > 0) {
    const applicable = tiers
      .filter(t => t.min_qty <= orderQty)
      .sort((a, b) => b.min_qty - a.min_qty)[0]
    if (applicable) return Number(applicable.unit_cost)
  }
  return Number(q.unit_cost)
}

export function unitCostHKDAtQty(components, rates, orderQty) {
  return components.reduce((sum, c) => {
    const q = c.preferred_quote
    if (!q) return sum
    const unitCost = componentUnitCostAtQty(q, orderQty)
    if (unitCost == null) return sum
    const compQty = Number(c.qty_per_product) || 1
    return sum + unitCost * (rates[q.unit_cost_currency] || 1) * compQty
  }, 0)
}

export function toolingCostHKD(components, rates) {
  return components.reduce((sum, c) => {
    const q = c.preferred_quote
    if (!q || !q.tooling_sample_cost) return sum
    return sum + Number(q.tooling_sample_cost) * (rates[q.tooling_sample_cost_currency] || 1)
  }, 0)
}

// All-in unit cost (recurring + amortised tooling) in HKD at a given quantity.
export function totalUnitCostAtQty(components, rates, qty) {
  return unitCostHKDAtQty(components, rates, qty) + (qty > 0 ? toolingCostHKD(components, rates) / qty : 0)
}
