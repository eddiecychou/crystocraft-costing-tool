import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, setDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

// Packaging inventory (V7.13a packaging). Third inventory class alongside metal
// range_components and crystals. Packaging SKUs (gift boxes, master cartons,
// inserts, ribbons — each an ERP code) are stocked and consumed BATCH-per-order
// at pack time; like crystals there is no per-product BOM (see
// Inventory_Roadmap_V7.13_Spec.md §3). Reuses the collection-agnostic stock
// ledger (stockLedger.js) under packaging/{id}/movements.
//
//   packaging/{id}  { code, name, type, size, stock_qty (cached), ledger_seeded, notes }

const COL = () => collection(db, 'packaging')
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

export const normPackaging = c => ({
  code: (c.code || '').trim().toUpperCase(),
  name: (c.name || '').trim(),
  type: (c.type || '').trim(),
  size: (c.size || '').trim(),
  notes: (c.notes || '').trim(),
  stock_qty: num(c.stock_qty),
})

const fromDoc = d => ({ id: d.id, ...d.data(), ...normPackaging(d.data()) })

export async function loadPackaging() {
  try {
    const snap = await getDocs(query(COL(), orderBy('code')))
    return snap.docs.map(fromDoc)
  } catch { return [] }
}

export function usePackaging() {
  const [packaging, setPackaging] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(COL(), orderBy('code'))
    return onSnapshot(q,
      snap => { setPackaging(snap.docs.map(fromDoc)); setLoading(false) },
      () => { setPackaging([]); setLoading(false) },
    )
  }, [])
  return { packaging, loading }
}

// Descriptive fields only — stock_qty is owned by the ledger (never written here).
const descriptorOf = c => {
  const n = normPackaging(c)
  return { code: n.code, name: n.name, type: n.type, size: n.size, notes: n.notes }
}

export async function savePackaging(id, data) {
  const payload = { ...descriptorOf(data), updatedAt: serverTimestamp() }
  if (id) { await setDoc(doc(db, 'packaging', id), payload, { merge: true }); return id }
  const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
  return ref.id
}

export async function deletePackaging(id) {
  await deleteDoc(doc(db, 'packaging', id))
}

// Idempotent stock-import: upsert packaging SKUs by code and mirror every
// absolute count into the ledger as a stocktake movement. Rows:
//   [{ code, name, type, size, stock_qty }]
export async function importPackagingStock(rows) {
  const norm = s => (s == null ? '' : String(s)).trim().toUpperCase()
  const clean = (rows || []).map(r => ({
    code: norm(r.code), name: (r.name || '').trim(), type: (r.type || '').trim(),
    size: (r.size || '').trim(), stock_qty: num(r.stock_qty),
  })).filter(r => r.code)
  if (!clean.length) return { created: 0, updated: 0 }

  const byCode = {}
  for (const r of clean) {
    const c = byCode[r.code] || (byCode[r.code] = { code: r.code, name: '', type: '', size: '', stock_qty: null })
    if (r.name) c.name = r.name
    if (r.type) c.type = r.type
    if (r.size) c.size = r.size
    if (r.stock_qty != null) c.stock_qty = r.stock_qty
  }

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
    ref: doc(collection(db, 'packaging', id, 'movements')),
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
      const data = { type: c.type, size: c.size, updatedAt: serverTimestamp() }
      if (!ex.hasName && c.name) data.name = c.name
      if (counted != null) { data.stock_qty = counted; data.ledger_seeded = true; ops.push(stocktakeOp(ex.id, counted, ex.prevStock)) }
      ops.push({ ref: doc(db, 'packaging', ex.id), data, merge: true })
      updated++
    } else {
      const ref = doc(COL())
      ops.push({ ref, data: {
        code: c.code, name: c.name, type: c.type, size: c.size, notes: '',
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
