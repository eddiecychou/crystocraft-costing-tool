// Shared source identity/copy lifecycle. No I/O or private actor/request data.
export const QUOTE_CONVERSION_FIELDS = [
  'converted_order_id',
  'order_conversion_version',
  'active_order_conversion_id',
  'latest_order_conversion_id',
  'legacy_converted_order_id'
]
export const conversionRevision = (quote) =>
  Number.isSafeInteger(quote?.order_conversion_version) &&
  quote.order_conversion_version >= 0
    ? quote.order_conversion_version
    : 0
export const validConversionId = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v)

// Firestore maps have no key order. Timestamps must agree across Admin/Web SDKs.
export function canonicalConversionValue(v) {
  if (v === undefined) return ['undefined']
  if (v === null) return ['null']
  if (typeof v === 'number') return ['number', Number.isFinite(v) ? v : String(v)]
  if (typeof v !== 'object') return [typeof v, v]
  if (v instanceof Date) return ['date', v.toISOString()]
  if (typeof v.toDate === 'function' && Number.isInteger(v.seconds))
    return ['timestamp', v.seconds, v.nanoseconds]
  if (
    typeof v.path === 'string' &&
    (typeof v.isEqual === 'function' || typeof v.withConverter === 'function')
  )
    return ['reference', v.path]
  if (
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    typeof v.isEqual === 'function'
  )
    return ['geopoint', v.latitude, v.longitude]
  if (typeof v.toUint8Array === 'function') return ['bytes', Array.from(v.toUint8Array())]
  if (v instanceof Uint8Array) return ['bytes', Array.from(v)]
  if (Array.isArray(v)) return ['array', v.map(canonicalConversionValue)]
  return [
    'map',
    Object.keys(v)
      .sort()
      .map((k) => [k, canonicalConversionValue(v[k])])
  ]
}
export const conversionCanonical = (v) => JSON.stringify(canonicalConversionValue(v))
export function quoteSourceCanonical(quote, items) {
  const ignored = new Set([...QUOTE_CONVERSION_FIELDS, 'id', 'createdAt', 'updatedAt'])
  const header = Object.fromEntries(
    Object.entries(quote || {}).filter(([k]) => !ignored.has(k))
  )
  return conversionCanonical({
    header,
    items: [...(items || [])].sort((a, b) =>
      String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
    )
  })
}
export async function quoteSourceToken(quote, items) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(quoteSourceCanonical(quote, items))
  )
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
export function duplicateQuoteFields(quote) {
  const omitted = new Set(['id', ...QUOTE_CONVERSION_FIELDS])
  return Object.fromEntries(Object.entries(quote || {}).filter(([k]) => !omitted.has(k)))
}
