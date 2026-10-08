import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JEV_MARKETING_TAG_BATCH_SIZE,
  normalizeTagInputs,
  buildMarketingTagQuestions,
  sanitizeMarketingTagAnswers,
  needsDeepSeekReview,
  sanitizeDeepSeekTagSuggestions,
  buildDeepSeekVerificationQuestions,
  mergeCascadeResults,
} from '../netlify/edge-functions/lib/jevMarketingTags.js'
import { buildMarketingTagContextRows, normalizeTagReviewDecision, proposedReviewAction } from '../src/marketingTagCleanup.js'

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria })

test('normalizes, deduplicates, validates and caps tag inputs', () => {
  const many = Array.from({ length: JEV_MARKETING_TAG_BATCH_SIZE + 5 }, (_, i) => ({ tag: ` tag ${i} `, count: `${i}` }))
  many.splice(1, 0, { tag: 'tag 0', count: 99 }, { tag: '', count: 3 })
  const tags = normalizeTagInputs(many)
  assert.equal(tags.length, JEV_MARKETING_TAG_BATCH_SIZE)
  assert.deepEqual(tags[0], {
    tag: 'tag 0', count: 0,
    context: { sampleCompanies: [], countries: [], coTags: [], audiences: [], statuses: [], linkedCustomers: 0 },
  })
  assert.equal(tags.filter(item => item.tag === 'tag 0').length, 1)
})

test('builds three isolated typed questions per tag', () => {
  const questions = buildMarketingTagQuestions([{ tag: 'Corp Gifts', count: 4 }, { tag: 'HK', count: 2 }], { choice })
  assert.equal(Object.keys(questions).length, 6)
  assert.equal(questions.kind_0.type, 'choice')
  assert.ok(questions.canonical_0.criteria['corp gift'])
  assert.ok(questions.canonical_0.criteria.none)
})

test('sanitizes unknown output and only recommends buyer canonical tags', () => {
  const tags = [{ tag: 'Corp Gifts', count: 4 }, { tag: 'Hong Kong', count: 8 }]
  const answers = {
    kind_0: { choice: 'buyer_type', confidence: 0.96 },
    action_0: { choice: 'keep', confidence: 0.7 },
    canonical_0: { choice: 'corp gift', confidence: 0.93 },
    kind_1: { choice: 'geography', confidence: 0.99 },
    action_1: { choice: 'invented', confidence: 7 },
    canonical_1: { choice: 'retailer', confidence: 0.99 },
  }
  const results = sanitizeMarketingTagAnswers(tags, answers)
  assert.deepEqual(results[0], {
    tag: 'Corp Gifts', count: 4, kind: 'buyer_type', kindConfidence: 0.96,
    action: 'normalize', actionConfidence: 0.7, canonical: 'corp gift', canonicalConfidence: 0.93,
  })
  assert.equal(results[1].canonical, null)
  assert.equal(results[1].action, 'review')
  assert.equal(results[1].actionConfidence, 1)
})

test('builds bounded business context without contact identity or email', () => {
  const rows = buildMarketingTagContextRows([
    { id: 'private-1', email: 'hidden@example.com', company: 'Alpha', country: 'Hong Kong', tags: ['nda', 'corp gift'], audiences: ['trade'], status: 'subscribed', is_customer: true },
    { id: 'private-2', email: 'also-hidden@example.com', company: 'Beta', country: 'Hong Kong', tags: ['nda', 'finance'], audiences: ['trade'], status: 'subscribed' },
  ])
  const nda = rows.find(row => row.tag === 'nda')
  assert.equal(nda.count, 2)
  assert.deepEqual(nda.context.sampleCompanies, ['Alpha', 'Beta'])
  assert.deepEqual(nda.context.coTags, ['corp gift', 'finance'])
  assert.equal(nda.context.linkedCustomers, 1)
  assert.equal(JSON.stringify(nda).includes('hidden@example.com'), false)
  assert.equal(JSON.stringify(nda).includes('private-1'), false)
})

test('review decisions default to skip and validate renames deterministically', () => {
  assert.equal(normalizeTagReviewDecision({ tag: 'nda' }).decision.action, 'skip')
  assert.equal(normalizeTagReviewDecision({ tag: 'NDA', action: 'rename', target: 'nda' }).valid, false)
  const merge = normalizeTagReviewDecision({ tag: 'union metal distributor', action: 'rename', target: 'Distributor' }, ['distributor'])
  assert.equal(merge.valid, true)
  assert.equal(merge.decision.mergesExisting, true)
  assert.deepEqual(proposedReviewAction({ action: 'removal_candidate' }), { action: 'remove', target: '' })
})

test('routes ambiguous rows through DeepSeek and sanitizes its output', () => {
  const unresolved = [{
    tag: 'JES ACTIVE', count: 9, kind: 'internal_legacy', kindConfidence: 0.9,
    action: 'review', actionConfidence: 0.8, canonical: null, canonicalConfidence: 0.2,
  }]
  assert.equal(needsDeepSeekReview(unresolved[0]), true)
  const suggestions = sanitizeDeepSeekTagSuggestions([
    { tag: 'JES ACTIVE', interpretation: 'Legacy active-customer marker', action: 'normalize', canonical: 'made up', reason: 'Old JES label' },
    { tag: 'invented', action: 'remove' },
  ], unresolved)
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].canonical, null)
  assert.equal(suggestions[0].action, 'normalize')
})

test('requires JEV agreement before a DeepSeek proposal avoids human review', () => {
  const rows = [{
    tag: 'Corp Gifts', count: 4, kind: 'buyer_type', kindConfidence: 0.8,
    action: 'review', actionConfidence: 0.5, canonical: null, canonicalConfidence: 0.4,
  }]
  const suggestions = [{ tag: 'Corp Gifts', interpretation: 'Corporate gift buyer', action: 'normalize', canonical: 'corp gift', reason: 'Plural variant' }]
  const questions = buildDeepSeekVerificationQuestions(suggestions, { noul: (instructions, criteria) => ({ instructions, criteria }) })
  assert.equal(Object.keys(questions).length, 1)
  assert.equal(mergeCascadeResults(rows, suggestions, { proposal_0: { noul: 0.91 } })[0].needsHumanReview, false)
  assert.equal(mergeCascadeResults(rows, suggestions, { proposal_0: { noul: 0.62 } })[0].resolution, 'human_review')
})
