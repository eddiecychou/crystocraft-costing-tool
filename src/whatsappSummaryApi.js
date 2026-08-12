// V8.2 — client for refresh-whatsapp-summary.js, CustomerDetail.jsx's
// WhatsApp card "Generate/Refresh" action. Mirrors emailSummaryApi.js's
// split (Firestore reads happen in the browser, this only calls the edge
// function) but without the recency/oldest split that file needs — a
// WhatsApp customer's imported history is tens of threads, not the
// hundreds an email archive can reach, so a straight cap is enough.
import { collection, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore'
import { authedUser, db } from './firebase'
import { loadCustomers } from './domain/customer'

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

function messageLine(m) {
  if (m.body_text) return `--- ${m.date || ''} | ${m.from || ''} ---\n${m.body_text}`
  if (m.transcript) return `--- ${m.date || ''} | ${m.from || ''} (voice note, transcribed) ---\n${m.transcript}`
  if (m.attachment_filename) return `--- ${m.date || ''} | ${m.from || ''} ---\n[attachment: ${m.attachment_filename}, no text content]`
  return ''
}

// customers/{id}/whatsapp_threads docs -> one text block for the model.
// `threads` sorted newest-first (CustomerDetail.jsx's own sort) — rendered
// oldest-first within the cap so a conversation reads in its natural order
// rather than backwards, dropping the OLDEST *threads* first once the
// overall budget runs out (most recent chats matter most).
//
// Within a single thread, this used to treat the whole thing as one atomic
// block — fine for the "tens of threads" case this was designed for, but a
// real single long-running chat (one customer, 548 messages spanning 10+
// months, many with Deepgram transcripts) can alone exceed MAX_INPUT_CHARS,
// which made the whole thread get dropped rather than shortened — confirmed
// live, 2026-08-12: threadsText came back completely empty for exactly this
// customer, failing with a misleading "nothing imported" error. Now
// truncates WITHIN an oversized thread instead, keeping its MOST RECENT
// messages (same "recent matters most" reasoning as the thread-level drop)
// rather than silently omitting the whole conversation.
export function renderThreadsText(threads) {
  const chunks = []
  let total = 0
  for (const t of [...threads].reverse()) {
    if (total >= MAX_INPUT_CHARS) break
    const header = `\n=== WhatsApp chat: ${t.subject || '(unnamed)'} (${t.channel || 'WhatsApp'}, ${t.message_count || (t.messages || []).length} messages) ===`
    const remaining = MAX_INPUT_CHARS - total - header.length
    if (remaining <= 0) break

    const lines = (t.messages || []).map(messageLine).filter(Boolean)
    const fullBody = lines.join('\n')
    let body, truncated
    if (fullBody.length <= remaining) {
      body = fullBody
      truncated = false
    } else {
      // Keep the most recent messages that fit, in reverse-then-reversed
      // order so they still read chronologically.
      const kept = []
      let used = 0
      for (let i = lines.length - 1; i >= 0; i--) {
        if (used + lines[i].length + 1 > remaining) break
        kept.unshift(lines[i])
        used += lines[i].length + 1
      }
      body = kept.join('\n')
      truncated = true
    }

    const block = `${header}${truncated ? '\n(earlier messages in this chat omitted — showing the most recent that fit)' : ''}\n${body}`
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n')
}

const totalMessageCount = threads => threads.reduce((n, t) => n + (t.message_count || (t.messages || []).length), 0)

// Generate + write in one step — CustomerDetail.jsx's single-customer button
// and the bulk action below both call this, so there's one write path
// rather than two copies that could drift. message_count (total across all
// threads, not just thread_count) is what lets the bulk scan below tell a
// truly up-to-date summary apart from one that predates new messages on an
// already-known thread — thread_count alone wouldn't catch that, since
// re-importing an updated export keeps the same thread doc.
export async function generateAndSaveWhatsappSummary(customerId, threads) {
  const result = await refreshWhatsappSummary(renderThreadsText(threads))
  const whatsapp_summary = {
    ...result,
    thread_count: threads.length,
    message_count: totalMessageCount(threads),
    generated_at: serverTimestamp(),
  }
  await updateDoc(doc(db, 'customers', customerId), { whatsapp_summary })
  return whatsapp_summary
}

// Every customer with at least one imported WhatsApp thread, whether or not
// they already have a summary — the bulk action's whole point is catching
// up anyone who's fallen behind, not just the ones with zero. Reads each
// candidate's whatsapp_threads subcollection (unavoidable: this is exactly
// the "has anything been imported, and has it grown" check, no cheaper
// signal exists on the customer doc itself) — a real cost at scale, but a
// deliberate one-time admin action, not something run automatically.
export async function loadWhatsappSummaryCandidates() {
  const customers = await loadCustomers()
  const results = []
  for (const c of customers) {
    const snap = await getDocs(collection(db, 'customers', c.id, 'whatsapp_threads'))
    if (snap.empty) continue
    const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    const currentCount = totalMessageCount(threads)
    const existing = c.whatsapp_summary
    const upToDate = existing && existing.message_count === currentCount
    results.push({
      customerId: c.id,
      companyName: c.company_name,
      threads,
      threadCount: threads.length,
      messageCount: currentCount,
      hasSummary: !!existing,
      upToDate,
    })
  }
  return results
}
