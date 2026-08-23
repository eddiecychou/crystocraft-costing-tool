// Draft Memory Layer (V8.9) — folds Eddie's confirmed writing rules, a
// contact's short relationship summary, and the last few rewrite
// conclusions into the Daily Drafts prompts (draft-outreach-topic.js,
// discuss-outreach-draft.js, generate-outreach-drafts.js).
//
// Deliberately NOT conversation replay and NOT a vector store — the client
// (domain/draftMemoryRules.js, domain/marketingContact.js) already fetched
// and capped this data from Firestore before calling the edge function; this
// module's only job is formatting AND a hard, server-side word-cap as a cost
// backstop independent of whatever the client sent. Nothing here reads
// Firestore itself — these are Deno edge functions with no Admin SDK, and
// the caller already has an admin-scoped read of the same collections.
//
// Truncation order when the ~250-word budget is exceeded: drop oldest
// rewrite conclusions first, then excess global rules (keep the most
// recently approved), then hard-slice the contact summary. Global rules are
// dropped last because they're the whole point of this feature — the thing
// Eddie is tired of repeating.
const MAX_TOTAL_WORDS = 250
const MAX_RULES = 8
const MAX_CONCLUSIONS = 5
const MAX_SUMMARY_WORDS = 120

const words = s => String(s || '').trim().split(/\s+/).filter(Boolean)
const capWords = (s, n) => words(s).slice(0, n).join(' ')

export function buildMemoryBlock({ globalRules = [], contactSummary = '', recentConclusions = [] } = {}) {
  let rules = globalRules.filter(Boolean).slice(0, MAX_RULES)
  let conclusions = recentConclusions.filter(Boolean).slice(-MAX_CONCLUSIONS)
  let summary = capWords(contactSummary, MAX_SUMMARY_WORDS)

  const render = () => {
    const parts = []
    if (rules.length) parts.push(`Standing writing rules (always follow these):\n${rules.map(r => `- ${r}`).join('\n')}`)
    if (summary) parts.push(`What we know about this contact:\n${summary}`)
    if (conclusions.length) parts.push(`Recent conclusions from correcting this contact's drafts:\n${conclusions.map(c => `- ${c}`).join('\n')}`)
    return parts.join('\n\n')
  }

  let block = render()
  // Cost backstop: trim in the stated priority order until under budget,
  // regardless of what the caller sent.
  while (words(block).length > MAX_TOTAL_WORDS && (conclusions.length || rules.length > 1 || summary)) {
    if (conclusions.length) { conclusions = conclusions.slice(1); block = render(); continue }
    if (words(block).length > MAX_TOTAL_WORDS && summary) { summary = capWords(summary, Math.max(0, words(summary).length - 20)); block = render(); continue }
    if (rules.length > 1) { rules = rules.slice(0, -1); block = render(); continue }
    break
  }
  if (words(block).length > MAX_TOTAL_WORDS) block = capWords(block, MAX_TOTAL_WORDS)
  return block
}
