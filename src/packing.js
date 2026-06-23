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
// Packed qty = Σ(content.qty × carton.carton_count) matched by order_line_id or item_code.
export function calcPackedVsOrdered(packableLines, cartons) {
  const tally = {}
  for (const c of cartons) {
    const count = parseInt(c.carton_count) || 1
    for (const item of (c.contents || [])) {
      const key = item.order_line_id || item.item_code
      tally[key] = (tally[key] || 0) + (parseFloat(item.qty) || 0) * count
    }
  }
  return packableLines
    .filter(l => l.packable)
    .map(l => ({
      key:         l.id || l.item_code,
      item_code:   l.item_code,
      description: l.description,
      ordered:     parseFloat(l.qty_ordered) || 0,
      packed:      tally[l.id || l.item_code] || 0,
    }))
}

// ── Load range products with packing data ─────────────────────────────────────
export async function loadRangeProductsWithPacking() {
  const snap = await getDocs(collection(db, 'range_products'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Packing list CRUD ─────────────────────────────────────────────────────────
export async function getPackingListByOrder(orderId) {
  const snap = await getDocs(query(PL_COL(), where('order_id', '==', orderId)))
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() }
}

export async function createPackingList(orderId, fields) {
  const ref = await addDoc(PL_COL(), {
    order_id:       orderId,
    status:         'estimate',
    mode:           fields.mode || 'full_carton',
    pallets_used:   false,
    consignee_name: fields.consignee_name || '',
    case_mark:      fields.case_mark || '',
    pl_date:        null,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  })
  return ref.id
}

export async function updatePackingList(plId, patch) {
  await updateDoc(PL_DOC(plId), { ...patch, updatedAt: serverTimestamp() })
}

// ── Carton CRUD ───────────────────────────────────────────────────────────────
export async function getCartonsWithContents(plId) {
  const csnap = await getDocs(query(CTN_COL(plId), orderBy('carton_seq')))
  return Promise.all(csnap.docs.map(async cd => {
    const conts = await getDocs(CONT_COL(plId, cd.id))
    return {
      id: cd.id,
      _localId: cd.id,
      ...cd.data(),
      contents: conts.docs.map(d => ({ id: d.id, _localId: d.id, ...d.data() })),
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
