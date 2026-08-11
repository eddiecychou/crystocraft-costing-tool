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
export function renderThreadsText(threads) {
  return threads.map(t => {
    const header = `\n=== Thread: ${t.subject || '(no subject)'} (${t.message_count || (t.messages || []).length} messages) ===`
    const body = (t.messages || []).map(m =>
      `--- ${m.date || ''} | From: ${m.from || ''} | To: ${m.to || ''} ---\n${(m.body_text || '').trim()}`
    ).join('\n')
    return `${header}\n${body}`
  }).join('\n')
}
