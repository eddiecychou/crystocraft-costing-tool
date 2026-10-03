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
    expectedFields: ['meta._yoast_wpseo_title'],
  })
  expect('no-op: ok stays true (no drift)', r.ok === true)
  expect('no-op: verified is false', r.verified === false)
  expect('no-op: noop is true', r.noop === true)
  expect('no-op: result carries verified:false + noop:true', r.result.verified === false && r.result.noop === true)
  expect('no-op: error explains why', /no-op/.test(r.result.error || ''), String(r.result.error))
  expect('no-op: top-level error explains why', /no-op/.test(r.error || ''), String(r.error))
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
