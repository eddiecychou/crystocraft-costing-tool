import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponentWithQuote, handleMcpProductSupply, searchSuppliers, supplyCommit, supplyIdentity, validateSupplyWrite } from '../../netlify/edge-functions/lib/mcpProductSupply.js'

const productId = 'mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd'
const input = {
  product_id: productId, supplier_id: 'ryanSupplier', component_name: 'Crystal fabric',
  component_spec: 'Supplier-confirmed crystal fabric specification', component_unit: 'pcs', qty_per_product: 1,
  unit_cost: 12.5, unit_cost_currency: 'CNY', moq: 500, source_notes: 'Ryan quotation, source to be attached in OC',
  request_id: '123e4567-e89b-42d3-a456-426614174000',
}
const root = 'projects/test-project/databases/(default)/documents'
const productPath = `${root}/products/${productId}`
const supplierPath = `${root}/suppliers/ryanSupplier`
const field = value => typeof value === 'string' ? { stringValue: value } : { booleanValue: value }
const document = (name, fields) => ({ name, updateTime: '2026-10-13T04:14:46.671812Z', fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, field(value)])) })
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })
const authorized = async (_req, module) => ({ ok: true, uid: 'mcp-product-writer-service', role: 'staff', modules: [module] })
const request = (op, data) => new Request('https://portal.crystocraft.com/api/mcp-product-supply', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify({ op, input: data }),
})

function fakeStore() {
  const docs = new Map([
    [productPath, document(productPath, { name: 'Mezuzah', status: 'concept', active: false, description: 'Existing copy', selling_price: 'unchanged' })],
    [supplierPath, document(supplierPath, { name: 'Dongguan Yin Li', name_cn: '东莞银利' })],
  ])
  let commits = 0
  let failCommit = false
  let beforeCommit = null
  async function fetchImpl(url, init = {}) {
    const path = new URL(url).pathname.replace(/^\/v1\//, '')
    if (init.method === 'POST' && path.endsWith(':commit')) {
      commits++
      beforeCommit?.(docs)
      if (failCommit) return response({ error: { status: 'INTERNAL' } }, 500)
      const writes = JSON.parse(init.body).writes
      if (writes.some(w => w.verify && (!docs.has(w.verify) || docs.get(w.verify).updateTime !== w.currentDocument.updateTime)) || writes.some(w => w.update && w.currentDocument?.exists === false && docs.has(w.update.name))) return response({ error: { status: 'FAILED_PRECONDITION' } }, 409)
      for (const write of writes) if (write.update) docs.set(write.update.name, { name: write.update.name, fields: write.update.fields })
      return response({})
    }
    const doc = docs.get(path)
    return doc ? response(doc) : response({}, 404)
  }
  const call = data => addComponentWithQuote(data, { fetchImpl, projectId: 'test-project', token: 'Bearer test', uid: 'mcp-product-writer-service', origin: 'https://portal.crystocraft.com' })
  return { docs, call, fetchImpl, get commits() { return commits }, set failCommit(value) { failCommit = value }, set beforeCommit(value) { beforeCommit = value } }
}

test('strict validation, CNY normalization, required facts, and no commercial fields', () => {
  assert.equal(validateSupplyWrite(input).unit_cost_currency, 'RMB')
  assert.equal(validateSupplyWrite({ ...input, unit_cost_currency: 'rmb' }).unit_cost_currency, 'RMB')
  for (const patch of [{ price: 100 }, { status: 'active' }, { component_spec: '' }, { supplier_id: '../x' }, { unit_cost: 0 }, { unit_cost: -1 }, { unit_cost: NaN }, { unit_cost: 0.00001 }, { unit_cost: 1.12345 }, { moq: 0 }, { moq: 2.5 }, { unit_cost_currency: 'GBP' }, { qty_per_product: 0 }, { source_notes: '' }]) {
    assert.throws(() => validateSupplyWrite({ ...input, ...patch }))
  }
})

test('service principal and both modules are required before Firestore access', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw Error('unexpected') }
  const invoke = authorize => handleMcpProductSupply(request('search_suppliers', { query: 'Ryan' }), { authorize, fetchImpl, projectId: 'test-project' })
  assert.equal((await invoke(async () => ({ ok: true, uid: 'human', role: 'admin' }))).status, 403)
  assert.equal((await invoke(async (_, module) => module === 'supply' ? { ok: false, response: response({}, 403) } : { ok: true, uid: 'mcp-product-writer-service', role: 'staff' })).status, 403)
  assert.equal(calls, 0)
})

test('supplier search matches English, Chinese and named contact and returns IDs', async () => {
  const docs = [
    { name: `${root}/suppliers/s1`, fields: { name: { stringValue: 'Dongguan Yin Li' }, name_cn: { stringValue: '东莞银利' }, contacts: { arrayValue: { values: [{ mapValue: { fields: { name: { stringValue: 'Ryan' }, wechat: { stringValue: 'ryan-id' } } } }] } } } },
    { name: `${root}/suppliers/s2`, fields: { name: { stringValue: 'Feihong' } } },
  ]
  const fetchImpl = async () => response({ documents: docs })
  for (const query of ['Yin Li', '银利', 'Ryan']) {
    const res = await searchSuppliers({ query }, { fetchImpl, projectId: 'test-project', token: 'Bearer test' })
    const body = await res.json()
    assert.equal(body.matches[0].supplier_id, 's1')
    assert.equal(body.matches.length, 1)
  }
})

test('dry run validates records and previews audit without any writes', async () => {
  const store = fakeStore()
  const res = await store.call(input)
  const data = await res.json()
  assert.equal(data.dry_run, true)
  assert.equal(data.will_write, false)
  assert.equal(data.normalized_currency, 'RMB')
  assert.equal(data.audit_preview.service_principal, 'mcp-product-writer-service')
  assert.equal(store.commits, 0)
  assert.equal(store.docs.size, 2)
})

test('missing product/supplier and non-Concept product never write', async () => {
  const store = fakeStore()
  store.docs.delete(productPath)
  assert.equal((await store.call(input)).status, 404)
  store.docs.set(productPath, document(productPath, { status: 'active', active: true }))
  assert.equal((await store.call(input)).status, 409)
  store.docs.delete(supplierPath)
  assert.equal((await store.call(input)).status, 404)
  assert.equal(store.commits, 0)
})

test('atomic commit adds component, quote and audit but preserves the product', async () => {
  const store = fakeStore()
  const before = structuredClone(store.docs.get(productPath))
  const res = await store.call({ ...input, dry_run: false })
  const data = await res.json()
  assert.equal(res.status, 201)
  assert.equal(data.created, true)
  assert.equal(store.docs.size, 5)
  assert.deepEqual(store.docs.get(productPath), before)
  assert.equal(store.docs.get(`${root}/products/${productId}/components/${data.component_id}`).fields.name.stringValue, 'Crystal fabric')
  assert.equal(store.docs.get(`${root}/products/${productId}/components/${data.component_id}/supplier_quotes/${data.quote_id}`).fields.unit_cost_currency.stringValue, 'RMB')
  const audit = [...store.docs.values()].find(d => d.name.includes('/audit_logs/'))
  assert.equal(audit.fields.service_principal.stringValue, 'mcp-product-writer-service')
  assert.equal(audit.fields.requested_by.stringValue, 'unknown')
})

test('failed commit leaves no partial component, quote or audit', async () => {
  const store = fakeStore()
  store.failCommit = true
  assert.equal((await store.call({ ...input, dry_run: false })).status, 502)
  assert.equal(store.docs.size, 2)
})

test('product change between validation and commit blocks the whole write', async () => {
  const store = fakeStore()
  store.beforeCommit = docs => { docs.get(productPath).updateTime = '2026-10-13T05:00:00Z' }
  const result = await store.call({ ...input, dry_run: false })
  assert.equal((await result.json()).error.code, 'PRECONDITION_FAILED')
  assert.equal(store.docs.size, 2)
})

test('same key/content returns original IDs; same key/different content is rejected', async () => {
  const store = fakeStore()
  const first = await (await store.call({ ...input, dry_run: false })).json()
  const second = await (await store.call({ ...input, dry_run: false })).json()
  assert.equal(second.created, false)
  assert.equal(second.component_id, first.component_id)
  assert.equal(second.quote_id, first.quote_id)
  assert.equal(store.commits, 1)
  store.docs.get(productPath).fields.status = { stringValue: 'sampled' }
  const afterStatusChange = await (await store.call({ ...input, dry_run: false })).json()
  assert.equal(afterStatusChange.created, false)
  assert.equal(afterStatusChange.quote_id, first.quote_id)
  const changed = await store.call({ ...input, component_spec: 'Changed specification', dry_run: false })
  assert.equal(changed.status, 409)
  assert.equal((await changed.json()).error.code, 'DUPLICATE_REQUEST')
  assert.equal(store.commits, 1)
})

test('commit has existence checks and no product update, tiers or publication', async () => {
  const normalized = validateSupplyWrite(input)
  const ids = await supplyIdentity('mcp-product-writer-service', normalized)
  const paths = { product: productPath, supplier: supplierPath, component: 'component', quote: 'quote', audit: 'audit' }
  const writes = supplyCommit(paths, normalized, ids, 'Supplier', 'mcp-product-writer-service', { product: '2026-10-13T04:14:46.671812Z', supplier: '2026-10-13T04:14:46.671812Z' }).writes
  assert.deepEqual(writes.slice(0, 2).map(w => w.verify), [productPath, supplierPath])
  assert.equal(writes[0].currentDocument.updateTime, '2026-10-13T04:14:46.671812Z')
  assert.deepEqual(writes.slice(2).map(w => w.update.name), ['component', 'quote', 'audit'])
  assert.equal(writes[3].update.fields.volume_tiers.arrayValue.values.length, 0)
  assert.equal(writes[3].update.fields.production_lead_time_days, undefined)
})
