import assert from 'node:assert/strict'
import test from 'node:test'
import { hasValidCopy, previewIsStale, reviewState } from '../src/marketingCopyReview.js'

test('copy boundaries and genuinely empty text', () => {
  for (const copy of ['', '   ', 'x'.repeat(301)]) assert.equal(hasValidCopy(copy), false)
  assert.equal(hasValidCopy('x'.repeat(300)), true)
})
test('new arbitrary IDs and formerly excluded products are reviewed from current data', () => {
  assert.equal(reviewState({ id: 'mcp_new-product', marketing_description: '' }), 'pending')
  assert.equal(reviewState({ marketing_description: 'Existing valid copy' }), 'compliant')
})
test('legacy previews remain awaiting approval even when saved copy is compliant', () => {
  const p = { marketing_description: 'Current' }
  assert.equal(reviewState(p, { status: 'previewed', before: 'Current', after: 'New' }), 'awaiting')
  assert.equal(reviewState(p, { status: 'previewed', before: 'Current', approved: true }), 'approved')
})
test('failures are separate from pending approval and saved successes', () => {
  for (const status of ['preview_failed', 'write_failed']) assert.equal(reviewState({ marketing_description: 'Valid' }, { status }), 'failed')
  assert.equal(reviewState({}, { status: 'previewed', error: 'Rewrite failed' }), 'failed')
  assert.equal(reviewState({ marketing_description: 'New' }, { status: 'written', after: 'New' }), 'written')
})
test('external edits invalidate previews and stale saved progress cannot hide new problems', () => {
  assert.equal(previewIsStale({ marketing_description: 'Edited elsewhere' }, { status: 'previewed', before: 'Old' }), true)
  assert.equal(reviewState({ marketing_description: '' }, { status: 'written', after: 'Old' }), 'pending')
  assert.equal(reviewState({ marketing_description: 'Updated' }, { status: 'written', after: 'Old' }), 'compliant')
})
