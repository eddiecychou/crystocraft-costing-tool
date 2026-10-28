// Shared with quote attachment concurrency checks; keep the existing API.
export { sameFirestoreValue as sameReviewValue } from '../firestoreValue.js'

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
