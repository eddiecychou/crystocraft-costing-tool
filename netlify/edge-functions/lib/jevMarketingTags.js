// Stable provider alias. The response reports the concrete model release that
// actually handled the request, so the UI remains auditable without pinning a
// release that may disappear from the account's available-model list.
export const JEV_MARKETING_TAG_MODEL = 'jev-latest'
export const JEV_MARKETING_TAG_BATCH_SIZE = 30

export const MARKETING_TAG_KINDS = {
  buyer_type: 'The tag describes what kind of buyer or business the contact is.',
  geography: 'The tag describes a country, city, territory, region, or market.',
  product_interest: 'The tag describes a product family or merchandise interest.',
  relationship: 'The tag describes relationship status, customer value, or sales stage.',
  source: 'The tag describes where the contact or lead came from.',
  campaign: 'The tag names a campaign, event, fair, list, or temporary outreach segment.',
  internal_legacy: 'The tag is an internal system/import marker or legacy operational label.',
  other: 'The tag does not clearly fit any of the other categories.',
}

export const MARKETING_TAG_ACTIONS = {
  keep: 'A useful, understandable tag that should remain available.',
  normalize: 'A useful idea, but the wording should be mapped to an approved canonical buyer tag.',
  review: 'Ambiguous, mixed-purpose, overly specific, or needs a person to decide.',
  removal_candidate: 'Likely obsolete, meaningless, temporary, or redundant metadata; flag for review, never delete automatically.',
}

export const CANONICAL_BUYER_TAGS = [
  'distributor', 'large retailer', 'retailer', 'oem', 'corp gift',
  'wholesaler', 'trophy', 'jewelry', 'glassware', 'home decor', 'wedding', 'licensing',
]

export const DEEPSEEK_TAG_ACTIONS = new Set(['keep', 'normalize', 'review', 'removal_candidate'])

const canonicalCriteria = Object.fromEntries([
  ...CANONICAL_BUYER_TAGS.map(tag => [tag, `Use only when the tag clearly means the buyer type “${tag}”.`]),
  ['none', 'The tag is not equivalent to any approved buyer-type tag above.'],
])

export function normalizeTagInputs(rawTags) {
  if (!Array.isArray(rawTags)) return []
  const seen = new Set()
  return rawTags
    .map(item => ({
      tag: String(item?.tag ?? '').trim(),
      count: Math.max(0, Math.trunc(Number(item?.count) || 0)),
      context: sanitizeTagContext(item?.context),
    }))
    .filter(item => item.tag && item.tag.length <= 120 && !seen.has(item.tag) && seen.add(item.tag))
    .slice(0, JEV_MARKETING_TAG_BATCH_SIZE)
}

const boundedStrings = (value, limit, maxLength = 80) => (Array.isArray(value) ? value : [])
  .map(item => String(item || '').trim().slice(0, maxLength))
  .filter(Boolean)
  .slice(0, limit)

function sanitizeTagContext(raw) {
  return {
    sampleCompanies: boundedStrings(raw?.sampleCompanies, 5, 100),
    countries: boundedStrings(raw?.countries, 6),
    coTags: boundedStrings(raw?.coTags, 8),
    audiences: boundedStrings(raw?.audiences, 4),
    statuses: boundedStrings(raw?.statuses, 4),
    linkedCustomers: Math.max(0, Math.trunc(Number(raw?.linkedCustomers) || 0)),
  }
}

export function buildMarketingTagQuestions(tags, { choice }) {
  const questions = {}
  tags.forEach((item, index) => {
    questions[`kind_${index}`] = choice(
      `What single kind of CRM tag is tags[${index}].tag? Classify the meaning of the tag itself, not the contact count.`,
      MARKETING_TAG_KINDS,
    )
    questions[`action_${index}`] = choice(
      `What should a human reviewer consider doing with tags[${index}].tag? Be conservative. “Removal candidate” only means review it for removal; never assume it will be deleted.`,
      MARKETING_TAG_ACTIONS,
    )
    questions[`canonical_${index}`] = choice(
      `Which approved buyer-type tag is semantically equivalent to tags[${index}].tag? Choose “none” unless it clearly means the same buyer type. Related concepts are not equivalent.`,
      canonicalCriteria,
    )
  })
  return questions
}

const safeChoice = (answer, allowed, fallback) => {
  const value = String(answer?.choice || '')
  return Object.hasOwn(allowed, value) ? value : fallback
}

const safeConfidence = answer => {
  const value = Number(answer?.confidence)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export function sanitizeMarketingTagAnswers(tags, answers = {}) {
  return tags.map((item, index) => {
    const kindAnswer = answers[`kind_${index}`]
    const actionAnswer = answers[`action_${index}`]
    const canonicalAnswer = answers[`canonical_${index}`]
    const kind = safeChoice(kindAnswer, MARKETING_TAG_KINDS, 'other')
    let action = safeChoice(actionAnswer, MARKETING_TAG_ACTIONS, 'review')
    let canonical = safeChoice(canonicalAnswer, canonicalCriteria, 'none')
    const canonicalConfidence = safeConfidence(canonicalAnswer)

    // A canonical buyer tag is only meaningful for a buyer-type classification.
    // Keep uncertain or cross-category mappings visible for review, never as a
    // confident normalization recommendation.
    if (kind !== 'buyer_type') canonical = 'none'
    if (canonical !== 'none' && canonical !== item.tag.toLowerCase() && canonicalConfidence >= 0.6) {
      action = 'normalize'
    }

    return {
      ...item,
      kind,
      kindConfidence: safeConfidence(kindAnswer),
      action,
      actionConfidence: safeConfidence(actionAnswer),
      canonical: canonical === 'none' ? null : canonical,
      canonicalConfidence,
    }
  })
}

export function needsDeepSeekReview(row) {
  return row.kind === 'other' ||
    row.action === 'review' ||
    row.action === 'removal_candidate' ||
    (row.kind === 'buyer_type' && !row.canonical) ||
    Math.max(row.kindConfidence, row.actionConfidence) < 0.72
}

export function sanitizeDeepSeekTagSuggestions(rawSuggestions, unresolvedRows) {
  const rowByTag = new Map(unresolvedRows.map(row => [row.tag, row]))
  const allowedCanonical = new Set([
    ...CANONICAL_BUYER_TAGS,
    ...unresolvedRows.map(row => row.tag.toLowerCase()),
  ])
  const seen = new Set()

  return (Array.isArray(rawSuggestions) ? rawSuggestions : [])
    .map(item => {
      const tag = String(item?.tag || '').trim()
      if (!rowByTag.has(tag) || seen.has(tag)) return null
      seen.add(tag)
      const action = DEEPSEEK_TAG_ACTIONS.has(item?.action) ? item.action : 'review'
      const rawCanonical = String(item?.canonical || '').trim().toLowerCase()
      return {
        tag,
        interpretation: String(item?.interpretation || '').trim().slice(0, 240),
        action,
        canonical: allowedCanonical.has(rawCanonical) && rawCanonical !== tag.toLowerCase() ? rawCanonical : null,
        reason: String(item?.reason || '').trim().slice(0, 320),
      }
    })
    .filter(Boolean)
}

export function buildDeepSeekVerificationQuestions(suggestions, { noul }) {
  return Object.fromEntries(suggestions.map((suggestion, index) => [
    `proposal_${index}`,
    noul(
      `Is suggestions[${index}] a well-supported, conservative interpretation and cleanup recommendation for this CRM tag, given its supplied usage context? The canonical mapping must mean the same thing, not merely be related.`,
      {
        true: 'The interpretation is plausible and the proposed action/canonical mapping is conservative and semantically equivalent.',
        false: 'The interpretation is uncertain, the action is too aggressive, or the canonical mapping is only related rather than equivalent.',
      },
    ),
  ]))
}

export function mergeCascadeResults(primaryRows, suggestions, verificationAnswers = {}) {
  const suggestionByTag = new Map(suggestions.map((suggestion, index) => [suggestion.tag, { suggestion, index }]))
  return primaryRows.map(row => {
    const match = suggestionByTag.get(row.tag)
    if (!match) return { ...row, resolution: 'jev', needsHumanReview: needsDeepSeekReview(row) }
    const probability = Number(verificationAnswers[`proposal_${match.index}`]?.noul)
    const jevAgreement = Number.isFinite(probability) ? Math.max(0, Math.min(1, probability)) : 0
    const machineResolved = jevAgreement >= 0.8
    return {
      ...row,
      deepseek: match.suggestion,
      jevAgreement,
      resolution: machineResolved ? 'jev_deepseek_agree' : 'human_review',
      needsHumanReview: !machineResolved,
    }
  })
}
