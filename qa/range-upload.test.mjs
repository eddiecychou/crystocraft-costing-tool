import test from 'node:test'
import assert from 'node:assert/strict'
import { planRangeUpload, publicFamily, publicComponent, familyKey } from '../src/domain/rangeUpload.js'
import { coach, contextFixture } from './range-upload-fixtures.mjs'
const prepare = (input = coach(), ctx = contextFixture()) => planRangeUpload(input, ctx)
const has = (p, code) => [...p.conflicts, ...p.missing_facts].some(c => c.code === code)
function existing() {
  const p = prepare(), ctx = contextFixture()
  ctx.components.push(...p.new_components.map(c => ({...c,version:'frame1'})))
  ctx.products.push({ id: 'existing', version: 'v1', data: { ...p.patch, unknown_future_field: 'keep', plating_stock: { G: 18 }, gallery: [{ url: 'https://example.test/original.jpg', caption: 'Original' }], variants: p.patch.variants.map(v => ({ ...v, colour_images: { C1: 'https://example.test/latest.jpg' }, opaque: 42, ws_price_usd: 8.8 })) } })
  return ctx
}
test('coach is only a fixture: canonical code, overall cm, hidden Concept and null price; no full BOM or stock/cost defaults', () => {
  const p = prepare()
  assert.equal(p.safe_to_commit, true, JSON.stringify(p.missing_facts))
  assert.equal(p.proposed.size, '10.68 × 6.15 × 8.56 cm')
  assert.deepEqual(p.proposed.item_codes, ['D0606-001-GC1'])
  assert.equal(p.patch.variants[0].sku, 'D0606-001-G')
  assert.equal(p.patch.variants[0].ws_price_usd, null)
  assert.equal(p.patch.active, false); assert.equal(p.patch.status, 'concept')
  assert.equal(p.patch.critical_components.length, 3)
  assert.equal(p.new_components.length, 1)
  for (const k of ['stock_qty','lead_time_weeks','moq','unit_cost','supplierId','preferred_quote_id']) assert.equal(p.new_components[0].data[k], undefined)
  for (const k of ['moq','lead_time_weeks','plating_stock','costing_formula']) assert.equal(p.patch[k], undefined)
})
test('arbitrary other family and finish-specific chips; chips never become component or variant rows', () => {
  const input = coach(); input.family.design_no = '0888'; input.components = []
  input.variants = [{ brand_code: 'D', plating_code: 'G', crystal_colors: ['C1','BL'] }, { brand_code: 'D', plating_code: 'C', crystal_colors: ['RE'] }]
  const p = prepare(input)
  assert.equal(p.safe_to_commit, true); assert.equal(p.patch.variants.length, 2)
  assert.deepEqual(p.proposed.item_codes, ['D0888-001-GC1','D0888-001-GBL','D0888-001-CRE'])
  assert.equal(p.patch.critical_components.length, 0)
})
test('partial/missing dimensions need input; no partial measurement or unit inference', () => {
  for (const d of [undefined, { length: 106.8, width: 44.2, height: 85.6, unit: 'mm', overall_confirmed: false }, { length: 1, width: 2, height: 3, overall_confirmed: true }]) {
    const input = coach(); input.family.dimensions = d
    const p = prepare(input); assert.equal(p.safe_to_commit, false); assert.ok(p.missing_facts.length)
  }
})
test('invalid chips, unconfirmed new categories and non-offered platings are not substituted', () => {
  const input = coach(); input.variants[0].crystal_colors = ['NOT_REAL']
  assert.ok(has(prepare(input), 'INVALID_CHIP'))
  input.variants[0].crystal_colors = ['C1']; input.components = []; input.variants[0].plating_code = 'X'
  assert.ok(has(prepare(input), 'INVALID_PLATING'))
  input.variants[0].plating_code = 'G'; input.category_confirmations = []
  assert.ok(has(prepare(input), 'CONFIRM_NEW_CATEGORY'))
})
test('punctuation candidate requires stable exact ID/code confirmation; explicit missing component is not a name guess', () => {
  const input = coach(); input.components[1] = { create: { code: 'FM-GLB-H-G', name: 'Guess', category: 'Metal Part', plating_code: 'G' }, qty_per_unit: 1, applicability: 'auto', critical_reason: 'supply_risk' }
  assert.ok(has(prepare(input), 'PUNCTUATION_CONFIRMATION_REQUIRED'))
  input.components[1] = { ...coach().components[1], code: 'FM-GLB-H-G' }
  assert.ok(has(prepare(input), 'COMPONENT_ID_CODE_MISMATCH'))
  input.components = [{ ...coach().components[0], create: { code: 'NEW-PART', category: 'Metal Part', plating_code: 'G' } }]
  assert.ok(has(prepare(input), 'MISSING_COMPONENT_DEFINITION'))
})
test('always-needed shared parts and plating-specific Auto are distinct; mismatched finish is blocked', () => {
  const input = coach(); input.components = [{ component_id: 'shared', code: 'SHARED-BASE', qty_per_unit: 2, applicability: 'always', critical_reason: 'supply_risk' }]
  input.variants.push({ brand_code: 'D', plating_code: 'C', crystal_colors: ['BL'] })
  const p = prepare(input); assert.equal(p.safe_to_commit, true); assert.equal(p.patch.critical_components[0].all_variants, true)
  input.components = [{ ...coach().components[1], applicability: 'always' }]
  assert.ok(has(prepare(input), 'COMPONENT_FINISH_MISMATCH'))
})
test('existing family/full codes return conflict; stale corrections and identity changes are rejected', () => {
  const ctx = existing()
  assert.ok(has(prepare(coach(), ctx), 'FAMILY_EXISTS'))
  assert.throws(() => prepare({ mode: 'update', range_id: 'existing', expected_version: 'old', family: { design_name: 'New' }, dry_run: true }, ctx), e => e.code === 'STALE_VERSION')
  assert.throws(() => prepare({ mode: 'update', range_id: 'existing', expected_version: 'v1', family: { design_no: '9999' }, dry_run: true }, ctx), e => e.code === 'IDENTITY_CHANGE')
})
test('bounded variant correction preserves price, colour images, unknown fields, gallery and unrelated refs', () => {
  const ctx = existing(), p = prepare({ mode: 'update', range_id: 'existing', expected_version: 'v1', variants: [{ variant_id: 'v_0', crystal_colors: ['C1','BL'] }], dry_run: true }, ctx)
  assert.equal(p.safe_to_commit, true)
  assert.deepEqual(p.patch.variants[0].colour_images, { C1: 'https://example.test/latest.jpg' })
  assert.equal(p.patch.variants[0].opaque, 42); assert.equal(p.patch.variants[0].ws_price_usd, 8.8)
  for (const k of ['gallery','plating_stock','critical_components','unknown_future_field']) assert.equal(p.patch[k], undefined)
  assert.throws(() => prepare({ mode: 'update', range_id: 'existing', expected_version: 'v1', variants: [{ variant_id: 'unknown', crystal_colors: [] }], dry_run: true }, ctx), e => e.code === 'INVALID_VARIANT_ID')
})
test('writes have strict nested allowlists; stock, quotes, prices and activation cannot hide in a nested map', () => {
  for (const [target, field, value] of [['family','active',true],['family','status','active'],['family','moq',100],['variant','ws_price_usd',1],['variant','stock_finished',99],['component','unit_cost',1],['root','path','products/x']]) {
    const input = coach(); (target === 'root' ? input : target === 'variant' ? input.variants[0] : target === 'component' ? input.components[0].create : input.family)[field] = value
    assert.throws(() => prepare(input), e => e.code === 'UNSUPPORTED_FIELD')
  }
})
test('no local uploads or arbitrary external URLs; verified OC references append only', () => {
  const input = coach(); input.media = [{ source_range_id: 'source', url: 'http://127.0.0.1/private', caption: 'x' }]
  assert.throws(() => prepare(input), e => ['UNVERIFIED_MEDIA','INVALID_MEDIA'].includes(e.code))
  const ctx = contextFixture(), url = 'https://firebasestorage.googleapis.com/v0/b/crystocraft-costing.firebasestorage.app/o/range%2Fsource%2Fphoto.jpg?alt=media&token=fixture'
  ctx.products.push({ id: 'source', version: 's1', data: { design_no: '0777', format_code: '001', variants: [], gallery: [{ url, caption: 'Existing' }] } })
  input.media = [{ source_range_id: 'source', url, caption: 'Approved reference' }]
  const p = prepare(input, ctx); assert.equal(p.safe_to_commit, true); assert.equal(p.patch.gallery[0].caption, 'Approved reference')
})
test('readback redacts supplier/cost/private fields without mutating persisted records', () => {
  const ctx = existing(); ctx.products[0].data.supplier_notes = 'PRIVATE'
  const family = publicFamily(ctx.products[0]), comp = publicComponent(ctx.components[0])
  assert.equal(family.supplier_notes, undefined); assert.equal(comp.unit_cost, undefined); assert.equal(comp.preferred_supplier_name, undefined)
  assert.equal(ctx.components[0].data.unit_cost, 999)
})
test('invalid positive quantities, duplicate codes, path IDs and absent chip decisions fail closed', () => {
  const i = coach(); i.components[0].qty_per_unit = 0
  assert.throws(() => prepare(i), e => e.code === 'INVALID_QUANTITY')
  const j = coach(); j.variants.push({ ...j.variants[0] })
  assert.ok(has(prepare(j), 'DUPLICATE_ITEM_CODE'))
  assert.throws(() => familyKey({ design_no: '../bad', format_code: '001' }))
  const k = coach(); k.variants[0].crystal_colors = []
  assert.ok(has(prepare(k), 'CONFIRM_CRYSTAL_SELECTION'))
})

test('finish correction cannot silently detach an unmentioned critical part',()=>{
 const ctx=existing(),p=prepare({mode:'update',range_id:'existing',expected_version:'v1',variants:[{variant_id:'v_0',plating_code:'C'}],dry_run:true},ctx)
 assert.equal(p.safe_to_commit,false);assert.ok(has(p,'COMPONENT_FINISH_MISMATCH'))
})
