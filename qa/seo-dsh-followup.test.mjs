import test from 'node:test'
import assert from 'node:assert/strict'
import { safeWrite } from '../seo-control-plane/safe-write.mjs'
import { validatePayload } from '../seo-control-plane/validate-payload.mjs'
import { claimBatch, withdrawBatch, storeQueuedBatch, queuePlan, releaseBatch } from '../netlify/functions/lib/seoBatchSafety.js'

const layout = text => JSON.stringify([{ id: 'a', elType: 'widget', widgetType: 'heading', settings: { title: text } }])
const item = { index: 0, endpoint: 'wp/v2/pages/66619', decision: 'approve', result: null, validation: { passed: true } }
const approved = () => ({ status: 'approved', items: [{ ...item }] })
// Serializable injected store: stage writes and commit only after callback success.
function store(initial = approved()) {
  const data = new Map([['old', initial]])
  const col = { doc: id => ({ id }), where: () => 'active' }
  const db = { runTransaction: async fn => {
    const staged = []
    const value = await fn({ get: async ref => ref === 'active'
      ? { docs: [...data].filter(([, b]) => ['pending_review', 'approved', 'executing'].includes(b.status)).map(([id, b]) => ({ id, data: () => b })) }
      : { exists: data.has(ref.id), data: () => structuredClone(data.get(ref.id)) },
    update: (ref, patch) => staged.push(() => data.set(ref.id, { ...data.get(ref.id), ...patch })),
    set: (ref, value) => staged.push(() => data.set(ref.id, value)) })
    staged.forEach(apply => apply()); return value
  } }
  return { data, col, db, ref: { id: 'old' } }
}
test('DSH metadata carrier declaration covers the nested layout without masking unrelated drift', async () => {
  for (const carrier of ['meta', 'meta_data']) for (const drift of [false, true]) {
    let calls = 0
    const r = await safeWrite({ id: 1, endpoint: 'wp/v2/pages/1',
      payload: { meta: { _elementor_data: layout('New') } }, expectedFields: [carrier],
      get: async () => ({ status: calls && drift ? 'draft' : 'publish', meta: { _elementor_data: layout(calls ? 'New' : 'Old') } }),
      put: async () => { calls++ } })
    assert.equal(r.verified, !drift)
    assert.equal(r.drift.some(d => d.field === 'status'), drift)
  }
})
test('metadata-only brand check skips all meta shapes but other validation still runs', () => {
  for (const payload of [
    { meta: { _yoast_wpseo_metadesc: 'A useful description.' } },
    { 'meta._yoast_wpseo_metadesc': 'A useful description.' },
    { meta_data: [{ key: '_yoast_wpseo_metadesc', value: 'A useful description.' }] },
  ]) {
    const v = validatePayload({ endpoint: 'wp/v2/pages/66619', payload, source: { content: { raw: 'Swarovski Crystocraft' } } })
    const brand = v.checks.find(c => c.name === 'brand_terms_preserved')
    assert.equal(brand.ok, null); assert.match(brand.detail, /untouched/)
    assert.ok(v.ran > 0); assert.equal(v.overridden, 0)
  }
  const v = validatePayload({ payload: { meta: { _yoast_wpseo_metadesc: 'x'.repeat(500) } }, source: { content: { raw: 'Crystocraft' } } })
  assert.equal(v.passed, false); assert.equal(v.checks.find(c => c.name === 'seo_desc_length').ok, false)
})
test('actual body, title and Elementor brand removal are still failures, including empty writes', () => {
  for (const [payload, source] of [
    [{ content: '' }, { content: { raw: 'Crystocraft' } }],
    [{ title: 'Other' }, { title: { raw: 'Crystocraft' } }],
    [{ description: 'Other' }, { description: 'Crystocraft' }],
    [{ meta: { _elementor_data: layout('Other') } }, { meta: { _elementor_data: layout('Crystocraft') } }],
  ]) assert.equal(validatePayload({ payload, source }).checks.find(c => c.name === 'brand_terms_preserved').ok, false)
})
test('unused approved batch can be withdrawn with preserved approval and audit', async () => {
  const { db, ref, data } = store()
  await withdrawBatch(db, ref, 'now', 'Obsolete test')
  assert.equal(data.get('old').status, 'withdrawn'); assert.equal(data.get('old').items[0].decision, 'approve')
  assert.equal(data.get('old').withdrawal_reason, 'Obsolete test')
  await assert.rejects(claimBatch(db, ref, 'later'), /not available/)
})
test('claim wins before withdrawal or supersession: zero-result work stays locked and conflicts', async () => {
  const { db, ref, col, data } = store()
  const b = await claimBatch(db, ref, 'now')
  assert.equal(b.status, 'executing'); assert.equal(b.items[0].decision, 'approve')
  assert.equal(data.get('old').items[0].result, null)
  await assert.rejects(withdrawBatch(db, ref, 'later', 'test'), /cannot withdraw/)
  await assert.rejects(claimBatch(db, ref, 'later'), /not available/)
  await assert.rejects(storeQueuedBatch(db, col, { id: 'new' }, { status: 'pending_review', items: [item] }, ['old']), /Only unclaimed/)
  assert.deepEqual(queuePlan([item], [{ id: 'old', ...data.get('old') }]).conflicts, ['old'])
})
test('supersession wins before claim: pending replacement requires fresh approval', async () => {
  const { db, ref, col, data } = store()
  await storeQueuedBatch(db, col, { id: 'new' }, { status: 'pending_review', items: [{ ...item, decision: 'pending' }], created_at: 'now' }, ['old'])
  await assert.rejects(claimBatch(db, ref, 'later'), /not available/)
  assert.equal(data.get('old').status, 'superseded'); assert.equal(data.get('new').items[0].decision, 'pending')
})
test('any result, partial work or old execution marker prevents withdrawal', async () => {
  for (const b of [ { ...approved(), items: [{ ...item, result: { ok: false } }] },
    { ...approved(), status: 'partial' }, { ...approved(), execution_started_at: 'earlier' } ]) {
    const { db, ref } = store(b)
    await assert.rejects(withdrawBatch(db, ref, 'now', 'test'), /cannot withdraw/)
    await assert.rejects(claimBatch(db, ref, 'now'), /not available/)
  }
  assert.equal(releaseBatch({ ...approved(), execution_started_at: 'earlier' }), null)
})

test('vendor checker uses immutable release bytes despite stale dirty checkout; never accepts mutable refs', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { checkVendorSync, artifacts } = await import('../seo-control-plane/check-vendor-sync.mjs')
  const root = mkdtempSync(join(tmpdir(), 'oc-vendor-'))
  try {
    const repo = join(root, 'repo'), vendor = join(root, 'vendor')
    mkdirSync(join(repo, 'seo-control-plane'), { recursive: true }); mkdirSync(vendor)
    const git = args => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString().trim()
    git(['init']); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Fixture'])
    for (const file of artifacts) { writeFileSync(join(repo, 'seo-control-plane', file), 'released'); writeFileSync(join(vendor, file), 'released') }
    git(['add', '.']); git(['commit', '-m', 'fixture'])
    const release = git(['rev-parse', 'HEAD'])
    writeFileSync(join(repo, 'seo-control-plane/safe-write.mjs'), 'older working copy')
    assert.equal(checkVendorSync({ repo, release, vendors: [vendor] }).passed, true)
    writeFileSync(join(vendor, 'safe-write.mjs'), 'wrong')
    assert.equal(checkVendorSync({ repo, release, vendors: [vendor] }).passed, false)
    for (const release of ['HEAD', 'main', 'abc123']) assert.throws(() => checkVendorSync({ repo, release, vendors: [vendor] }), /immutable/)
    assert.throws(() => checkVendorSync({ repo, release, vendors: [] }), /every active/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('HTTP execution contract blocks old workers and records claim before accepting results', async () => {
  const { build } = await import('esbuild')
  const b = await build({ entryPoints: ['netlify/functions/seo-batch.js'], bundle: true,
    platform: 'node', format: 'esm', write: false, plugins: [{ name: 'fixture-admin', setup(b) {
      b.onResolve({ filter: /firebaseAdmin\.js$/ }, () => ({ path: 'admin', namespace: 'fixture' }))
      b.onResolve({ filter: /^firebase-admin\/firestore$/ }, () => ({ path: 'store', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'admin'
        ? 'export function initAdminApp() {}'
        : 'export const getFirestore = () => globalThis.__dshDb; export const Timestamp = { now: () => "now" }' }))
    } }] })
  const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'))
  const { db, col, data } = store()
  db.collection = () => col
  const oldSecret = process.env.SEO_BATCH_SECRET
  process.env.SEO_BATCH_SECRET = 'qa-fixture-only-not-a-real-secret'
  globalThis.__dshDb = db
  const call = body => handler(new Request('https://fixture.test/api/seo-batch', { method: 'POST',
    headers: { Authorization: 'Bearer qa-fixture-only-not-a-real-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  try {
    assert.equal((await call({ op: 'poll' })).status, 409)
    assert.equal((await call({ op: 'claim', id: 'old' })).status, 409)
    assert.equal((await call({ op: 'result', id: 'old', results: [] })).status, 409)
    const claim = await call({ op: 'claim', id: 'old', execution_protocol: 2 })
    assert.equal(claim.status, 200); assert.equal((await claim.json()).batch.status, 'executing')
    assert.equal((await call({ op: 'withdraw', id: 'old', reason: 'stale' })).status, 409)
    assert.equal((await call({ op: 'result', id: 'old', results: [{ index: 0, ok: true, verified: true }] })).status, 200)
    assert.equal(data.get('old').status, 'executed')
    data.set('old', approved())
    assert.equal((await call({ op: 'withdraw', id: 'old' })).status, 400)
    assert.equal((await call({ op: 'withdraw', id: 'old', reason: 'Obsolete' })).status, 200)
    assert.equal((await call({ op: 'result', id: 'old', results: [] })).status, 409)
    assert.equal(data.get('old').status, 'withdrawn')
  } finally {
    delete globalThis.__dshDb
    if (oldSecret === undefined) delete process.env.SEO_BATCH_SECRET
    else process.env.SEO_BATCH_SECRET = oldSecret
  }
})
