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

// The ledger now tracks TWO balances per item: on-hand (physically in stock) and
// reserved (allocated to confirmed orders, sitting on the production line but not
// yet consumed). available = on-hand − reserved (R1, reserve→production-in).
//
// Manual-panel movement types (on-hand only). Reserve/release/produce below are
// order-driven and not offered in the manual panel.
export const MOVEMENT_TYPES = [
  { value: 'receipt',    label: 'Receipt',    sign: +1, note: 'Goods received / PU delivery' },
  { value: 'issue',      label: 'Issue',      sign: -1, note: 'Consumed directly (no reservation)' },
  { value: 'adjustment', label: 'Adjustment', sign:  0, note: 'Manual correction (± signed)' },
  { value: 'stocktake',  label: 'Stock-take', sign:  0, note: 'Set the counted absolute quantity' },
]
export const movementTypeOf = v => MOVEMENT_TYPES.find(t => t.value === v) || MOVEMENT_TYPES[0]

// Every valid movement type (manual + order-driven). Order-driven:
//   reserve  — allocate to an order (reserved +q; on-hand unchanged)
//   release  — un-reserve (reserved −q)
//   produce  — production-in: consume the reservation (on-hand −q AND reserved −q)
const VALID_TYPES = new Set(['receipt', 'issue', 'adjustment', 'stocktake', 'reserve', 'release', 'produce'])

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const today = () => new Date().toISOString().slice(0, 10)

// How a movement changes the two balances. Pure — the single source of truth so
// the transaction and any preview UI agree. `base` = { onHand, reserved }.
//   receipt/issue/adjustment/stocktake : on-hand only (reserved unchanged)
//   reserve  : reserved +|q|            release : reserved −|q|
//   produce  : on-hand −|q|, reserved −|q|
export function movementEffect({ type, qty, counted }, base) {
  const onHand = num(base?.onHand)
  const q = num(qty)
  switch (type) {
    case 'stocktake':  return { onHandDelta: num(counted) - onHand, reservedDelta: 0 }
    case 'adjustment': return { onHandDelta: q, reservedDelta: 0 }
    case 'issue':      return { onHandDelta: -Math.abs(q), reservedDelta: 0 }
    case 'reserve':    return { onHandDelta: 0, reservedDelta: Math.abs(q) }
    case 'release':    return { onHandDelta: 0, reservedDelta: -Math.abs(q) }
    case 'produce':    return { onHandDelta: -Math.abs(q), reservedDelta: -Math.abs(q) }
    default:           return { onHandDelta: Math.abs(q), reservedDelta: 0 }   // receipt
  }
}

// On-hand delta only — kept for the manual ledger panel's live preview, which
// only offers the on-hand movement types.
export function movementDelta(mov, currentBalance) {
  return movementEffect(mov, { onHand: num(currentBalance) }).onHandDelta
}

// Post one movement atomically: read the cached balance, seed the opening
// balance on first use, apply the delta, write the movement (with its
// balance_after), and update the component's cached stock_qty — all in one
// transaction so concurrent edits can't corrupt the running balance.
//
// postMovement(colPath, id, opts)
// opts: { type, qty?, counted?, date?, note?, order_id?, idempotencyKey? }
// Returns the new balance.
//
// Two reliability fixes here (bug-fix pack B-03, 2026-08-17):
//
// 1. seq used to be `Date.now()` — two movements posted within the same
//    millisecond (a real risk for a tight import loop, or two people acting
//    at once) tied, and orderBy('seq') then fell back to Firestore's
//    document-id ordering, which has no relationship to actual write order.
//    seq is now a per-item counter (comp.movement_seq), incremented inside
//    THIS transaction — Firestore transactions retry on conflicting reads,
//    so two concurrent postMovement calls on the same item can never both
//    claim the same seq the way two Date.now() calls could tie.
//
// 2. opts.idempotencyKey: when a caller can be retried after a partial
//    failure (order stock issue, PO receipt, a batch import row), passing a
//    stable key here makes the movement doc ID deterministic instead of
//    random. A retry that lands after the original already committed finds
//    the same doc already exists and returns the current balance WITHOUT
//    posting a second movement — the exact double-post a naive retry used to
//    produce. Callers that don't retry (the manual ledger panel) can omit it
//    and keep getting a random id, unchanged from before.
export async function postMovement(colPath, id, opts) {
  const compRef = doc(db, colPath, id)
  const type = VALID_TYPES.has(opts.type) ? opts.type : 'receipt'
  const key = (opts.idempotencyKey || '').trim()

  return runTransaction(db, async tx => {
    // Firestore transactions require every read before any write — the
    // idempotency check has to happen up front, alongside the balance read.
    const movRef = key ? doc(MOVEMENTS(colPath, id), key) : doc(MOVEMENTS(colPath, id))
    const [snap, existingMov] = await Promise.all([
      tx.get(compRef),
      key ? tx.get(movRef) : Promise.resolve(null),
    ])
    if (!snap.exists()) throw new Error('Item not found')
    const comp = snap.data()
    const onHand = Number.isFinite(comp.stock_qty) ? comp.stock_qty : 0
    const reserved = Number.isFinite(comp.reserved_qty) ? comp.reserved_qty : 0

    if (existingMov?.exists()) {
      // Already posted — a retry of the same logical operation, not a new one.
      return { onHand, reserved, deduped: true }
    }

    let seq = Number.isFinite(comp.movement_seq) ? comp.movement_seq : 0

    // Seed the opening on-hand balance once: any stock that existed before the
    // ledger becomes an explicit opening stock-take so the history is complete.
    if (!comp.ledger_seeded && onHand !== 0) {
      const openRef = doc(MOVEMENTS(colPath, id))
      seq += 1
      tx.set(openRef, {
        type: 'stocktake', qty: onHand, counted: onHand, balance_after: onHand, reserved_after: reserved,
        date: today(), note: 'Opening balance (migrated from stock)',
        seq, createdAt: serverTimestamp(),
      })
    }

    const { onHandDelta, reservedDelta } = movementEffect({ type, qty: opts.qty, counted: opts.counted }, { onHand, reserved })
    const balance_after = onHand + onHandDelta
    const reserved_after = reserved + reservedDelta

    seq += 1
    tx.set(movRef, {
      type,
      qty: onHandDelta,
      reserved_qty: reservedDelta,
      counted: type === 'stocktake' ? num(opts.counted) : null,
      balance_after,
      reserved_after,
      date: opts.date || today(),
      note: (opts.note || '').trim(),
      order_id: opts.order_id || null,
      seq, createdAt: serverTimestamp(),
    })

    tx.update(compRef, { stock_qty: balance_after, reserved_qty: reserved_after, ledger_seeded: true, movement_seq: seq, updatedAt: serverTimestamp() })
    return { onHand: balance_after, reserved: reserved_after, deduped: false }
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
