// node seo-control-plane/safe-write.test.mjs
//
// Covers the two questions safeWrite answers, which are NOT the same question:
//   ok       — no unintended drift (the B52 guard)
//   verified — the intended change actually happened (2026-10-03 no-op defect)
import { safeWrite } from './safe-write.mjs'

let pass = 0, fail = 0
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

function mkEntity(extra = {}) {
  return {
    id: 3194, type: 'simple', status: 'publish', slug: 'crystal-rose',
    sku: 'D0268', price: '120.00', name: 'D0268 Crystal Rose',
    meta: { _yoast_wpseo_title: 'Old title', _elementor_data: 'OLD' },
    ...extra,
  }
}

// A fake WP: an in-memory entity, and a `put` that returns what WordPress
// would store. Deep-copied on read so a caller can't mutate the store.
function harness(entity, applyPut) {
  let cur = JSON.parse(JSON.stringify(entity))
  return {
    get: async () => JSON.parse(JSON.stringify(cur)),
    put: async (endpoint, body) => { cur = applyPut(cur, body); return { ok: true } },
    current: () => cur,
  }
}

// ── a clean write whose expected field does change ──────────────────────
{
  const h = harness(mkEntity(), (cur, b) => ({ ...cur, meta: { ...cur.meta, _yoast_wpseo_title: b.meta._yoast_wpseo_title } }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { meta: { _yoast_wpseo_title: 'Figura de Rosa - Crystocraft' } },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('clean write: ok', r.ok === true, JSON.stringify(r.drift))
  expect('clean write: verified', r.verified === true)
  expect('clean write: noop false', r.noop === false)
  expect('clean write: result shape', r.result.ok === true && r.result.verified === true && r.result.noop === false && r.result.error === null,
    JSON.stringify(r.result))
  expect('clean write: after fingerprint present', r.after['meta._yoast_wpseo_title'] === 'Figura de Rosa - Crystocraft')
}

// ── 2026-10-03: a write that changes nothing is NOT verified ────────────
// This is the defect shape: a payload-less item made safeWrite return
// ok:true/verified:true while writing nothing, and the batch went `executed`.
{
  const h = harness(mkEntity(), (cur) => cur) // the PUT stores nothing new
  const r = await safeWrite({
    get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { meta: { _yoast_wpseo_title: 'Same title' } },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('no-op: failed despite no unintended drift', r.ok === false && r.drift.length === 0)
  expect('no-op: verified is false', r.verified === false)
  expect('no-op: noop is true', r.noop === true)
  expect('no-op: result carries verified:false + noop:true', r.result.verified === false && r.result.noop === true)
  expect('no-op: error names unlanded field', /did not land/.test(r.result.error || ''), String(r.result.error))
  expect('no-op: top-level error names unlanded field', /did not land/.test(r.error || ''), String(r.error))
}

// ── no stated intent (no expectedFields) must never invent a no-op ──────
{
  const h = harness(mkEntity(), (cur) => ({ ...cur, name: 'Wrong replacement' }))
  const r = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { name: 'Requested replacement' }, expectedFields: ['name'] })
  expect('moved to a different value is not verified', r.ok === false && r.verified === false && r.unlanded.includes('name'), JSON.stringify(r.result))
}
{
  const h = harness(mkEntity(), (cur) => ({ ...cur, name: '' }))
  const r = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { name: 'Populated title' }, expectedFields: ['name'] })
  expect('empty after a populated request fails', r.ok === false && r.unlanded.includes('name'), JSON.stringify(r.result))
}
{
  const h = harness(mkEntity(), (cur) => ({ ...cur, name: 'Corrupted despite same-value request' }))
  const r = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { name: 'D0268 Crystal Rose' }, expectedFields: ['name'] })
  expect('same-value request that mutates to wrong value fails exact read-back',
    r.ok === false && r.unlanded.includes('name'), JSON.stringify(r.result))
}
{
  const h = harness(mkEntity(), (cur, b) => ({ ...cur, meta: { ...cur.meta, ...b.meta } }))
  const absent = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wp/v2/posts/3194',
    payload: { meta: { _yoast_wpseo_title: 'New title' } }, expectedFields: ['meta._yoast_wpseo_title'] })
  expect('Yoast write without invalidator is blocked before PUT', absent.ok === false && /requires invalidate/.test(absent.error))
  expect('missing invalidator returns reportable batch result', absent.result?.ok === false && absent.result?.verified === false)
  let invalidations = 0
  const r = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wp/v2/posts/3194',
    payload: { meta: { _yoast_wpseo_title: 'New title' } }, expectedFields: ['meta._yoast_wpseo_title'],
    invalidateYoastIndexable: async ({ id }) => { invalidations++; return id === 3194 },
  })
  expect('Yoast invalidator runs after meta lands', r.verified === true && invalidations === 1, JSON.stringify(r.result))
  const failed = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'wp/v2/posts/3194',
    payload: { meta: { _yoast_wpseo_title: 'Another title' } }, expectedFields: ['meta._yoast_wpseo_title'],
    invalidateYoastIndexable: async () => false,
  })
  expect('unconfirmed Yoast deletion is failure', failed.ok === false && /invalidation failed/.test(failed.error), JSON.stringify(failed.result))
}

// ── no stated intent (no expectedFields) must never invent a no-op ──────
{
  const h = harness(mkEntity(), (cur) => cur)
  const r = await safeWrite({ get: h.get, put: h.put, id: 3194, endpoint: 'x', payload: {}, expectedFields: [] })
  expect('no expectedFields: verified falls back to ok', r.verified === true && r.noop === false,
    `verified=${r.verified} noop=${r.noop}`)
}

// ── drift is still caught, and still fails the write ────────────────────
{
  const h = harness(mkEntity(), (cur, b) => ({
    ...cur,
    status: 'draft', // nobody asked for this
    meta: { ...cur.meta, _yoast_wpseo_title: b.meta._yoast_wpseo_title },
  }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { meta: { _yoast_wpseo_title: 'New' } },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('drift: ok false', r.ok === false)
  expect('drift: verified false', r.verified === false)
  expect('drift: noop false (something DID move)', r.noop === false)
  expect('drift: names the drifted field', r.drift.some(d => d.field === 'status'), JSON.stringify(r.drift))
  expect('drift: result.error quotes the drift', /status/.test(r.result.error || ''), String(r.result.error))
}

// ── a write that throws ─────────────────────────────────────────────────
{
  const h = harness(mkEntity(), (cur) => cur)
  const r = await safeWrite({
    get: h.get, put: async () => { throw new Error('403 forbidden') },
    id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { meta: { _yoast_wpseo_title: 'New' } },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('write error: ok false', r.ok === false)
  expect('write error: verified false', r.verified === false)
  expect('write error: message surfaced', /403/.test(r.error || ''), String(r.error))
}

// ── an Elementor-only edit still verifies (its hash moved) ──────────────
{
  const h = harness(mkEntity(), (cur, b) => ({ ...cur, meta: { ...cur.meta, _elementor_data: b.meta._elementor_data } }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 3194, endpoint: 'wp/v2/pages/3194',
    payload: { meta: { _elementor_data: 'NEW' } },
    expectedFields: ['meta._elementor_data'],
  })
  expect('elementor write: verified true', r.verified === true, JSON.stringify(r.result))
  expect('elementor write: no layout drift', r.drift.length === 0, JSON.stringify(r.drift))
}

// ── B52 regression: a regenerated variation set is still drift ──────────
{
  const h = harness(mkEntity({ type: 'variable', variations: [11, 12] }),
    (cur) => ({ ...cur, variations: [11, 12, 13] }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 3194, endpoint: 'wc/v3/products/3194',
    payload: { meta: { _yoast_wpseo_title: 'X' } },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('B52: variation drift caught', r.ok === false && r.drift.some(d => d.field === 'variations'),
    JSON.stringify(r.drift))
}

// ── refuses without injected I/O ────────────────────────────────────────
{
  const r = await safeWrite({ id: 1 })
  expect('missing get/put refuses', r.ok === false && /needs get/.test(r.error || ''), String(r.error))
}

// ── 2026-10-03: WooCommerce products carry meta as a LIST ───────────────
// `meta_data: [{ key, value }]` on the write body and on the read-back. A dotted
// `meta._elementor_data` path read `undefined` on both sides, so a correct write
// fingerprinted as though nothing had happened.
function mkProduct(extra = {}) {
  return {
    id: 53987, type: 'simple', status: 'publish', slug: 'crystal-rose',
    sku: 'D0268', price: '120.00', name: 'D0268 Crystal Rose', description: 'Old description',
    meta_data: [
      { id: 1, key: '_elementor_data', value: 'TREE-OLD' },
      { id: 2, key: '_yoast_wpseo_title', value: 'Old title' },
    ],
    ...extra,
  }
}
// WordPress's answer to a product write: meta_data echoed back with the change.
const productPut = (keys) => (cur, body) => ({
  ...cur,
  meta_data: cur.meta_data.map(m => {
    if (!keys.includes(m.key)) return m
    const hit = (body.meta_data || []).find(x => x.key === m.key)
    return hit ? { ...m, value: hit.value } : m
  }),
})

{
  const h = harness(mkProduct(), productPut(['_elementor_data']))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { meta_data: [{ key: '_elementor_data', value: 'TREE-NEW' }] },
    expectedFields: ['meta._elementor_data'],
  })
  expect('product: a real tree change verifies', r.verified === true && r.noop === false, JSON.stringify(r.result))
  expect('product: no drift, nothing unlanded', r.drift.length === 0 && r.unlanded.length === 0, JSON.stringify(r))
  expect('product: the tree is fingerprinted (hashed), not undefined',
    r.before['meta._elementor_data'] !== null && r.after['meta._elementor_data'] !== null,
    JSON.stringify({ before: r.before['meta._elementor_data'], after: r.after['meta._elementor_data'] }))
}

// The false success that was reported: description lands, the tree silently does
// not — and the item still came back verified:true.
{
  // WordPress applies the top-level description and, silently, nothing to the tree.
  const h = harness(mkProduct(), (cur, body) => ({ ...cur, description: body.description }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { description: 'New description', meta_data: [{ key: '_elementor_data', value: 'TREE-NEW' }] },
    expectedFields: ['description', 'meta._elementor_data'],
  })
  expect('per-field: the landing field is not enough to verify the item', r.verified === false, JSON.stringify(r.result))
  expect('per-field: unlanded names the tree', JSON.stringify(r.unlanded) === '["meta._elementor_data"]', JSON.stringify(r.unlanded))
  expect('per-field: not a no-op (something did move)', r.noop === false)
  expect('per-field: ok false even without unintended drift', r.ok === false && r.drift.length === 0)
  expect('per-field: error names the field that did not land', /did not land in: meta\._elementor_data/.test(r.result.error || ''), String(r.result.error))
}

// Declaring the whole list works too — WooCommerce's own shape.
{
  const h = harness(mkProduct(), productPut(['_elementor_data']))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { meta_data: [{ key: '_elementor_data', value: 'TREE-NEW' }] },
    expectedFields: ['meta_data'],
  })
  expect('product: expectedFields [meta_data] also verifies', r.verified === true, JSON.stringify(r.result))
}

// Over-declared expectedFields must not invent an unlanded field: a declared
// field the payload does not carry is not being written.
{
  const h = harness(mkProduct(), productPut(['_elementor_data']))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { meta_data: [{ key: '_elementor_data', value: 'TREE-NEW' }] },
    expectedFields: ['meta._elementor_data', 'slug', 'status', 'meta._yoast_wpseo_title'],
  })
  expect('over-declared fields are not held against the write', r.verified === true && r.unlanded.length === 0,
    JSON.stringify({ unlanded: r.unlanded, result: r.result }))
}

// `meta._elementor_data` is always watched — so on a product, a save that
// silently wipes the tree now trips drift even when the caller never declared it.
{
  const h = harness(mkProduct(), (cur) => ({
    ...cur,
    meta_data: cur.meta_data.map(m => (m.key === '_elementor_data' ? { ...m, value: 'TREE-WIPED' } : m)),
  }))
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { meta_data: [{ key: '_yoast_wpseo_title', value: 'New title' }] },
    invalidateYoastIndexable: async () => true,
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('product: a silent tree wipe on an undeclared field is drift',
    r.ok === false && r.drift.some(d => d.field === 'meta._elementor_data' && d.before !== d.after),
    JSON.stringify(r.drift))
}

// L-44 still holds on the product shape: a write that changes nothing is a no-op.
{
  const h = harness(mkProduct(), (cur) => cur)
  const r = await safeWrite({
    get: h.get, put: h.put, id: 53987, endpoint: 'wc/v3/products/53987?lang=zh-hant',
    payload: { meta_data: [{ key: '_elementor_data', value: 'TREE-OLD' }] },
    expectedFields: ['meta._elementor_data'],
  })
  expect('product: an unchanged tree is still a no-op, not a verified write',
    r.verified === false && r.noop === true, JSON.stringify(r.result))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
