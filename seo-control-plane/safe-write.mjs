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
//              expectedFields were declared and NONE of them moved (`noop`), OR
//              when a field the payload asked to change did not (`unlanded`).
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

// Read a dotted path. `meta.<key>` resolves from EITHER shape, because
// WooCommerce carries meta as a LIST — `meta_data: [{ key, value }]` — on the
// write body and on the read-back alike. Reading only the nested object made
// `meta._elementor_data` `undefined` on both sides of a product write, so a
// correct change fingerprinted as though nothing had happened (2026-10-03).
//
// Note `meta_data` itself is deliberately NOT in SAFETY_FIELDS: WooCommerce
// echoes the whole list back (ids, ordering, unrelated keys), so watching it
// wholesale would trip on noise. `meta._elementor_data` IS always watched, and
// this is what makes that watch work for a product.
function get(obj, path) {
  const direct = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  if (direct !== undefined) return direct
  const m = /^meta\.(.+)$/.exec(path)
  if (m && Array.isArray(obj?.meta_data)) {
    const hit = obj.meta_data.find(x => x && x.key === m[1])
    if (hit) return hit.value
  }
  return direct
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
  // Declaring WooCommerce's whole `meta_data` list covers the Elementor tree
  // inside it — otherwise the always-on `meta._elementor_data` watch reports the
  // change the caller just declared as drift.
  if (expected.has('meta_data')) expected.add('meta._elementor_data')
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

  // Verification is PER FIELD, not per item (2026-10-03). `ok` above answers "did
  // anything change that I did not ask to change?"; it cannot answer "did the
  // change I asked for happen?" — and a no-op trivially satisfies it. But "at
  // least ONE expected field moved" is still not that question: a payload where
  // `description` lands and `meta._elementor_data` silently does not reported
  // verified:true, and four product fixes were called clean while their Elementor
  // trees were untouched.
  //
  // A field is REQUESTED when the payload actually supplies a value for it that
  // differs from `before`. An absent payload value, or one already equal to
  // `before`, asks for nothing and is not held against the write — so
  // over-declaring expectedFields stays safe (it is a permission list), and an
  // idempotent write is not a false alarm.
  //
  //   asked     — the payload asks for a change
  //   landed    — the value differs after the write
  //   unlanded  — asked but did not land  -> the write silently did not happen
  //   noop      — declared fields, and nothing moved at all
  //
  // When no expectedFields are declared there is no stated intent to check, so
  // `verified` stays equal to `ok` (never invent a no-op alarm).
  const payFp = fingerprint(payload, watch)
  const intended = expectedFields.map(f => (/_elementor_data$/.test(f) ? 'meta._elementor_data' : f))
  const moved = (f) => JSON.stringify(beforeFp[f]) !== JSON.stringify(afterFp[f])
  const asked = intended.filter(f => get(payload, f) !== undefined && JSON.stringify(payFp[f]) !== JSON.stringify(beforeFp[f]))
  const landed = intended.filter(moved)
  const unlanded = asked.filter(f => !moved(f))
  const noop = intended.length > 0 && landed.length === 0
  const verified = ok && !noop && unlanded.length === 0
  const noopErr = 'no-op: none of the expected fields changed'
  const unlandedErr = `requested change did not land in: ${unlanded.join(', ')}`

  return {
    ok,
    verified,
    noop,
    unlanded,
    error: writeErr
      || (drift.length ? `unexpected drift in ${drift.length} field(s)` : null)
      || (noop ? noopErr : null)
      || (unlanded.length ? unlandedErr : null),
    drift,
    before: beforeFp,
    after: afterFp,
    // for the seo_batches `result`
    result: {
      ok,
      after: afterFp,
      verified,
      noop,
      unlanded,
      error: writeErr
        || (drift.length ? JSON.stringify(drift).slice(0, 400) : null)
        || (noop ? noopErr : null)
        || (unlanded.length ? unlandedErr : null),
    },
  }
}

export default safeWrite
