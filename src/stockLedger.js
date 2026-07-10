import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, onSnapshot, query, orderBy,
  serverTimestamp, runTransaction,
} from 'firebase/firestore'
import { db } from './firebase'

// Stock ledger (V7.13a) — the append-only movement log behind an item's on-hand.
// This is the foundation the whole inventory roadmap sits on: on-hand is a
// DERIVED running balance over these movements, never a mutable number
// decremented in place (see Inventory_Roadmap_V7.13_Spec.md §2).
//
//   {collectionPath}/{id}/movements/{movId}
//
// The engine is collection-AGNOSTIC: `range_components` (metal) and `crystals`
// both use it, and packaging will too. Callers pass the parent collection path.
//
// For speed, the latest balance is also cached on the item doc as `stock_qty`
// (updated inside the same transaction as every movement), so MRP, buildable and
// the lists keep reading one field — but that number is now only ever a mirror
// of the ledger, never authored directly. The one-time opening balance
// (pre-existing stock_qty) is seeded lazily via a `ledger_seeded` flag the first
// time a movement is posted, so no separate migration run is needed.

const MOVEMENTS = (colPath, id) => collection(db, colPath, id, 'movements')

// Movement types. `qty` on a stored movement is always the SIGNED change to the
// balance (receipt +, issue −); `adjustment` is a free signed correction;
// `stocktake` sets an absolute counted value (its qty is the delta to reach it).
export const MOVEMENT_TYPES = [
  { value: 'receipt',    label: 'Receipt',    sign: +1, note: 'Goods received / PU delivery' },
  { value: 'issue',      label: 'Issue',      sign: -1, note: 'Consumed by an order / production' },
  { value: 'adjustment', label: 'Adjustment', sign:  0, note: 'Manual correction (± signed)' },
  { value: 'stocktake',  label: 'Stock-take', sign:  0, note: 'Set the counted absolute quantity' },
]
export const movementTypeOf = v => MOVEMENT_TYPES.find(t => t.value === v) || MOVEMENT_TYPES[0]

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const today = () => new Date().toISOString().slice(0, 10)

// Compute the signed delta a request applies to a current balance. Pure — the
// single source of truth for how each movement type moves the balance, so the
// transaction and any preview UI agree.
//   receipt / issue : qty is a magnitude; sign comes from the type.
//   adjustment      : qty is already signed.
//   stocktake       : counted is the new absolute; delta = counted − current.
export function movementDelta({ type, qty, counted }, currentBalance) {
  const cur = num(currentBalance)
  if (type === 'stocktake') return num(counted) - cur
  if (type === 'adjustment') return num(qty)
  if (type === 'issue') return -Math.abs(num(qty))
  return Math.abs(num(qty))   // receipt (default)
}

// Post one movement atomically: read the cached balance, seed the opening
// balance on first use, apply the delta, write the movement (with its
// balance_after), and update the component's cached stock_qty — all in one
// transaction so concurrent edits can't corrupt the running balance.
//
// postMovement(colPath, id, opts)
// opts: { type, qty?, counted?, date?, note?, order_id? }
// Returns the new balance.
export async function postMovement(colPath, id, opts) {
  const compRef = doc(db, colPath, id)
  const type = movementTypeOf(opts.type).value

  return runTransaction(db, async tx => {
    const snap = await tx.get(compRef)
    if (!snap.exists()) throw new Error('Item not found')
    const comp = snap.data()
    let base = Number.isFinite(comp.stock_qty) ? comp.stock_qty : 0

    // Seed the opening balance once: any stock that existed before the ledger
    // becomes an explicit opening stock-take so the history is complete.
    if (!comp.ledger_seeded && base !== 0) {
      const openRef = doc(MOVEMENTS(colPath, id))
      tx.set(openRef, {
        type: 'stocktake', qty: base, counted: base, balance_after: base,
        date: today(), note: 'Opening balance (migrated from stock)',
        seq: Date.now() - 1, createdAt: serverTimestamp(),
      })
    }

    const delta = movementDelta({ type, qty: opts.qty, counted: opts.counted }, base)
    const balance_after = base + delta

    const movRef = doc(MOVEMENTS(colPath, id))
    tx.set(movRef, {
      type,
      qty: delta,
      counted: type === 'stocktake' ? num(opts.counted) : null,
      balance_after,
      date: opts.date || today(),
      note: (opts.note || '').trim(),
      order_id: opts.order_id || null,
      seq: Date.now(),
      createdAt: serverTimestamp(),
    })

    tx.update(compRef, { stock_qty: balance_after, ledger_seeded: true, updatedAt: serverTimestamp() })
    return balance_after
  })
}

// One-shot load (oldest → newest) for exports / non-reactive callers.
export async function loadMovements(colPath, id) {
  const snap = await getDocs(query(MOVEMENTS(colPath, id), orderBy('seq', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Live movements for an item, newest first (for the ledger panel).
export function useMovements(colPath, id) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!colPath || !id) { setMovements([]); setLoading(false); return }
    setLoading(true)
    const q = query(MOVEMENTS(colPath, id), orderBy('seq', 'desc'))
    return onSnapshot(q,
      snap => { setMovements(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      () => { setMovements([]); setLoading(false) },
    )
  }, [colPath, id])
  return { movements, loading }
}
