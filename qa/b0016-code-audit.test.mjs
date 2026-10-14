import test from 'node:test'
import assert from 'node:assert/strict'
import { auditSnapshot } from '../scripts/audit-b0016-range-codes.mjs'
import { designDraft, ITEM_CODES } from '../netlify/edge-functions/lib/mcpFigurineRange.js'

test('read-only audit finds legacy SKU collisions even on a differently numbered design', () => {
  const legacy = { id: 'other-design', design_no: '9999', variants: [{ sku: ITEM_CODES[0] }] }
  const result = auditSnapshot([legacy], [], [], [])
  assert.deepEqual(result.sku_conflicts, [{ item_code: ITEM_CODES[0], range_id: 'other-design' }])
  assert.equal(result.clear_for_review, false)
})

test('orphaned and mismatched claims are distinct blockers', () => {
  const design = { ...designDraft(), id: 'correct-design' }
  const claims = [
    { id: ITEM_CODES[0], item_code: ITEM_CODES[0], range_id: 'missing-design' },
    { id: ITEM_CODES[1], item_code: 'WRONG', range_id: 'correct-design' },
  ]
  const result = auditSnapshot([design], claims, [], [])
  assert.equal(result.claim_issues.length, 2)
  assert.equal(result.clear_for_review, false)
})

test('component codes require exact reviewed input and all-catalogue collision scan', () => {
  const collided = auditSnapshot([], [], [{ id: 'old', code: 'B0016-METAL' }], ['B0016-METAL', 'B0016-FABRIC'])
  assert.deepEqual(collided.component_conflicts, [{ code: 'B0016-METAL', component_id: 'old' }])
  assert.equal(collided.clear_for_review, false)
  const clear = auditSnapshot([], [], [], ['B0016-METAL', 'B0016-FABRIC'])
  assert.equal(clear.clear_for_review, true)
})
