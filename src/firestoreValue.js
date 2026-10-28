// Map key order can differ between cached and transactional Firestore reads.
// Array order, field presence, types and every stored value still matter.
export function sameFirestoreValue(a, b) {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => sameFirestoreValue(value, b[index]))
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (typeof a.isEqual === 'function' && typeof b.isEqual === 'function') return a.isEqual(b)
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length
    && keys.every(key => Object.hasOwn(b, key) && sameFirestoreValue(a[key], b[key]))
}
