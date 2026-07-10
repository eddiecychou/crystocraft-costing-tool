import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, setDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

// Crystal inventory (V7.13a crystals). A SEPARATE inventory class from the metal
// range_components: crystals are stocked per colour SKU (each an ERP code, e.g.
// BDC-8232-0014-005 = Rosaline/PI) and are consumed BATCH-per-order — there is
// deliberately no per-product colour BOM (see Inventory_Roadmap_V7.13_Spec.md §3-4).
// Kept out of range_components so they never pollute the figurine MRP / buildable
// logic, but they reuse the same collection-agnostic stock ledger (stockLedger.js)
// under crystals/{id}/movements.
//
//   crystals/{id}   { code, name, colour, size, stock_qty (cached), ledger_seeded, notes }

const COL = () => collection(db, 'crystals')
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

export const normCrystal = c => ({
  code: (c.code || '').trim().toUpperCase(),
  name: (c.name || '').trim(),
  colour: (c.colour || '').trim(),
  size: (c.size || '').trim(),
  notes: (c.notes || '').trim(),
  stock_qty: num(c.stock_qty),
})

const fromDoc = d => ({ id: d.id, ...d.data(), ...normCrystal(d.data()) })

export async function loadCrystals() {
  try {
    const snap = await getDocs(query(COL(), orderBy('code')))
    return snap.docs.map(fromDoc)
  } catch { return [] }
}

// Live list of crystal SKUs (for the Crystal Stock tab).
export function useCrystals() {
  const [crystals, setCrystals] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(COL(), orderBy('code'))
    return onSnapshot(q,
      snap => { setCrystals(snap.docs.map(fromDoc)); setLoading(false) },
      () => { setCrystals([]); setLoading(false) },
    )
  }, [])
  return { crystals, loading }
}

// Descriptive fields only — stock_qty is owned by the ledger (never written here).
const descriptorOf = c => {
  const n = normCrystal(c)
  return { code: n.code, name: n.name, colour: n.colour, size: n.size, notes: n.notes }
}

export async function saveCrystal(id, data) {
  const payload = { ...descriptorOf(data), updatedAt: serverTimestamp() }
  if (id) { await setDoc(doc(db, 'crystals', id), payload, { merge: true }); return id }
  const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteCrystal(id) {
  await deleteDoc(doc(db, 'crystals', id))
}

// Idempotent stock-import: upsert crystal SKUs by code and, since a stock list is
// an absolute count, mirror every set into the ledger as a stocktake movement so
// the cached stock_qty and the append-only history never diverge. Rows:
//   [{ code, name, colour, size, stock_qty }]
export async function importCrystalStock(rows) {
  const norm = s => (s == null ? '' : String(s)).trim().toUpperCase()
  const clean = (rows || []).map(r => ({
    code: norm(r.code), name: (r.name || '').trim(), colour: (r.colour || '').trim(),
    size: (r.size || '').trim(), stock_qty: num(r.stock_qty),
  })).filter(r => r.code)
  if (!clean.length) return { created: 0, updated: 0 }

  // Dedupe by code (last non-empty wins on name/colour/size; last stock wins).
  const byCode = {}
  for (const r of clean) {
    const c = byCode[r.code] || (byCode[r.code] = { code: r.code, name: '', colour: '', size: '', stock_qty: null })
    if (r.name) c.name = r.name
    if (r.colour) c.colour = r.colour
    if (r.size) c.size = r.size
    if (r.stock_qty != null) c.stock_qty = r.stock_qty
  }

  // Existing crystals by code → { id, hasName, prevStock }.
  const snap = await getDocs(COL())
  const existing = {}
  for (const d of snap.docs) {
    const code = norm(d.data().code)
    if (code && !(code in existing)) {
      const prev = d.data().stock_qty
      existing[code] = { id: d.id, hasName: !!(d.data().name || '').trim(), prevStock: Number.isFinite(prev) ? prev : 0 }
    }
  }

  const importDate = new Date().toISOString().slice(0, 10)
  let seq = Date.now()
  const stocktakeOp = (id, counted, prev) => ({
    ref: doc(collection(db, 'crystals', id, 'movements')),
    data: {
      type: 'stocktake', qty: counted - prev, counted, balance_after: counted,
      date: importDate, note: 'Stock-take (list import)', order_id: null,
      seq: seq++, createdAt: serverTimestamp(),
    },
    merge: false,
  })

  const ops = []
  let created = 0, updated = 0
  for (const c of Object.values(byCode)) {
    const counted = Number.isFinite(c.stock_qty) ? c.stock_qty : null
    const ex = existing[c.code]
    if (ex) {
      const data = { colour: c.colour, size: c.size, updatedAt: serverTimestamp() }
      if (!ex.hasName && c.name) data.name = c.name
      if (counted != null) { data.stock_qty = counted; data.ledger_seeded = true; ops.push(stocktakeOp(ex.id, counted, ex.prevStock)) }
      ops.push({ ref: doc(db, 'crystals', ex.id), data, merge: true })
      updated++
    } else {
      const ref = doc(COL())
      ops.push({ ref, data: {
        code: c.code, name: c.name, colour: c.colour, size: c.size, notes: '',
        stock_qty: counted, ledger_seeded: counted != null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, merge: false })
      if (counted != null) ops.push(stocktakeOp(ref.id, counted, 0))
      created++
    }
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + 400)) batch.set(op.ref, op.data, { merge: op.merge })
    await batch.commit()
  }
  return { created, updated }
}
