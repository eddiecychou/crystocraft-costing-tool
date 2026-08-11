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
// message). CustomerDetail.jsx already sorts `threads` most-recent-first,
// so capping here by simply stopping once the budget's spent keeps the most
// relevant history, same truncation strategy the server-side crop uses.
const MAX_OUTPUT_CHARS = 60000

export function renderThreadsText(threads) {
  const chunks = []
  let total = 0
  for (const t of threads) {
    const header = `\n=== Thread: ${t.subject || '(no subject)'} (${t.message_count || (t.messages || []).length} messages) ===`
    const body = (t.messages || []).map(m =>
      `--- ${m.date || ''} | From: ${m.from || ''} | To: ${m.to || ''} ---\n${(m.body_text || '').trim()}`
    ).join('\n')
    const block = `${header}\n${body}`
    if (total + block.length > MAX_OUTPUT_CHARS) break
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n')
}
