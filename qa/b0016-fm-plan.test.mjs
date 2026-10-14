import test from 'node:test'
import assert from 'node:assert/strict'
import { reviseB0016FmPlan, B0016_FM_FABRIC_CODES } from '../netlify/edge-functions/lib/b0016FmMigrationPlan.js'
import { identity, ITEM_CODES } from '../netlify/edge-functions/lib/mcpFigurineRange.js'
import { B0016_REUSE_ID } from '../netlify/edge-functions/lib/b0016ColourBom.js'
import { referenceHits } from '../scripts/audit-b0016-fm-migration.mjs'
import { readFileSync } from 'node:fs'

const baseline = JSON.parse(readFileSync(new URL('../docs/plans/B0016-FINAL-DRY-RUN-2026-10-14.json', import.meta.url)))
const clearAudit = () => ({ read_only: true, production_writes: 0, checked_at: '2026-10-14',
  legacy_c1: { exists: true, update_time: baseline.proposed.records[6].precondition_update_time, fields: { code: 'P-CF003-C1', unit_cost: null, stock_qty: null, reserved_qty: null }, child_counts: {} },
  references: [], reference_count: 0, exact_code_conflicts: [], limitations: ['Snapshot only'] })
test('FM plan uses all six exact codes, shared metal, same C1 ID and explicit rename, without mutating source', async () => {
  const before = JSON.stringify(baseline), p = await reviseB0016FmPlan(baseline, clearAudit(), identity)
  assert.equal(p.will_write, false); assert.equal(p.live_writes_enabled, false); assert.equal(p.blocked, true)
  assert.deepEqual(p.proposed.variant_mapping.map(v => v.fabric), B0016_FM_FABRIC_CODES)
  assert.deepEqual(p.proposed.variant_mapping.map(v => v.sku), ITEM_CODES)
  assert.ok(p.proposed.variant_mapping.every(v => v.metal === 'FM-B0016BY00-G'))
  assert.equal(p.proposed.critical_components[3].id, B0016_REUSE_ID)
  assert.equal(p.proposed.records[6].action, 'rename_code_and_cost_mirror_after_approval')
  assert.equal(p.proposed.records[6].fields.code, 'FM-CF003-C1')
  for (const key of ['name','stock_qty','reserved_qty','images','notes','createdAt']) assert.equal(p.proposed.records[6].fields[key], undefined)
  assert.equal(p.proposed.records.length, 16); assert.equal(p.proposed.new_components, 6)
  assert.equal(p.proposed.screws, false); assert.equal(p.proposed.price_publishing, false)
  assert.equal(JSON.stringify(baseline), before); assert.notEqual(p.request_hash, baseline.request_hash)
  assert.deepEqual(p.proposed.records.at(-1).fields.component_ids, p.proposed.critical_components.map(r => r.id))
  assert.deepEqual(p.proposed.records.find(r => r.path.startsWith('range_products/')).fields.critical_components, p.proposed.critical_components)
  for (let i = 0; i < 7; i++) {
    const c = p.proposed.records[i * 2], q = p.proposed.records[i * 2 + 1]
    assert.equal(c.fields.mcp_request_hash, p.request_hash); assert.equal(q.fields.mcp_request_hash, p.request_hash)
    assert.equal(c.fields.mcp_request_id, p.request_id); assert.equal(q.fields.mcp_request_id, p.request_id)
    assert.equal(q.path, `${c.path}/supplier_quotes/${c.fields.preferred_quote_id}`)
    assert.equal(q.fields.tooling_sample_cost, i ? null : 2912)
    assert.equal(q.fields.unit_cost, i ? 9 : 11.3)
    if (i) assert.equal(q.fields.source_unit_cost, 8.1)
  }
  assert.deepEqual(await reviseB0016FmPlan(baseline, clearAudit(), identity), p)
})
test('references, stock, quotes or used_by hint preserve legacy C1 and propose separate new FM C1', async () => {
  for (const condition of ['reference','quote','stock','hint','cost','stale']) {
    const a = clearAudit()
    if (condition === 'reference') { a.reference_count = 1; a.references = [{ path: 'range_products/another' }] }
    if (condition === 'quote') a.legacy_c1.child_counts.supplier_quotes = 1
    if (condition === 'stock') a.legacy_c1.fields.stock_qty = 1
    if (condition === 'hint') a.legacy_c1.fields.used_by = ['old design']
    if (condition === 'cost') a.legacy_c1.fields.unit_cost = 1
    if (condition === 'stale') a.legacy_c1.update_time = 'changed'
    const p = await reviseB0016FmPlan(baseline, a, identity)
    assert.equal(p.migration.action, 'preserve_legacy_create_separate_after_approval')
    assert.equal(p.proposed.new_components, 7); assert.equal(p.proposed.reused_components, 0)
    assert.ok(p.proposed.records.every(r => r.path !== `range_components/${B0016_REUSE_ID}`))
    assert.equal(p.proposed.records[6].fields.code, 'FM-CF003-C1')
    assert.equal(p.proposed.records[6].action, 'create')
  }
})
test('existing FM codes block approval; non-dry input or untrusted audit fails', async () => {
  const a = clearAudit(); a.exact_code_conflicts = [{ path: 'range_components/other', code: 'FM-CF003-C1' }]
  const p = await reviseB0016FmPlan(baseline, a, identity)
  assert.equal(p.conflicts[0].reason, 'EXISTING_COMPONENT_CODE'); assert.equal(p.blocked, true)
  await assert.rejects(reviseB0016FmPlan({ ...baseline, will_write: true }, a, identity), /DRY_RUN_REQUIRED/)
  await assert.rejects(reviseB0016FmPlan(baseline, { ...a, production_writes: 1 }, identity), /USAGE_AUDIT_REQUIRED/)
})
test('downstream scan detects code-only BOMs, ID links, PO/order snapshots and nested private plans', () => {
  const hits = referenceHits({ critical_components: [{ code: 'p-cf003-c1' }], lines: [{ linked: { component_id: B0016_REUSE_ID } }],
    component_lines: [{ component_id: B0016_REUSE_ID, code: 'P-CF003-C1' }], components: { other: { code: 'P-CF003-C1' } } })
  assert.equal(hits.length, 5)
  assert.deepEqual(referenceHits({ component_id: 'other', code: 'P-CF002-C1' }), [])
})
