import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, query, orderBy, where,
} from 'firebase/firestore'
import { db } from './firebase'

// ── Firestore refs ────────────────────────────────────────────────────────────
// packing_lists is top-level (matching existing Firestore rules)
const PL_COL   = () => collection(db, 'packing_lists')
const PL_DOC   = id => doc(db, 'packing_lists', id)
const CTN_COL  = plId => collection(db, 'packing_lists', plId, 'cartons')
const CTN_DOC  = (plId, cId) => doc(db, 'packing_lists', plId, 'cartons', cId)
const CONT_COL = (plId, cId) => collection(db, 'packing_lists', plId, 'cartons', cId, 'contents')

// ── Constants ─────────────────────────────────────────────────────────────────
export const PL_STATUSES = [
  { value: 'estimate', label: 'Estimate', style: 'bg-blue-100 text-blue-700' },
  { value: 'final',    label: 'Final',    style: 'bg-green-100 text-green-700' },
]

export const PACK_MODES = [
  { value: 'full_carton', label: 'Full-carton',  desc: 'One product per carton — pre-fill from standard packing' },
  { value: 'mixed',       label: 'Mixed / flat',  desc: 'Multiple SKUs per carton — enter contents manually' },
]

// Per-carton mode (P-1). `mode` on the list is deprecated — each carton owns its
// pack_mode so one list can hold both single-SKU and mixed cartons without the
// old destructive contents[0] reinterpretation.
export const CARTON_MODES = [
  { value: 'single', label: 'Single SKU', desc: 'One product in this carton' },
  { value: 'mixed',  label: 'Mixed',      desc: 'Several SKUs in this carton' },
]

// ── Dimension helpers ─────────────────────────────────────────────────────────
// Parse "50 x 40 x 30 cm" or "50x40x30" → { l, w, h } or null
export function parseDims(str) {
  if (!str) return null
  const nums = String(str).replace(/cm/i, '').split(/[x×*]/i).map(s => parseFloat(s.trim()))
  return nums.length === 3 && nums.every(n => !isNaN(n) && n > 0)
    ? { l: nums[0], w: nums[1], h: nums[2] }
    : null
}

export function calcCbm(l, w, h) {
  if (!l || !w || !h) return 0
  return Math.round(l * w * h / 1_000_000 * 1e6) / 1e6
}

// GW to use for this carton: actual if measured, else standard
export function effectiveGw(c) {
  const gw = c.gw_kg_actual ?? c.gw_kg_standard
  return parseFloat(gw) || 0
}

// Derived CBM from stored dims (for display when user edits L/W/H)
export function derivedCbm(c) {
  const l = parseFloat(c.length_cm)
  const w = parseFloat(c.width_cm)
  const h = parseFloat(c.height_cm)
  return l && w && h ? calcCbm(l, w, h) : (parseFloat(c.cbm_per_carton) || 0)
}

// Weight of one empty pallet (kg) — added to the gross weight once per palletised
// pallet, since the wrapped pallet ships with its own timber weight.
export const PALLET_WEIGHT_KG = 8

// Palletised CBM from a pallet's own L×W×H (metres → m³). Null unless all three
// are set — the wrapped pallet's real volume, which differs from the carton sum.
export function palletDimCbm(p) {
  const l = parseFloat(p?.length_m), w = parseFloat(p?.width_m), h = parseFloat(p?.height_m)
  return (l > 0 && w > 0 && h > 0) ? Math.round(l * w * h * 1e4) / 1e4 : null
}

// Grand totals for a packing list, palletised: each pallet with L×W×H entered
// ships at that wrapped volume (not the carton sum) and carries one pallet's
// timber weight. Pallets without dims fall back to the carton sum, unchanged.
// cartons: [{ pallet_no, carton_count, ...dims, gw }]; pallets: [{ pallet_no, length_m,… }].
export function palletisedTotals(cartons = [], pallets = []) {
  let totalCartons = 0, cartonCbm = 0, totalGw = 0
  const perPalletCartonCbm = {}
  for (const c of cartons) {
    const count = parseInt(c.carton_count) || 1
    totalCartons += count
    const cCbm = (derivedCbm(c) || 0) * count
    cartonCbm += cCbm
    const no = parseInt(c.pallet_no) || 1
    perPalletCartonCbm[no] = (perPalletCartonCbm[no] || 0) + cCbm
    totalGw += effectiveGw(c) * count
  }
  let totalCbm = 0, palletCount = 0
  for (const no of Object.keys(perPalletCartonCbm).map(Number)) {
    const dim = palletDimCbm((pallets || []).find(p => (parseInt(p.pallet_no) || 1) === no))
    if (dim != null) { totalCbm += dim; palletCount += 1 } else totalCbm += perPalletCartonCbm[no]
  }
  totalGw += palletCount * PALLET_WEIGHT_KG
  return {
    totalCartons,
    totalCbm: Math.round(totalCbm * 1e4) / 1e4,
    cartonCbm: Math.round(cartonCbm * 1e4) / 1e4,
    totalGw: Math.round(totalGw * 10) / 10,
    palletCount,
  }
}

// ── Standard packing pre-fill ─────────────────────────────────────────────────
// Returns array of carton rows derived from packable order lines + product packing data.
// Caller is responsible for loading rangeProducts with their `packing` field.
export function buildFullCartonPlan(packableLines, rangeProducts) {
  let seq = 1
  return packableLines
    .filter(l => l.packable)
    .map(line => {
      const prod = rangeProducts.find(p => p.id === line.matched_product_ref?.id)
      const pk   = prod?.packing || {}
      const pcsPerCtn = parseFloat(pk.pcs_per_carton) || 0
      const qty       = parseFloat(line.qty_ordered) || 0
      const count     = pcsPerCtn > 0 ? Math.ceil(qty / pcsPerCtn) : 1
      const dims      = parseDims(pk.carton_dims)
      const gw        = parseFloat(pk.weight_per_carton_kg) || null
      const cbm       = dims
        ? calcCbm(dims.l, dims.w, dims.h)
        : (parseFloat(pk.cbm_per_carton) || null)

      const row = {
        _localId: crypto.randomUUID(),
        id: null,
        carton_seq: seq,
        carton_count: count,
        packaging_code: pk.pack_box_ref || '',
        gw_kg_standard: gw,
        gw_kg_actual: null,
        length_cm: dims?.l ?? null,
        width_cm:  dims?.w ?? null,
        height_cm: dims?.h ?? null,
        cbm_per_carton: cbm,
        nw_kg: null,
        is_estimate: true,
        notes: '',
        contents: [{
          _localId: crypto.randomUUID(),
          id: null,
          item_code:     line.item_code || '',
          description:   line.description || '',
          qty:           pcsPerCtn || qty,
          order_line_id: line.id || '',
        }],
      }
      seq += count
      return row
    })
}

// ── Packed-vs-ordered reconciliation ─────────────────────────────────────────
// Returns array of { key, item_code, description, ordered, packed } per packable line.
// Packed qty = Σ(content.qty × carton.carton_count), matched to an ordered line.
//
// Imported PI lines key on their Firestore doc id, but mixed-carton contents the
// user types have no order_line_id — so they could only ever key on item_code.
// We bridge the two: a content resolves to a line by its explicit order_line_id,
// else via a normalised item_code → line.id map. Without this, any mixed-carton
// entry falsely shows "0 packed / quantity mismatch" even when the code matches.
const normCode = s => (s == null ? '' : String(s)).trim().toUpperCase()

export function calcPackedVsOrdered(packableLines, cartons) {
  const packable = packableLines.filter(l => l.packable)
  // Map each ordered line's item_code back to its line id (first one wins).
  const codeToLineId = {}
  for (const l of packable) {
    const code = normCode(l.item_code)
    if (code && l.id && !(code in codeToLineId)) codeToLineId[code] = l.id
  }
  const tally = {}
  for (const c of cartons) {
    const count = parseInt(c.carton_count) || 1
    for (const item of (c.contents || [])) {
      const code = normCode(item.item_code)
      const key = item.order_line_id || codeToLineId[code] || code
      if (!key) continue
      tally[key] = (tally[key] || 0) + (parseFloat(item.qty) || 0) * count
    }
  }
  return packable.map(l => ({
    key:         l.id || l.item_code,
    item_code:   l.item_code,
    description: l.description,
    ordered:     parseFloat(l.qty_ordered) || 0,
    packed:      tally[l.id || normCode(l.item_code)] || 0,
  }))
}

// ── Load range products with packing data ─────────────────────────────────────
export async function loadRangeProductsWithPacking() {
  const snap = await getDocs(collection(db, 'range_products'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Packing list / scenario CRUD ──────────────────────────────────────────────
// An order may have MANY packing lists ("scenarios"), each labelled (e.g.
// "Standard carton", "Flat pack"). Exactly one is `selected` (the working plan
// used downstream for export/shipment).

// All scenarios for an order, oldest first (stable switcher order).
export async function getPackingScenariosByOrder(orderId) {
  const snap = await getDocs(query(PL_COL(), where('order_id', '==', orderId)))
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
  // Back-compat: a legacy list with no label/selected is the implicit Standard scenario.
  return rows.map((r, i) => ({
    ...r,
    label: r.label || 'Standard carton',
    selected: r.selected ?? (rows.every(x => !x.selected) && i === 0),
  }))
}

// Kept for any single-list callers — returns the selected (or first) scenario.
export async function getPackingListByOrder(orderId) {
  const rows = await getPackingScenariosByOrder(orderId)
  if (!rows.length) return null
  return rows.find(r => r.selected) || rows[0]
}

export async function createPackingList(orderId, fields = {}) {
  const ref = await addDoc(PL_COL(), {
    order_id:       orderId,
    label:          fields.label || 'Standard carton',
    selected:       fields.selected ?? false,
    status:         'estimate',
    pallets_used:   false,
    consignee_name: fields.consignee_name || '',
    case_mark:      fields.case_mark || '',
    pl_date:        null,
    shipped_per:    fields.shipped_per || '',
    pallets:        fields.pallets || [],
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  })
  return ref.id
}

export async function updatePackingList(plId, patch) {
  await updateDoc(PL_DOC(plId), { ...patch, updatedAt: serverTimestamp() })
}

// Mark one scenario selected and clear the rest (exactly-one invariant).
export async function selectScenario(orderId, scenarioId) {
  const snap = await getDocs(query(PL_COL(), where('order_id', '==', orderId)))
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.update(d.ref, { selected: d.id === scenarioId, updatedAt: serverTimestamp() }))
  await batch.commit()
}

// Delete a scenario and all its cartons/contents.
export async function deleteScenario(plId) {
  const cs = await getDocs(CTN_COL(plId))
  for (const cd of cs.docs) {
    const conts = await getDocs(CONT_COL(plId, cd.id))
    const b = writeBatch(db)
    conts.docs.forEach(d => b.delete(d.ref))
    b.delete(cd.ref)
    await b.commit()
  }
  await deleteDoc(PL_DOC(plId))
}

// ── Carton CRUD ───────────────────────────────────────────────────────────────
export async function getCartonsWithContents(plId) {
  const csnap = await getDocs(query(CTN_COL(plId), orderBy('carton_seq')))
  return Promise.all(csnap.docs.map(async cd => {
    const conts = await getDocs(CONT_COL(plId, cd.id))
    const data = cd.data()
    const contents = conts.docs.map(d => ({ id: d.id, _localId: d.id, ...d.data() }))
    return {
      id: cd.id,
      _localId: cd.id,
      ...data,
      // Per-carton mode (P-1). Auto-migrate legacy cartons: those with >1 content
      // are mixed, otherwise single. Persisted on next save.
      pack_mode: data.pack_mode || (contents.length > 1 ? 'mixed' : 'single'),
      contents,
    }
  }))
}

// Full replace: delete all existing cartons+contents, then write fresh.
// Returns the new Firestore carton IDs in order.
export async function saveCartonsWithContents(plId, cartons) {
  // Delete existing
  const existing = await getDocs(CTN_COL(plId))
  for (const cd of existing.docs) {
    const conts = await getDocs(CONT_COL(plId, cd.id))
    const b = writeBatch(db)
    conts.docs.forEach(d => b.delete(d.ref))
    b.delete(cd.ref)
    await b.commit()
  }

  // Write new
  const newIds = []
  for (const c of cartons) {
    const { contents, _localId, id: _id, ...rest } = c
    const normRest = {
      carton_seq:     parseInt(rest.carton_seq) || 1,
      carton_count:   parseInt(rest.carton_count) || 1,
      pallet_no:      parseInt(rest.pallet_no) || 1,
      pack_mode:      rest.pack_mode === 'mixed' ? 'mixed' : 'single',
      packaging_code: rest.packaging_code || '',
      gw_kg_standard: parseFloat(rest.gw_kg_standard) || null,
      gw_kg_actual:   parseFloat(rest.gw_kg_actual) || null,
      length_cm:      parseFloat(rest.length_cm) || null,
      width_cm:       parseFloat(rest.width_cm) || null,
      height_cm:      parseFloat(rest.height_cm) || null,
      cbm_per_carton: derivedCbm(rest),
      nw_kg:          parseFloat(rest.nw_kg) || null,
      is_estimate:    rest.is_estimate !== false,
      notes:          rest.notes || '',
      updatedAt:      serverTimestamp(),
    }
    const cRef = await addDoc(CTN_COL(plId), normRest)
    newIds.push(cRef.id)
    if ((contents || []).length) {
      const b = writeBatch(db)
      for (const item of contents) {
        const { _localId: _li, id: _ii, ...iRest } = item
        b.set(doc(CONT_COL(plId, cRef.id)), {
          item_code:     iRest.item_code || '',
          description:   iRest.description || '',
          qty:           parseFloat(iRest.qty) || 0,
          order_line_id: iRest.order_line_id || '',
        })
      }
      await b.commit()
    }
  }
  return newIds
}

// ── Live hook ─────────────────────────────────────────────────────────────────
export function usePackingList(orderId) {
  const [pl, setPl]           = useState(null)
  const [cartons, setCartons] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    ;(async () => {
      const found = await getPackingListByOrder(orderId)
      if (cancelled) return
      if (found) {
        setPl(found)
        setCartons(await getCartonsWithContents(found.id))
      } else {
        setPl(null)
        setCartons([])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [orderId])

  return { pl, cartons, loading, setPl, setCartons }
}
