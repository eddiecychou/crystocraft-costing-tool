// Firestore maps are unordered. Never use their JSON serialization as a
// concurrency token: listener and transaction reads can enumerate keys differently.
// Preserve array order and compare every value, including decisions/receipts.
export function sameReviewValue(a, b) {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => sameReviewValue(value, b[index]))
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (typeof a.isEqual === 'function' && typeof b.isEqual === 'function') return a.isEqual(b)
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length
    && keys.every(key => Object.hasOwn(b, key) && sameReviewValue(a[key], b[key]))
}

// Reviewed snapshots may be flat dotted fields, WP nested meta or Woo meta_data.
// Do not render a valid flat baseline as an empty value in the human approval diff.
export function reviewFieldValue(entity, path) {
  let value
  if (Object.hasOwn(entity || {}, path)) value = entity[path]
  else if (path.startsWith('meta.')) {
    const key = path.slice(5)
    value = entity?.meta?.[key]
    if (value === undefined) value = entity?.meta_data?.find(item => item.key === key)?.value
  }
  if (['content', 'excerpt', 'title'].includes(path) && value && typeof value === 'object' && Object.hasOwn(value, 'raw')) return value.raw
  return value
}
