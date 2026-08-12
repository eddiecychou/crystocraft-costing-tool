// V8.1 email ingestion, Phase 2 — client for the two AI edge functions
// CustomerDetail.jsx's Email Summary card and "Discover more" chat use.
// Firestore reads (customers/{id}/email_threads) and the email_summary write
// happen directly in CustomerDetail.jsx via the SDK, same split every other
// AI feature in this app uses — these functions only talk to DeepSeek.
import { authedUser } from './firebase'

async function authedPost(path, body) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export async function refreshEmailSummary(threadsText) {
  return authedPost('/api/refresh-email-summary', { threadsText })
}

export async function discussCustomerEmail(threadsText, history, message) {
  return authedPost('/api/discuss-customer-email', { threadsText, history, message })
}

// Reduce step (added 2026-08-12) — see buildSearchFacets()/the map-reduce
// rewrite below. Combines several partial answers (each from its own
// independent facet — one person, one time range — with a full context
// budget) into one coherent reply. Only ever sees short answers, never raw
// thread text, so this call stays small regardless of how much history the
// facets themselves scanned.
export async function composeEmailAnswer(question, partials) {
  return authedPost('/api/compose-email-answer', { question, partials })
}

// Year-routing (added 2026-08-12) — for a high-volume customer, ask which
// year(s) a question is actually about BEFORE fetching content, so
// "what's the earliest order" or "what happened in 2020" can pull that
// specific year's threads instead of whatever a blind recency/oldest split
// happened to include. Only ever sends thread COUNTS, never content — see
// route-email-question.js.
export async function routeEmailQuestion(yearIndex, question) {
  const { years } = await authedPost('/api/route-email-question', { yearIndex, question })
  return Array.isArray(years) ? years : []
}

// customers/{id}/email_threads docs -> one text block, same rendering shape
// the Phase 1 spike (email-spike/summarize.py) and email-sync/sync.py's data
// use, so the model sees the same kind of input either way.
//
// Char-capped (roughly matching refresh-email-summary.js's/discuss-customer-
// email.js's own MAX_INPUT_CHARS) — found live 2026-08-12: a customer with
// hundreds of ingested threads (Widdop, 786 after the PST/mbox backfill) had
// no cap at all here, building a multi-megabyte request body that failed
// silently as "DeepSeek did not return a usable reply" (the real failure —
// an oversized POST — was several layers removed from that generic
// message).
//
// A pure "most recent first, stop at budget" cap (the original fix) then
// hit a second real problem the same day: it made "what's the earliest
// order" / "any older history" questions on a high-volume customer
// unanswerable — that data was never sent to the model at all, only the
// newest slice was. This is real retrieval's job (embeddings/vector search
// — see PROJECT-PLAN.md's V8.1 entry, explicitly not built this cycle), but
// a cheap partial fix that doesn't need that infrastructure: split the
// budget between the newest AND oldest threads on file, so both directions
// of "when" question have SOMETHING to answer from, clearly labeled so the
// model doesn't assume the two sections are contiguous (there is very
// likely a real gap in between that never made it into context).
// Slightly under the edge functions' own MAX_INPUT_CHARS (60000) — leaves
// room for the section labels below so the server's own blind
// `.slice(0, MAX_INPUT_CHARS)` safety net never lands mid-label or chops
// the tail off the "earliest threads" section.
const MAX_OUTPUT_CHARS = 58500
const RECENT_SHARE = 0.6 // rest goes to the oldest-on-file section

function threadYear(t) {
  const d = t.date_range?.[1] || t.date_range?.[0]
  if (!d) return null
  const y = new Date(d).getFullYear()
  return Number.isNaN(y) ? null : y
}

// Compact "2018: 12, 2019: 45, ..." index for route-email-question.js —
// counts only, never content, so the routing call stays tiny regardless of
// how much history a customer has.
export function buildYearIndex(threads) {
  const counts = {}
  for (const t of threads) {
    const y = threadYear(t)
    if (y == null) continue
    counts[y] = (counts[y] || 0) + 1
  }
  return Object.keys(counts).sort().map(y => `${y}: ${counts[y]} thread(s)`).join(', ')
}

// Once route-email-question.js has picked year(s), render just those
// threads (still capped, in case one year alone is large) instead of the
// general recent+oldest mix — much more targeted for a "when" question.
export function renderThreadsTextForYears(threads, years) {
  const yearSet = new Set(years)
  const filtered = threads.filter(t => yearSet.has(threadYear(t)))
  const chunks = []
  let total = 0
  for (const t of filtered) {
    const block = threadBlock(t)
    if (total + block.length > MAX_OUTPUT_CHARS) break
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n')
}

// Local keyword/name search (added 2026-08-12, no API call) — year-routing
// only helps a "when" question. "When did I last contact Stephen" or "did I
// email Stephen before 2024" has no year to route on for the FIRST part of
// the question, so it fell back to the general recent+oldest split, which
// for a high-volume customer misses everything in the middle — confirmed
// live: real correspondence with a contact ("stephen@widdop.co.uk", matched
// 9+ times during ingestion) came back as "no direct correspondence found"
// because it simply wasn't in the 60% recent / 40% oldest slice sent.
// This is a genuinely cheap, deterministic alternative to real retrieval
// for name/keyword-shaped questions: search ALL loaded threads (already in
// the browser) for the question's content words in participants/subject/
// body, and prioritize matches over pure recency.
const STOPWORDS = new Set([
  'when', 'did', 'the', 'and', 'with', 'from', 'that', 'this', 'have', 'were',
  'been', 'what', 'who', 'how', 'many', 'order', 'orders', 'email', 'emails',
  'contact', 'contacted', 'before', 'after', 'about', 'their', 'they', 'them',
  'said', 'tell', 'list', 'last', 'first', 'earliest', 'recent', 'does', 'was',
  'are', 'for', 'you', 'your', 'all', 'any', 'not', 'has', 'our', 'out',
  // Generic verbs/fillers found live to slip past the doc-frequency filter
  // (low enough occurrence to look "specific" without actually being
  // about anything) — "did widdop PLACE any order" pulled in an
  // unrelated 13%-of-threads slice via "place" alone.
  'place', 'placed', 'make', 'made', 'get', 'got', 'know', 'see', 'seen',
  'much', 'more', 'still', 'also', 'just', 'like', 'speak', 'spoke', 'talk',
  'talked', 'discuss', 'discussed', 'mention', 'mentioned', 'regard', 'regarding',
])

// Order/PO/SO codes (PO50081, SP505, SO210112, WD26002048, ...) never
// matched at all before — the word regex is letters-only, so any token
// containing a digit was silently dropped. These are exactly the concrete
// identifiers real business questions use ("what happened with PO50081"),
// so they need their own pattern: a run of 3+ digits, optionally with a
// short letter prefix/suffix (covers a bare order number like "56909" too).
const CODE_RE = /\b[a-z]*\d{3,}[a-z0-9]*\b/gi
const WORD_RE = /[a-z][a-z'-]{2,}/g

function extractKeywords(question) {
  const q = question.toLowerCase()
  const words = q.match(WORD_RE) || []
  const codes = q.match(CODE_RE) || []
  return [...new Set([...words, ...codes])].filter(w => !STOPWORDS.has(w))
}

function threadHay(t) {
  return (
    `${t.subject || ''} ` +
    (t.messages || []).map(m => `${m.from || ''} ${m.to || ''} ${m.cc || ''} ${m.body_text || ''}`).join(' ')
  ).toLowerCase()
}

// Renders one facet's own matches with a FULL (not divided) budget, using
// the recent+oldest split so "earliest" questions have a real chance of
// reaching the true earliest match within this facet specifically.
function renderFacetThreads(matches, budget) {
  const recentShare = Math.floor(budget * RECENT_SHARE)
  const oldestShare = budget - recentShare
  const used = new Set()

  const recentChunks = []
  let recentTotal = 0
  for (const t of matches) { // most-recent-first, inherited from `threads`
    const block = threadBlock(t)
    if (recentTotal + block.length > recentShare) break
    recentChunks.push(block)
    recentTotal += block.length
    used.add(t)
  }
  const oldestChunks = []
  let oldestTotal = 0
  for (let i = matches.length - 1; i >= 0; i--) {
    const t = matches[i]
    if (used.has(t)) continue
    const block = threadBlock(t)
    if (oldestTotal + block.length > oldestShare) break
    oldestChunks.push(block)
    oldestTotal += block.length
    used.add(t)
  }
  oldestChunks.reverse()
  if (!recentChunks.length && !oldestChunks.length) return ''
  const gapNote = oldestChunks.length
    ? '\n(There may be a real gap between the two groups below that is not included here.)'
    : ''
  return `${gapNote}${recentChunks.join('\n')}${oldestChunks.join('\n')}`
}

// Map-reduce facet decomposition (added 2026-08-12, owner's suggestion) —
// the previous version divided ONE shared budget across every keyword
// found, which meant a multi-name question ("who is diane and karen")
// could still starve a name of its fair share once enough OTHER facets
// were in play, and any single facet's own budget stayed a fraction of
// what one focused DeepSeek call could actually use. Instead: each facet
// (each surviving keyword, plus the routed year range if any — see
// CustomerDetail.jsx's handleEmailChatSend) gets rendered with the FULL
// MAX_OUTPUT_CHARS budget on its own and answered by its OWN DeepSeek call
// (run in parallel); composeEmailAnswer() then merges the short partial
// answers into one reply. No single call ever sees more than one facet's
// worth of content, so this scales to as many named people/time ranges as
// the question mentions without any of them needing to share a shrinking
// budget — and the final reduce call only ever handles a handful of short
// answers, never raw thread text, regardless of how much was scanned.
export function buildKeywordFacets(threads, question) {
  let keywords = extractKeywords(question)
  if (!keywords.length) return []

  const hays = threads.map(threadHay)

  // Drop any keyword that's too common to be discriminating — confirmed
  // live: "did widdop place any order in 2020" extracted "widdop" (the
  // customer's own name, ~100% by construction — every matched thread has
  // a widdop.co.uk address in From/To) as a keyword, drowning out
  // everything else. 0.75 still excludes an own-domain word while letting
  // a genuinely prolific real contact (confirmed: 47.6% for one) through.
  const DOC_FREQ_LIMIT = 0.75
  keywords = keywords.filter(k => hays.filter(h => h.includes(k)).length / hays.length <= DOC_FREQ_LIMIT)

  const facets = []
  for (const k of keywords) {
    const matches = threads.filter((t, i) => hays[i].includes(k))
    const text = renderFacetThreads(matches, MAX_OUTPUT_CHARS)
    if (text) facets.push({ label: k, threadsText: `\n########## THREADS MENTIONING "${k}" ##########${text}` })
  }
  return facets
}

function threadBlock(t) {
  const header = `\n=== Thread: ${t.subject || '(no subject)'} (${t.message_count || (t.messages || []).length} messages) ===`
  const body = (t.messages || []).map(m =>
    `--- ${m.date || ''} | From: ${m.from || ''} | To: ${m.to || ''} ---\n${(m.body_text || '').trim()}`
  ).join('\n')
  return `${header}\n${body}`
}

// `threads` arrives most-recent-first (CustomerDetail.jsx's sort).
export function renderThreadsText(threads) {
  const recentBudget = Math.floor(MAX_OUTPUT_CHARS * RECENT_SHARE)
  const oldestBudget = MAX_OUTPUT_CHARS - recentBudget

  const used = new Set()
  const recentChunks = []
  let recentTotal = 0
  for (const t of threads) {
    const block = threadBlock(t)
    if (recentTotal + block.length > recentBudget) break
    recentChunks.push(block)
    recentTotal += block.length
    used.add(t)
  }

  const oldestChunks = []
  let oldestTotal = 0
  for (let i = threads.length - 1; i >= 0; i--) {
    const t = threads[i]
    if (used.has(t)) continue
    const block = threadBlock(t)
    if (oldestTotal + block.length > oldestBudget) break
    oldestChunks.push(block)
    oldestTotal += block.length
    used.add(t)
  }
  oldestChunks.reverse() // chronological within this section (oldest first)

  const parts = []
  if (recentChunks.length) {
    parts.push(`\n########## MOST RECENT THREADS ##########${recentChunks.join('\n')}`)
  }
  if (oldestChunks.length) {
    parts.push(
      '\n########## EARLIEST THREADS ON FILE ##########\n' +
      '(There is very likely a real gap in time between this section and the "most recent" ' +
      'section above that is not included here — do not assume these two sections are contiguous.)' +
      oldestChunks.join('\n')
    )
  }
  return parts.join('\n')
}
