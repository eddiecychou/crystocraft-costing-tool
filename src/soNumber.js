import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Sales Order numbering, matching JES's own series so the app can originate an
// order rather than only parse one JES produced.
//
// Measured against the live ERP (2026-07-20): the series is `SO` + 2-digit year
// + 4-digit sequence, it RESETS each year, and it is gapless —
// SO260001..SO260027 with no holes; SO25 ran to 42, SO24 to 101.
//
// Allocation is a Firestore transaction rather than a Postgres sequence (which
// is how UC# works). Deliberate: orders live in Firestore, so the counter lives
// beside them and needs no new SQL object or edge-function endpoint. UC# stays
// in Supabase because the registry does.
//
// CUTOVER DONE (CuiLing, 2026-07-23): new SO and SI numbers are raised in the
// app only; old JES orders may still be edited but no new ones are added there.
// So the app is now the sole source of new SO numbers for 2026 and the
// collision below no longer applies — SO is auto-allocated on order creation
// (ShipmentForm handleCreate).
//
// ⚠️ COLLISION RISK — the reason this was manual until 2026-07-23, kept for the
// record and because it returns the moment a NEW year starts before JES is
// confirmed stopped for it. This allocates into the SAME series JES uses. If
// both systems hand out numbers independently they WILL collide: JES has no
// idea the app took SO260028. Per year this has to be a clean switch, not an
// overlap — re-confirm JES has stopped for each new year before trusting the
// seed, exactly the rule that applies to the UC registry.

// Seeds are JES's last number for that year, verified against raw.salesorder.
// The counter is created on first allocation from the seed, so the first number
// the app issues is seed + 1. Re-verify before a cutover: if JES has issued more
// since, the seed is stale and the first allocation collides.
export const JES_SEED_BY_YEAR = {
  '26': 27,   // JES max SO260027, verified 2026-07-20
  '25': 42,   // JES max SO250042
}

// Sales Invoice numbering: same shape, own counter. Measured 2026-07-20 —
// SI26 max SI260093 over 92 rows, SI25 144, SI24 276.
//
// NOTE the difference from SO: the SI series has a GAP (SI260072 is missing),
// where SO260001..27 is unbroken. So do not "verify" an SI counter by assuming
// contiguity — a hole is normal here and usually means a voided invoice. Voids
// are recorded in JES as sistatus VOID (90 of them), not by reusing the number.
// ⚠️ NO LONGER USED FOR ALLOCATION as of 2026-07-21.
//
// Invoice numbers are now issued by public.allocate_sales_invoice in Postgres,
// which derives the next number from the greater of what the app has issued
// and what the mirror shows JES issued. There is no seed to maintain, and no
// way for staleness to reuse a number — which is exactly what happened here:
// this table read 93 while CuiLing had already issued SI260094.
//
// Kept because erp-sync/check_doc_seeds.py still parses it, and because the
// values record what JES's series looked like at cutover. Do NOT wire it back
// into allocation.
export const JES_SI_SEED_BY_YEAR = {
  '26': 94,   // JES max SI260094, re-verified 2026-07-21 after the first
              // incremental sync. Was 93: CuiLing raised SI260094 on 21 Jul
              // and the mirror had not seen it when the seed was first set,
              // so the app's first invoice would have reused her number.
  '25': 145,  // was 144 — that was a row count, not a max. The SI series has
              // gaps (voids), so counting rows understates it. Not in the
              // allocation path; corrected for the record.
}

export const soYear = (d = new Date()) => String(d.getFullYear() % 100).padStart(2, '0')

export const formatSoNo = (yy, n) => `SO${yy}${String(n).padStart(4, '0')}`
export const formatSiNo = (yy, n) => `SI${yy}${String(n).padStart(4, '0')}`

// Allocate the next SO number for the current year, atomically.
// Returns e.g. "SO260028". The transaction makes concurrent allocation safe —
// two people creating an order at once cannot receive the same number.
export async function allocateSoNo() {
  return allocate('so', JES_SEED_BY_YEAR, formatSoNo)
}

// ⚠️ DEPRECATED, and deliberately left unwired. Use allocateInvoice() in
// ucRegistry.js instead: it issues the number and its UC in ONE Postgres
// transaction, so the two can never disagree, and derives the number from the
// data rather than the seed above.
//
// Not deleted, because the Firestore counter it reads (counters/si_<yy>) still
// exists and this is the only code that documents what it was for.
export async function allocateSiNo() {
  return allocate('si', JES_SI_SEED_BY_YEAR, formatSiNo)
}

async function allocate(kind, seeds, format) {
  const yy = soYear()
  const seed = Number(seeds[yy]) || 0
  const ref = doc(db, 'counters', `${kind}_${yy}`)

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    // First allocation of the year starts from JES's last number, not from 0 —
    // starting at 1 would re-issue numbers JES has already used.
    const last = snap.exists() ? (Number(snap.data().last) || 0) : seed
    const next = last + 1
    tx.set(ref, { last: next, year: yy, kind, updated_at: new Date().toISOString() }, { merge: true })
    return format(yy, next)
  })
}
