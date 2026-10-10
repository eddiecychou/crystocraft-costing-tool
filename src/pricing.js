import { useState, useEffect } from 'react'
import { doc, onSnapshot, getDoc } from 'firebase/firestore'
import { db } from './firebase'
export { DEFAULT_MARKUP, componentUnitCostAtQty, unitCostHKDAtQty, toolingCostHKD, totalUnitCostAtQty } from './pricingCore.js'
import { DEFAULT_MARKUP } from './pricingCore.js'


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
