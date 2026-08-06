import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Purchase order numbering, matching JES's own series (`PU` + 2-digit year +
// 4-digit sequence) — same shape and same reasoning as soNumber.js's SO
// allocator, written after it. Unlike SO's rollout, there is no ongoing
// collision risk to manage here: JES was fully frozen 2026-08-05 (no more
// entry by CuiLing/Cindy/XiangXia — see JES-RETIREMENT-PLAN.md §0), so this
// is the sole source of new PU numbers from the day it ships, not a handoff
// mid-year.
//
// Seed measured 2026-08-06, the higher of the two series that had been
// running in parallel (JES until the freeze, the app's own free-text field
// before this file existed): erp_purchase max PU260047, app purchase_orders
// max PU260046. First allocation is therefore PU260048.
export const JES_SEED_BY_YEAR = {
  '26': 47,
}

export const puYear = (d = new Date()) => String(d.getFullYear() % 100).padStart(2, '0')
export const formatPuNo = (yy, n) => `PU${yy}${String(n).padStart(4, '0')}`

// Allocate the next PU number for the current year, atomically. Returns e.g.
// "PU260048". A Firestore transaction (not a manual increment) so two people
// creating a PO at once cannot receive the same number — same counters/
// collection soNumber.js already uses, own key so the two series never touch.
export async function allocatePuNo() {
  const yy = puYear()
  const seed = Number(JES_SEED_BY_YEAR[yy]) || 0
  const ref = doc(db, 'counters', `pu_${yy}`)

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const last = snap.exists() ? (Number(snap.data().last) || 0) : seed
    const next = last + 1
    tx.set(ref, { last: next, year: yy, kind: 'pu', updated_at: new Date().toISOString() }, { merge: true })
    return formatPuNo(yy, next)
  })
}
