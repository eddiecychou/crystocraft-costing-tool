import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Sales Return numbering — `SR` + 2-digit year + 4-digit sequence, same shape
// as soNumber.js / puNumber.js. Unlike those, there is no JES predecessor to
// seed from: Sales Returns are an app-only series (JES never had one), so the
// counter starts at 0 every year rather than carrying a seed table.

export const srYear = (d = new Date()) => String(d.getFullYear() % 100).padStart(2, '0')
export const formatSrNo = (yy, n) => `SR${yy}${String(n).padStart(4, '0')}`

// Allocate the next SR number for the current year, atomically. A Firestore
// transaction so two people creating a return at once cannot receive the same
// number — same counters/ collection soNumber.js and puNumber.js use, own key.
export async function allocateSrNo() {
  const yy = srYear()
  const ref = doc(db, 'counters', `sr_${yy}`)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const last = snap.exists() ? (Number(snap.data().last) || 0) : 0
    const next = last + 1
    tx.set(ref, { last: next, year: yy, kind: 'sr', updated_at: new Date().toISOString() }, { merge: true })
    return formatSrNo(yy, next)
  })
}
