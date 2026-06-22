// Catalogue Collections — Phase C0. Single source of truth for "what counts as
// New In", shared by the badge, the newest-first sort, and (later) the `new_in`
// smart collection so the three never drift (spec §2/§5.1).

export const NEW_WITHIN_DAYS = 45

// Firestore Timestamp | {seconds} | Date | ISO string | null → epoch ms (0 = unknown).
export function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const t = new Date(ts).getTime()
  return Number.isFinite(t) ? t : 0
}

// True when createdAt is within the window. Unknown dates are never "new".
export function isNewArrival(createdAt, days = NEW_WITHIN_DAYS) {
  const ms = toMillis(createdAt)
  return ms > 0 && Date.now() - ms <= days * 86_400_000
}

// Sort comparator: newest first, items with no createdAt sort last (stable).
export function byNewest(a, b) {
  return toMillis(b?.createdAt) - toMillis(a?.createdAt)
}
