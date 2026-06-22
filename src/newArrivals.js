// Catalogue Collections — Phase C0. "New In" is an explicit, admin-controlled tag
// (`is_new` on a product), NOT inferred from createdAt — because products are often
// (re)imported or retired, so a creation date is a poor signal of what's genuinely
// new to customers. Single source of truth so the badge, the sort and the later
// `new_in` smart collection never drift (spec §2/§5.1).

// True when an admin has tagged this product as a new arrival.
export function isNew(p) {
  return !!(p && p.is_new)
}

// Sort comparator: new-tagged products float to the front; everything else keeps
// its existing relative order (Array.prototype.sort is stable).
export function newFirst(a, b) {
  return (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0)
}
