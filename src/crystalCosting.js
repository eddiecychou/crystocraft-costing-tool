import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Crystal unit-cost library — a flat, freely editable price list of stone SKUs.
// Each row is (size, brand, cost, currency). This is deliberately NOT a fixed
// size×brand grid: large facet stones (14mm/18mm/20mm Octagon, 14mm Heart) are
// priced by crystal brand (Bohemia/Asfour/Swarovski — the same D/A/U axis a
// figurine variant already carries), but small pavé stones (PP18/26/32) are
// priced by a DIFFERENT, unrelated brand pair (Swarovski/Preciosa) that has
// nothing to do with the figurine's own crystal brand. A flat list lets staff
// add new sizes or brands (e.g. a new stone size, or "Preciosa" for a facet
// stone) at any time without a schema change.
//
// Shape: settings/crystal_unit_costs -> { items: [{ id, size, brand, cost, currency }] }
const DOC_REF = () => doc(db, 'settings', 'crystal_unit_costs')

const newId = () => 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

const norm = it => ({
  id: it.id || newId(),
  size: (it.size || '').trim(),
  brand: (it.brand || '').trim(),
  cost: it.cost === '' || it.cost == null || !Number.isFinite(Number(it.cost)) ? null : Number(it.cost),
  currency: (it.currency || 'RMB').trim() || 'RMB',
})

// Starter rows so the list isn't empty on first use — costs start blank
// (staff fills in the real unit price). Brand text for the D/A/U rows matches
// RANGE_CRYSTAL_BRANDS names exactly, so a costing BOM line left on "Same as
// variant brand" resolves automatically; PP-size rows use the small-stone
// brand pair (Swarovski/Preciosa), which a BOM line must pick explicitly since
// it has no relationship to the figurine's own crystal brand.
export const DEFAULT_CRYSTAL_UNIT_COSTS = [
  ['14mm Octagon', 'Bohemia'], ['14mm Octagon', 'Asfour / Chinese'], ['14mm Octagon', 'Swarovski'],
  ['18mm Octagon', 'Bohemia'], ['18mm Octagon', 'Asfour / Chinese'], ['18mm Octagon', 'Swarovski'],
  ['14mm Heart', 'Bohemia'], ['14mm Heart', 'Asfour / Chinese'], ['14mm Heart', 'Swarovski'],
  ['20mm Octagon', 'Bohemia'], ['20mm Octagon', 'Asfour / Chinese'], ['20mm Octagon', 'Swarovski'],
  ['PP18', 'Swarovski'], ['PP18', 'Preciosa'],
  ['PP26', 'Swarovski'], ['PP26', 'Preciosa'],
  ['PP32', 'Swarovski'], ['PP32', 'Preciosa'],
].map(([size, brand]) => norm({ size, brand, cost: null, currency: 'RMB' }))

export async function loadCrystalUnitCosts() {
  try {
    const s = await getDoc(DOC_REF())
    const arr = s.exists() ? s.data().items : null
    return Array.isArray(arr) && arr.length ? arr.map(norm) : DEFAULT_CRYSTAL_UNIT_COSTS
  } catch {
    return DEFAULT_CRYSTAL_UNIT_COSTS
  }
}

export async function saveCrystalUnitCosts(items) {
  await setDoc(DOC_REF(), { items: (items || []).map(norm), updatedAt: serverTimestamp() }, { merge: true })
}

export function useCrystalUnitCosts() {
  const [items, setItems] = useState(DEFAULT_CRYSTAL_UNIT_COSTS)
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(DOC_REF(),
    s => {
      const arr = s.exists() ? s.data().items : null
      setItems(Array.isArray(arr) && arr.length ? arr.map(norm) : DEFAULT_CRYSTAL_UNIT_COSTS)
      setLoading(false)
    },
    () => { setItems(DEFAULT_CRYSTAL_UNIT_COSTS); setLoading(false) },
  ), [])
  return { items, loading }
}

// Distinct sizes present in the library, in first-seen order (for a BOM size picker).
export const crystalSizesOf = items => [...new Set((items || []).map(i => i.size).filter(Boolean))]

// Brands priced for one size (for a BOM brand picker).
export const crystalBrandsForSize = (items, size) =>
  (items || []).filter(i => i.size === size).map(i => i.brand).filter(Boolean)

// Exact (size, brand) lookup.
export const resolveCrystalCost = (items, size, brand) =>
  (items || []).find(i => i.size === size && i.brand === brand) || null
