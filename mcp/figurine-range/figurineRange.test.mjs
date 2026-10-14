import test from 'node:test'
import assert from 'node:assert/strict'
import { handleMcpFigurineRange, ITEM_CODES, SOURCE_PARTS, SOURCE_PRODUCT_ID, RANGE_SERVICE_UID, designDraft, encode, decode, identity } from '../../netlify/edge-functions/lib/mcpFigurineRange.js'

const project = 'test-project'
const base = `projects/${project}/databases/(default)/documents/`
const uuid = 'df17f76f-f84d-4f42-bd23-1134464531b8'
const doc = (path, value, updateTime = '2026-10-14T00:00:00Z') => ({ name: base + path, fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])), updateTime })
const data = d => Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, decode(v)]))

function fixture() {
  const docs = new Map()
  const puts = (path, value) => docs.set(path, doc(path, value))
  puts('settings/crystal_colors', { colors: ['BL', 'C1', 'PE', 'VL'].map(code => ({ code })) })
  puts(`products/${SOURCE_PRODUCT_ID}`, { active: false, status: 'concept', price_hkd: 62 })
  for (const [kind, p] of Object.entries(SOURCE_PARTS)) {
    const path = `products/${SOURCE_PRODUCT_ID}/components/${p.component_id}`
    puts(path, { name: kind })
    puts(`${path}/supplier_quotes/${p.quote_id}`, { supplier_id: p.supplier_id, unit_cost_currency: 'RMB', unit_cost: p.working_cost ?? p.cost, moq: p.moq, tooling_sample_cost: p.tooling ?? null })
    puts(`suppliers/${p.supplier_id}`, { name: kind === 'metal' ? 'Feihong' : 'Dongguan Yin Li' })
  }
  const commits = []
  let failCommit = false
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url)
    if (u.pathname.endsWith(':commit')) {
      const writes = JSON.parse(options.body).writes
      commits.push(writes)
      if (failCommit) return new Response('{}', { status: 403 })
      // Simulate Firestore commit's all-or-nothing preconditions.
      for (const w of writes) {
        const path = (w.update.name).slice(base.length)
        const old = docs.get(path)
        if (w.currentDocument?.exists === false && old) return new Response('{}', { status: 409 })
        if (w.currentDocument?.updateTime && old?.updateTime !== w.currentDocument.updateTime) return new Response('{}', { status: 409 })
      }
      for (const w of writes) {
        const path = w.update.name.slice(base.length)
        const previous = docs.get(path)
        const value = w.updateMask ? { ...data(previous), ...data(w.update) } : data(w.update)
        if (w.updateTransforms) for (const t of w.updateTransforms) value[t.fieldPath] = '2026-10-14T00:00:00Z'
        docs.set(path, doc(path, value, '2026-10-14T00:00:01Z'))
      }
      return Response.json({ writeResults: writes.map(() => ({})) })
    }
    const path = decodeURIComponent(u.pathname.split('/documents/')[1] || '')
    if (docs.has(path)) return Response.json(docs.get(path))
    // A collection list only includes immediate children.
    const children = [...docs.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, value]) => value)
    if (children.length || ['range_products', 'range_components'].includes(path)) return Response.json({ documents: children })
    return new Response('{}', { status: 404 })
  }
  const call = async (op, input, overrides = {}) => {
    const req = new Request('https://portal.crystocraft.com/api/mcp-figurine-range', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fake' }, body: JSON.stringify({ op, input }) })
    const response = await handleMcpFigurineRange(req, { fetchImpl, projectId: project, authorize: async () => ({ ok: true, uid: RANGE_SERVICE_UID, role: 'staff' }), writesEnabled: false, ...overrides })
    return { status: response.status, body: await response.json() }
  }
  return { docs, puts, commits, call, setFail: value => { failCommit = value } }
}

test('exact B0016 codes and customer-readable draft contain no supplier cost or HKD 62 price', () => {
  const draft = designDraft(ITEM_CODES)
  assert.deepEqual(draft.variants.map(v => v.sku), ITEM_CODES)
  assert.equal(draft.active, false)
  assert.equal(draft.status, 'concept')
  assert.equal(draft.critical_components.length, 0)
  assert.doesNotMatch(JSON.stringify(draft), /supplier|unit_cost|tooling|62/)
  assert.throws(() => designDraft([...ITEM_CODES.slice(0, 5), ITEM_CODES[0]]), /exactly/)
})

test('dry run checks uniqueness and reports B/000/G and missing colour taxonomy without writes', async () => {
  const f = fixture()
  const r = await f.call('prepare_mezuzah_range_design', { item_codes: ITEM_CODES, dry_run: true })
  assert.equal(r.status, 200)
  assert.equal(r.body.will_write, false)
  assert.deepEqual(r.body.conflicts, [])
  assert.equal(r.body.proposed.records.length, 8)
  assert.equal(r.body.proposed.records.at(-1).fields.service_principal, RANGE_SERVICE_UID)
  assert.deepEqual(r.body.warnings.map(w => w.code), ['UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE', 'PLATING_REVIEW', 'COLOUR_CODE_NOT_IN_LIBRARY', 'COLOUR_CODE_NOT_IN_LIBRARY'])
  assert.deepEqual(r.body.warnings.filter(w => w.colour_code).map(w => w.colour_code), ['BK', 'MT'])
  assert.equal(f.commits.length, 0)
  f.puts('range_products/old', { design_no: '0016', format_code: '000', variants: [{ brand_code: 'B', plating_code: 'G', crystal_code: 'BK' }] })
  const conflict = await f.call('prepare_mezuzah_range_design', { item_codes: ITEM_CODES, dry_run: true })
  assert.deepEqual(conflict.body.conflicts, [{ item_code: 'B0016-000-GBK', range_id: 'old' }])
  assert.equal(conflict.body.blocked, true)
})

test('read-only search and get resolve an exact item code without exposing costs', async () => {
  const f = fixture()
  f.puts('range_products/existing', { ...designDraft(), active: false, status: 'concept' })
  const search = await f.call('search_range_designs', { item_code: 'B0016-000-GBK' })
  assert.equal(search.body.count, 1)
  assert.equal(search.body.matches[0].range_id, 'existing')
  const get = await f.call('get_range_design', { range_id: 'existing' })
  assert.deepEqual(get.body.design.item_codes, ITEM_CODES)
  assert.doesNotMatch(JSON.stringify(get.body), /unit_cost|supplier|tooling/)
  assert.equal((await f.call('get_range_design', { range_id: 'missing' })).body.error.code, 'RANGE_NOT_FOUND')
  assert.equal(f.commits.length, 0)
})

test('authorization, invalid data and phase-one write gate', async () => {
  const f = fixture()
  assert.equal((await f.call('search_range_designs', {}, { authorize: async () => ({ ok: true, uid: 'other', role: 'staff' }) })).status, 403)
  assert.equal((await f.call('prepare_mezuzah_range_design', { item_codes: [...ITEM_CODES.slice(0, 5), 'wrong'], dry_run: true })).status, 400)
  const request = { item_codes: ITEM_CODES, request_id: uuid, approved: true, dry_run: false, acknowledge_warnings: ['UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE', 'PLATING_REVIEW', 'COLOUR_CODE_NOT_IN_LIBRARY'] }
  const gated = await f.call('create_mezuzah_range_design', request)
  assert.equal(gated.body.error.code, 'WRITES_DISABLED')
  assert.equal(f.commits.length, 0)
})

test('atomic design create, idempotent retry, UUID payload mismatch and exact six claims', async () => {
  const f = fixture()
  const input = { item_codes: ITEM_CODES, request_id: uuid, approved: true, dry_run: false, acknowledge_warnings: ['UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE', 'PLATING_REVIEW', 'COLOUR_CODE_NOT_IN_LIBRARY'] }
  f.setFail(true)
  const denied = await f.call('create_mezuzah_range_design', input, { writesEnabled: true })
  assert.equal(denied.body.error.code, 'PERMISSION_DENIED')
  assert.equal([...f.docs.keys()].filter(k => k.startsWith('range_')).length, 0)
  f.setFail(false)
  const first = await f.call('create_mezuzah_range_design', input, { writesEnabled: true })
  assert.equal(first.status, 201)
  assert.equal(first.body.created, true)
  assert.equal(f.commits.at(-1).length, 8)
  assert.equal([...f.docs.keys()].filter(k => k.startsWith('range_sku_claims/')).length, 6)
  assert.equal(data(f.docs.get(`range_products/${first.body.range_id}`)).variants.length, 6)
  const retry = await f.call('create_mezuzah_range_design', input, { writesEnabled: true })
  assert.equal(retry.body.already_exists, true)
  assert.equal(f.commits.length, 2)
  const changed = await f.call('create_mezuzah_range_design', { ...input, acknowledge_warnings: [] }, { writesEnabled: true })
  assert.equal(changed.body.error.code, 'DUPLICATE_REQUEST')
})

test('component dry run verifies source provenance, requires reviewed component codes and writes nothing', async () => {
  const f = fixture()
  const ids = await identity('range_design', uuid, { item_codes: ITEM_CODES, acknowledge_warnings: ['COLOUR_CODE_NOT_IN_LIBRARY', 'PLATING_REVIEW', 'UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE'] })
  f.puts(`range_products/${ids.range_id}`, { ...designDraft(), mcp_creator_uid: RANGE_SERVICE_UID })
  const r = await f.call('prepare_mezuzah_range_components', { range_id: ids.range_id, dry_run: true })
  assert.equal(r.status, 200)
  assert.equal(r.body.blocked, true)
  assert.equal(r.body.proposed.metal.unit_cost, 11.3)
  assert.equal(r.body.proposed.metal.one_time_sample_mould, 2912)
  assert.equal(r.body.proposed.metal.screws_included, false)
  assert.equal(r.body.proposed.fabric.source_unit_cost, 8.1)
  assert.equal(r.body.proposed.fabric.working_unit_cost, 9)
  assert.equal(r.body.proposed.fabric.moq_per_colour, 100)
  assert.equal(r.body.proposed.records.length, 6)
  assert.equal(f.commits.length, 0)
})

test('component link and two quotes are atomic; retry is idempotent and keeps price out of range product', async () => {
  const f = fixture()
  const ids = await identity('range_design', uuid, { item_codes: ITEM_CODES, acknowledge_warnings: ['COLOUR_CODE_NOT_IN_LIBRARY', 'PLATING_REVIEW', 'UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE'] })
  f.puts(`range_products/${ids.range_id}`, { ...designDraft(), mcp_creator_uid: RANGE_SERVICE_UID })
  const input = { range_id: ids.range_id, metal_component_code: 'B0016-METAL', fabric_component_code: 'B0016-FABRIC', request_id: uuid, approved: true, dry_run: false }
  f.setFail(true)
  assert.equal((await f.call('create_mezuzah_range_components', input, { writesEnabled: true })).body.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(data(f.docs.get(`range_products/${ids.range_id}`)).critical_components, [])
  assert.equal([...f.docs.keys()].filter(k => k.startsWith('range_components/')).length, 0)
  f.setFail(false)
  const first = await f.call('create_mezuzah_range_components', input, { writesEnabled: true })
  assert.equal(first.status, 201)
  assert.equal(f.commits.at(-1).length, 6)
  const range = data(f.docs.get(`range_products/${ids.range_id}`))
  assert.equal(range.critical_components.length, 2)
  assert.equal(range.active, false)
  assert.equal(range.status, 'concept')
  assert.equal(range.variants.length, 6)
  assert.doesNotMatch(JSON.stringify(range), /unit_cost|supplier|tooling|62/)
  const metal = data(f.docs.get(`range_components/${first.body.component_ids[0]}`))
  const fabric = data(f.docs.get(`range_components/${first.body.component_ids[1]}`))
  const metalQuote = data(f.docs.get(`range_components/${first.body.component_ids[0]}/supplier_quotes/${first.body.quote_ids[0]}`))
  const fabricQuote = data(f.docs.get(`range_components/${first.body.component_ids[1]}/supplier_quotes/${first.body.quote_ids[1]}`))
  assert.equal(metal.unit_cost, 11.3)
  assert.equal(metal.tooling_sample_cost, 2912)
  assert.equal(fabric.unit_cost, 9)
  assert.equal(fabric.tooling_sample_cost, null)
  assert.equal(metalQuote.moq, 500)
  assert.equal(fabricQuote.moq, 100)
  assert.equal(fabricQuote.source_unit_cost, 8.1)
  assert.equal(fabricQuote.source_provenance.quote_id, SOURCE_PARTS.fabric.quote_id)
  const retry = await f.call('create_mezuzah_range_components', input, { writesEnabled: true })
  assert.equal(retry.body.already_exists, true)
  assert.equal(f.commits.length, 2)
  assert.equal((await f.call('create_mezuzah_range_components', { ...input, fabric_component_code: 'B0016-OTHER' }, { writesEnabled: true })).body.error.code, 'DUPLICATE_REQUEST')
})

test('component dry run rejects duplicate component code and changed source terms', async () => {
  const f = fixture()
  const ids = await identity('range_design', uuid, { item_codes: ITEM_CODES, acknowledge_warnings: [] })
  f.puts(`range_products/${ids.range_id}`, { ...designDraft(), mcp_creator_uid: RANGE_SERVICE_UID })
  f.puts('range_components/existing', { code: 'B0016-METAL' })
  const input = { range_id: ids.range_id, metal_component_code: 'B0016-METAL', fabric_component_code: 'B0016-FABRIC', dry_run: true }
  const duplicate = await f.call('prepare_mezuzah_range_components', input)
  assert.equal(duplicate.body.blocked, true)
  assert.deepEqual(duplicate.body.conflicts, [{ code: 'B0016-METAL', component_id: 'existing' }])
  assert.equal(f.commits.length, 0)
  const p = SOURCE_PARTS.fabric
  f.puts(`products/${SOURCE_PRODUCT_ID}/components/${p.component_id}/supplier_quotes/${p.quote_id}`, { supplier_id: p.supplier_id, unit_cost_currency: 'RMB', unit_cost: 12, moq: 100 })
  const changed = await f.call('prepare_mezuzah_range_components', input)
  assert.equal(changed.body.error.code, 'SOURCE_QUOTE_CHANGED')
})
