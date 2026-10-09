import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBundle, bundleCommit, bundleIdentity, handleCreateCorpGiftWithQuote } from '../../netlify/edge-functions/lib/corpGiftWithQuote.js'

const base = {
  name: 'Manual Head Massager', category: 'Fitness & Wellness',
  request_id: '123e4567-e89b-42d3-a456-426614174000',
  component_name: 'Manual Head Massager', component_spec: 'One-color logo printing',
  supplier_id: 'yWhC9Z3qRVnqRmUvyQaj', unit_cost: 17, unit_cost_currency: 'CNY',
  moq: 100, production_lead_time_days: 15, quote_notes: 'Silk-screen printing included; ex-factory Wenzhou.',
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
const request = body => new Request('https://portal.crystocraft.com/api/create-corp-gift-product-with-quote', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }, body: JSON.stringify(body),
})
const authorize = async () => ({ ok: true, uid: 'user-1' })
const run = (body, fetchImpl, auth = authorize) => handleCreateCorpGiftWithQuote(request(body), { authorize: auth, fetchImpl, projectId: 'test-project' })

test('validates a narrow bundle and rejects unsupported fields', () => {
  const bundle = validateBundle(base)
  assert.equal(bundle.unit_cost, 17)
  assert.equal(bundle.unit_cost_currency, 'RMB')
  assert.equal(bundle.moq, 100)
  assert.throws(() => validateBundle({ ...base, active: true }), /Unsupported field/)
  assert.throws(() => validateBundle({ ...base, supplier_id: '../suppliers/x' }), /invalid/)
  assert.throws(() => validateBundle({ ...base, unit_cost: -1 }), /nonnegative/)
  assert.throws(() => validateBundle({ ...base, unit_cost_currency: 'GBP' }), /RMB, HKD, USD or EUR/)
})

test('creates product, component and quote atomically with fixed hidden and preferred flags', async () => {
  let commit
  const res = await run(base, async (url, init) => {
    if (url.includes('/suppliers/')) return response({ fields: { name: { stringValue: 'Wenzhou Yanxu' }, name_cn: { stringValue: '温州颜叙电子科技有限公司' } } })
    commit = JSON.parse(init.body)
    return response({})
  })
  assert.equal(res.status, 201)
  assert.equal(commit.writes.length, 3)
  assert.ok(commit.writes.every(write => write.currentDocument.exists === false))
  assert.equal(commit.writes[0].update.fields.active.booleanValue, false)
  assert.equal(commit.writes[2].update.fields.is_preferred.booleanValue, true)
  assert.equal(commit.writes[2].update.fields.unit_cost.doubleValue, 17)
  assert.equal(commit.writes[2].update.fields.unit_cost_currency.stringValue, 'RMB')
  assert.equal(commit.writes[2].update.fields.supplier_name.stringValue, 'Wenzhou Yanxu (温州颜叙电子科技有限公司)')
  assert.ok(commit.writes[2].update.name.includes('/supplier_quotes/'))
  assert.equal((await res.json()).created, true)
})

test('requires products and supply permissions before Firestore access', async () => {
  const checked = []
  const res = await run(base, async () => { throw new Error('unexpected access') }, async (_req, capability) => {
    checked.push(capability)
    return capability === 'supply' ? { ok: false, response: response({ error: 'denied' }, 403) } : { ok: true, uid: 'user-1' }
  })
  assert.equal(res.status, 403)
  assert.deepEqual(checked, ['products', 'supply'])
})

test('same request and content verify all three records after a retry', async () => {
  const bundle = validateBundle(base)
  const ids = await bundleIdentity('user-1', bundle)
  const names = { product: 'product', component: 'component', quote: 'quote' }
  assert.equal(bundleCommit(names, bundle, 'user-1', ids.fingerprint, 'Supplier').writes.length, 3)
  let reads = 0
  const res = await run(base, async (url, init) => {
    if (url.includes('/suppliers/')) return response({ fields: { name: { stringValue: 'Supplier' } } })
    if (init.method === 'POST') return response({ error: { status: 'ALREADY_EXISTS' } }, 409)
    reads++
    return response({ fields: { mcp_creator_uid: { stringValue: 'user-1' }, mcp_request_hash: { stringValue: ids.fingerprint } } })
  })
  assert.equal(res.status, 200)
  assert.equal(reads, 3)
  assert.equal((await res.json()).created, false)
})

test('a missing supplier prevents any write', async () => {
  let calls = 0
  const res = await run(base, async () => { calls++; return response({}, 404) })
  assert.equal(res.status, 404)
  assert.equal(calls, 1)
})

test('a retry with mismatched content is rejected', async () => {
  const res = await run(base, async (url, init) => {
    if (url.includes('/suppliers/')) return response({ fields: { name: { stringValue: 'Supplier' } } })
    if (init.method === 'POST') return response({ error: { status: 'ALREADY_EXISTS' } }, 409)
    return response({ fields: { mcp_creator_uid: { stringValue: 'user-1' }, mcp_request_hash: { stringValue: 'different' } } })
  })
  assert.equal(res.status, 409)
})
