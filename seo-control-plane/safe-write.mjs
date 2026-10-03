// SEO control plane — Step 3, the write wrapper.
//
// No Workbench script writes WordPress except through safeWrite(). It
// snapshots the entity, applies the write, re-reads, and ABORTS (returns
// ok:false, does not continue the batch) if any field outside `expectedFields`
// changed — the guardrail for B52 (a variable-product save silently
// regenerated 32 variations with no prices, product went offline, found 8h
// later).
//
// `ok` and `verified` are two different questions and BOTH are returned:
//   ok       — "did anything change that I did not ask to change?" (no drift,
//              no write error). A no-op satisfies this trivially.
//   verified — "did the change I asked for actually happen?" False when
//              expectedFields were declared and NONE of them moved (`noop`).
// Callers MUST treat `verified:false` as a failure to report even when `ok` is
// true (2026-10-03: a payload-less item returned ok:true/verified:true having
// written nothing).
//
// Pure except for the two injected I/O functions, so it's testable:
//   get(id)              -> the full entity object (Workbench's wp-api.mjs GET)
//   put(endpoint, body)  -> applies the write (Workbench's wp-api.mjs PUT/POST)
//
// Usage:
//   import { safeWrite } from './safe-write.mjs'
//   const r = await safeWrite({
//     get: id => wpGet(`wc/v3/products/${id}?lang=en`),
//     put: (ep, b) => wpPut(ep, b),
//     id: 3194,
//     endpoint: `wc/v3/products/3194`,
//     payload: { meta: { _yoast_wpseo_title: '…' } },
//     expectedFields: ['meta._yoast_wpseo_title'],
//   })
//   if (!r.verified) { alert(r); STOP }   // r.drift lists what else moved;
//                                         // r.noop means nothing moved at all

// FNV-1a 32-bit — same fingerprint the OC seo-state page uses for layout.
export function hash32(str) {
  let h = 0x811c9dc5
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

// Fields always watched even if not in expectedFields — the ones whose
// silent change has actually caused an incident.
const SAFETY_FIELDS = [
  'status', 'slug', 'type', 'sku', 'price', 'regular_price', 'sale_price',
  'stock_status', 'stock_quantity', 'categories', 'date', 'featured_media',
]

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

// Reduce an entity to a comparable fingerprint of the fields we care about.
function fingerprint(entity, fields) {
  const fp = {}
  for (const f of fields) {
    let v = get(entity, f)
    if (f === 'meta._elementor_data' || /_elementor_data$/.test(f)) v = v == null ? null : hash32(v)
    else if (f === 'categories' && Array.isArray(v)) v = v.map(c => c.id ?? c).sort().join(',')
    else if (Array.isArray(v)) v = JSON.stringify(v)
    else if (v && typeof v === 'object') v = JSON.stringify(v)
    fp[f] = v ?? null
  }
  return fp
}

// Variable products: WooCommerce regenerates variations (new ids, no prices)
// on some saves. Snapshot every variation's id+price and require it unchanged
// unless the write was explicitly about variations/price/stock (B52).
function variationHash(entity) {
  if (entity?.type !== 'variable' || !Array.isArray(entity.variations)) return null
  // `variations` on the REST product is an array of ids; the price snapshot
  // has to come from the caller pre-expanding them. If it's ids-only we can
  // still catch id-set changes (regeneration always changes ids).
  if (entity.variations.every(v => typeof v === 'number')) return entity.variations.slice().sort().join(',')
  return entity.variations.map(v => `${v.id}:${v.price ?? ''}:${v.stock_status ?? ''}`).sort().join('|')
}

export async function safeWrite({ get: getFn, put: putFn, id, endpoint, payload, expectedFields = [], allowVariationChange = false }) {
  if (typeof getFn !== 'function' || typeof putFn !== 'function') {
    return { ok: false, error: 'safeWrite needs get() and put() functions' }
  }
  const watch = [...new Set([...expectedFields, ...SAFETY_FIELDS, 'meta._elementor_data'])]

  let before
  try { before = await getFn(id) } catch (e) { return { ok: false, error: `pre-read failed: ${e?.message || e}` } }
  if (!before || typeof before !== 'object') return { ok: false, error: 'pre-read returned no entity' }

  const beforeFp = fingerprint(before, watch)
  const beforeVarH = variationHash(before)

  let writeErr = null
  try { await putFn(endpoint, payload) } catch (e) { writeErr = e?.message || String(e) }

  let after
  try { after = await getFn(id) } catch (e) { return { ok: false, error: `post-read failed: ${e?.message || e}`, writeError: writeErr, before: beforeFp } }
  const afterFp = fingerprint(after, watch)
  const afterVarH = variationHash(after)

  // What changed that we did NOT ask to change?
  const expected = new Set(expectedFields.map(f => (/_elementor_data$/.test(f) ? 'meta._elementor_data' : f)))
  const drift = []
  for (const f of watch) {
    if (expected.has(f)) continue
    if (JSON.stringify(beforeFp[f]) !== JSON.stringify(afterFp[f])) {
      drift.push({ field: f, before: beforeFp[f], after: afterFp[f] })
    }
  }
  const variationDrift = beforeVarH !== afterVarH && !allowVariationChange
    && !expectedFields.some(f => /^(variations|price|regular_price|sale_price|stock)/.test(f))
  if (variationDrift) drift.push({ field: 'variations', before: '(hash) ' + beforeVarH?.slice(0, 60), after: '(hash) ' + afterVarH?.slice(0, 60), note: 'B52: variation id/price set changed' })

  const ok = !writeErr && drift.length === 0

  // A no-op is NOT a verified write (2026-10-03). `ok` above answers "did
  // anything change that I did not ask to change?"; it cannot answer "did the
  // change I asked for happen?" — and a no-op trivially satisfies it. If
  // expectedFields were declared and none of them moved, the write wrote
  // nothing: return ok:true / verified:false with noop:true, and callers MUST
  // treat that as a failure to report, not a success.
  //
  // When no expectedFields are declared there is no stated intent to check, so
  // `verified` stays equal to `ok` (never invent a no-op alarm).
  const intended = expectedFields.map(f => (/_elementor_data$/.test(f) ? 'meta._elementor_data' : f))
  const changed = intended.filter(f => JSON.stringify(beforeFp[f]) !== JSON.stringify(afterFp[f]))
  const noop = intended.length > 0 && changed.length === 0
  const verified = ok && !noop
  const noopErr = 'no-op: none of the expected fields changed'

  return {
    ok,
    verified,
    noop,
    error: writeErr || (noop ? noopErr : null) || (drift.length ? `unexpected drift in ${drift.length} field(s)` : null),
    drift,
    before: beforeFp,
    after: afterFp,
    // for the seo_batches `result`
    result: {
      ok,
      after: afterFp,
      verified,
      noop,
      error: writeErr
        || (noop ? noopErr : null)
        || (drift.length ? JSON.stringify(drift).slice(0, 400) : null),
    },
  }
}

export default safeWrite
