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
])

function extractKeywords(question) {
  return [...new Set((question.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOPWORDS.has(w)))]
}

function threadKeywordScore(t, keywords) {
  const hay = (
    `${t.subject || ''} ` +
    (t.messages || []).map(m => `${m.from || ''} ${m.to || ''} ${m.cc || ''} ${m.body_text || ''}`).join(' ')
  ).toLowerCase()
  return keywords.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0)
}

// Returns '' if the question has no useful keywords or nothing matches —
// caller falls through to year-routing/the general split in that case.
export function renderThreadsTextByKeyword(threads, question) {
  const keywords = extractKeywords(question)
  if (!keywords.length) return ''
  const scored = threads
    .map(t => ({ t, score: threadKeywordScore(t, keywords) }))
    .filter(x => x.score > 0)
  if (!scored.length) return ''
  // stable sort — ties keep `threads`' original most-recent-first order
  scored.sort((a, b) => b.score - a.score)

  const chunks = []
  let total = 0
  for (const { t } of scored) {
    const block = threadBlock(t)
    if (total + block.length > MAX_OUTPUT_CHARS) break
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n')
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
