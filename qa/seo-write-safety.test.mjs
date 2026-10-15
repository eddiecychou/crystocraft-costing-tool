import test from 'node:test'
import assert from 'node:assert/strict'
import { safeWrite } from '../seo-control-plane/safe-write.mjs'
import { entityKey, supersedesIds, queuePlan, releaseBatch, storeQueuedBatch } from '../netlify/functions/lib/seoBatchSafety.js'

const old = JSON.stringify([{ id: 'a', settings: { editor: 'Old' } }])
const next = JSON.stringify([{ id: 'a', settings: { editor: '<a href="https://example.com/茶">茶</a>', n: 1 } }])
const php = next.replaceAll('/', '\\/').replaceAll('茶', '\\u8336')
const fields = ['meta._elementor_data']
async function write(after, extra = {}, payload = { meta: { _elementor_data: next } }) {
  let puts = 0
  const before = { meta: { _elementor_data: old }, status: 'publish' }
  const r = await safeWrite({
    id: 66619, endpoint: 'wp/v2/pages/66619', payload, expectedFields: fields,
    get: async () => puts ? after : before, put: async () => { puts++ },
    ...extra,
  })
  return { ...r, puts }
}

test('DSH reproduction: PHP escaped slashes and Unicode verify as the reviewed tree', async () => {
  assert.notEqual(next, php)
  const r = await write({ meta: { _elementor_data: php }, status: 'publish' })
  assert.equal(r.verified, true); assert.deepEqual(r.unlanded, [])
})
test('object key order is irrelevant but every value and array position matter', async () => {
  const reordered = JSON.stringify([{ settings: { n: 1, editor: '<a href="https://example.com/茶">茶</a>' }, id: 'a' }])
  assert.equal((await write({ meta: { _elementor_data: reordered }, status: 'publish' })).verified, true)
  for (const wrong of [next.replace('"n":1', '"n":2'), JSON.stringify([...JSON.parse(next), { id: 'b' }]).replace('"a"', '"b"')]) {
    assert.equal((await write({ meta: { _elementor_data: wrong }, status: 'publish' })).verified, false)
  }
})
test('normalisation does not hide malformed JSON or double-escaped authored values', async () => {
  for (const data of ['{broken', JSON.stringify(next), next.replace('https://', 'https:\\\\/\\\\/')]) {
    const r = await write({ meta: { _elementor_data: data }, status: 'publish' })
    assert.equal(r.verified, false); assert.deepEqual(r.unlanded, fields)
  }
})
test('WooCommerce metadata list uses the same semantic verification', async () => {
  const r = await write({ meta_data: [{ key: '_elementor_data', value: php }], status: 'publish' }, {},
    { meta_data: [{ key: '_elementor_data', value: next }] })
  assert.equal(r.verified, true)
})
test('serialization-only movement is still a no-op', async () => {
  const value = old.replace('Old', 'https://example.com/茶')
  let reads = 0
  const r = await safeWrite({ id: 1, endpoint: 'wp/v2/pages/1',
    get: async () => ({ meta: { _elementor_data: reads++ ? value.replaceAll('/', '\\/') : value } }),
    put: async () => {}, payload: { meta: { _elementor_data: value } }, expectedFields: fields })
  assert.equal(r.noop, true); assert.equal(r.verified, false); assert.deepEqual(r.unlanded, [])
})
test('undeclared layout serialization is harmless, real layout drift remains blocked', async () => {
  for (const [value, ok] of [[old.replaceAll('/', '\\/'), true], [next, false]]) {
    const r = await write({ meta: { _elementor_data: value }, status: 'draft' }, { expectedFields: ['status'] }, { status: 'draft' })
    assert.equal(r.ok, ok)
  }
})
test('layout success does not conceal ignored Yoast metadata', async () => {
  let invalidations = 0
  const r = await write({ meta: { _elementor_data: php }, status: 'publish' },
    { expectedFields: [...fields, 'meta._yoast_wpseo_title'], invalidateYoastIndexable: async () => { invalidations++; return true } },
    { meta: { _elementor_data: next, _yoast_wpseo_title: 'Reviewed title' } })
  assert.equal(r.verified, false); assert.deepEqual(r.unlanded, ['meta._yoast_wpseo_title']); assert.equal(invalidations, 0)
})
test('ordinary text and HTML remain exact; no slash or Unicode replacement outside layout', async () => {
  const r = await write({ content: { raw: 'https:\\/\\/example.com' }, meta: { _elementor_data: old }, status: 'publish' },
    { expectedFields: ['content'] }, { content: 'https://example.com' })
  assert.equal(r.verified, false); assert.deepEqual(r.unlanded, ['content'])
})
test('stale reviewed snapshot aborts before any write', async () => {
  const r = await write({}, { expectedBefore: { 'meta._elementor_data': next } })
  assert.equal(r.puts, 0); assert.equal(r.verified, false); assert.deepEqual(r.stale, fields)
})
test('matching raw snapshot permits a write; encoding-only baseline remains equivalent', async () => {
  assert.equal((await write({ meta: { _elementor_data: php }, status: 'publish' },
    { expectedBefore: { 'meta._elementor_data': old } })).verified, true)
  for (const expectedBefore of [{}, null, [], { content: undefined }]) {
    assert.equal((await write({}, { expectedBefore })).puts, 0)
  }
})

const item = (id, endpoint = 'wp/v2/pages/' + id) => ({ endpoint, decision: 'pending', payload: { title: 'x' } })
const batch = (id, status = 'pending_review', items = [item(66619)]) => ({ id, status, items })
test('entity collisions ignore language/query/trailing slash but retain entity namespaces', () => {
  assert.equal(entityKey(item(1, '/wp/v2/pages/066619/?lang=fr')), 'wp/v2/pages/66619')
  assert.equal(entityKey(item(1, 'wp/v2/pages')), null)
  assert.deepEqual(queuePlan([item(66619)], [batch('old')]).conflicts, ['old'])
  assert.deepEqual(queuePlan([item(66619)], [batch('old', 'approved')]).conflicts, ['old'])
  assert.deepEqual(queuePlan([item(66619)], [batch('old', 'partial')]).conflicts, [])
  assert.deepEqual(queuePlan([item(66619, 'wp/v2/posts/66619')], [batch('old')]).conflicts, [])
  assert.throws(() => queuePlan([item(66619), item(66619)], []), /Combine/)
})
test('supersession only withdraws overlapping unexecuted pending batches', () => {
  assert.deepEqual(queuePlan([item(66619)], [batch('old')], ['old']), { conflicts: [], supersedes: ['old'] })
  for (const b of [batch('old', 'approved'), batch('old', 'partial'), batch('old', 'rejected'),
    { ...batch('old'), superseded_by: 'new' }, batch('old', 'pending_review', [{ ...item(66619), result: { ok: false } }])]) {
    assert.throws(() => queuePlan([item(66619)], [b], ['old']), /Only unexecuted/)
  }
  assert.throws(() => queuePlan([item(2)], [batch('old')], ['old']), /does not overlap/)
  assert.throws(() => queuePlan([item(66619)], [], ['missing']), /Only unexecuted/)
})
test('supersedes IDs are bounded and validated, not coerced', () => {
  assert.deepEqual(supersedesIds(undefined), [])
  assert.deepEqual(supersedesIds(['a', 'b']), ['a', 'b'])
  for (const v of [null, 'a', ['a', 'a'], ['../a'], [4], Array(21).fill('a')]) assert.throws(() => supersedesIds(v))
})
test('poll never revives a superseded batch even after a stale UI sets approved', () => {
  assert.equal(releaseBatch({ ...batch('old', 'approved'), superseded_by: 'new' }), null)
  assert.equal(releaseBatch(batch('old', 'superseded')), null)
  for (const passed of [false, undefined, null]) {
    assert.equal(releaseBatch(batch('b', 'approved', [{ ...item(1), decision: 'approve', validation: { passed } }])).items[0].decision, 'blocked')
  }
  assert.equal(releaseBatch(batch('b', 'approved', [{ ...item(1), decision: 'approve', validation: { passed: true } }])).items[0].decision, 'approve')
})

test('layout array order remains significant', async () => {
  const elements = [{ id: 'a', settings: {} }, { id: 'b', settings: {} }]
  const r = await write({ meta: { _elementor_data: JSON.stringify(elements.toReversed()) }, status: 'publish' },
    {}, { meta: { _elementor_data: JSON.stringify(elements) } })
  assert.equal(r.verified, false); assert.deepEqual(r.unlanded, fields)
})
test('transaction stores a pending replacement and audits the old batch atomically', async () => {
  const data = new Map([['old', batch('old')]])
  const col = { doc: id => ({ id }), where: () => 'active' }
  const db = { runTransaction: async fn => {
    const staged = []
    await fn({
      get: async ref => ref === 'active'
        ? { docs: [...data].map(([id, b]) => ({ id, data: () => b })) }
        : { exists: data.has(ref.id), data: () => data.get(ref.id) },
      update: (ref, patch) => staged.push(() => data.set(ref.id, { ...data.get(ref.id), ...patch })),
      set: (ref, value) => staged.push(() => data.set(ref.id, value)),
    })
    staged.forEach(apply => apply())
  } }
  const doc = { status: 'pending_review', items: [item(66619)], created_at: 'now' }
  await assert.rejects(storeQueuedBatch(db, col, { id: 'new' }, doc, []), /active batch/)
  assert.equal(data.size, 1); assert.equal(data.get('old').status, 'pending_review')
  await storeQueuedBatch(db, col, { id: 'new' }, doc, ['old'])
  assert.equal(data.get('old').status, 'superseded')
  assert.equal(data.get('old').superseded_by, 'new')
  assert.equal(data.get('new').status, 'pending_review')
  assert.deepEqual(data.get('new').supersedes, ['old'])
  assert.equal(data.get('new').items[0].decision, 'pending')
  assert.equal(releaseBatch({ ...data.get('old'), status: 'approved' }), null)
})
