// V8.2 — client for refresh-whatsapp-summary.js, CustomerDetail.jsx's
// WhatsApp card "Generate/Refresh" action. Mirrors emailSummaryApi.js's
// split (Firestore reads happen in the browser, this only calls the edge
// function) but without the recency/oldest split that file needs — a
// WhatsApp customer's imported history is tens of threads, not the
// hundreds an email archive can reach, so a straight cap is enough.
import { authedUser } from './firebase'

const MAX_INPUT_CHARS = 38000 // just under the edge function's own 40000 cap

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

export async function refreshWhatsappSummary(threadsText) {
  return authedPost('/api/refresh-whatsapp-summary', { threadsText })
}

// customers/{id}/whatsapp_threads docs -> one text block for the model.
// `threads` sorted newest-first (CustomerDetail.jsx's own sort) — rendered
// oldest-first within the cap so a conversation reads in its natural order
// rather than backwards, stopping once the char budget runs out (drops the
// OLDEST threads first, keeping the most recent ones — the ones most likely
// to matter for "what's going on with this account lately").
export function renderThreadsText(threads) {
  const chunks = []
  let total = 0
  for (const t of [...threads].reverse()) {
    const header = `\n=== WhatsApp chat: ${t.subject || '(unnamed)'} (${t.channel || 'WhatsApp'}, ${t.message_count || (t.messages || []).length} messages) ===`
    const body = (t.messages || []).map(m => {
      if (m.body_text) return `--- ${m.date || ''} | ${m.from || ''} ---\n${m.body_text}`
      if (m.transcript) return `--- ${m.date || ''} | ${m.from || ''} (voice note, transcribed) ---\n${m.transcript}`
      if (m.attachment_filename) return `--- ${m.date || ''} | ${m.from || ''} ---\n[attachment: ${m.attachment_filename}, no text content]`
      return ''
    }).filter(Boolean).join('\n')
    const block = `${header}\n${body}`
    if (total + block.length > MAX_INPUT_CHARS) break
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n')
}
