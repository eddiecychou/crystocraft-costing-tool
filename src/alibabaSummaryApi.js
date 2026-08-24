// V8.10 — client for refresh-alibaba-summary.js, CustomerDetail.jsx's and
// MarketingContacts.jsx's Alibaba Messages card. Mirrors
// whatsappSummaryApi.js's shape/split (Firestore reads happen in the
// browser, the edge function only calls the model) but simpler: Alibaba.com
// gives no export, so the input here is already raw pasted text per batch
// (customers/{id}/alibaba_threads or marketing_contacts/{id}/alibaba_threads,
// each doc one paste), not structured message threads needing per-message
// rendering. `collectionName` is parameterized the same way
// generateAndSaveWhatsappSummary is, so both collections share one write path.
import { addDoc, collection, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { authedUser, db } from './firebase'

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

export async function refreshAlibabaSummary(threadsText) {
  return authedPost('/api/refresh-alibaba-summary', { threadsText })
}

// Save one pasted batch. Additive/append-only by design (addDoc, never
// overwrite-in-place) — the owner may paste multiple times over weeks as
// new Alibaba messages arrive, so re-pasting must never lose earlier
// context the way overwriting a single doc would.
export async function savePastedAlibabaThread(collectionName, id, rawText) {
  const trimmed = String(rawText || '').trim()
  if (!trimmed) throw new Error('Paste some message text first.')
  await addDoc(collection(db, collectionName, id, 'alibaba_threads'), {
    raw_text: trimmed,
    char_count: trimmed.length,
    pasted_at: serverTimestamp(),
  })
}

function pasteDateLabel(t) {
  const d = t.pasted_at?.toDate ? t.pasted_at.toDate() : (t.pasted_at ? new Date(t.pasted_at) : null)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '(unknown date)'
}

// alibaba_threads docs -> one text block for the model. `threads` may be
// sorted either way by the caller — this always renders oldest-last (i.e.
// chronological) regardless of input order, dropping whole OLDEST batches
// first once the budget runs out (same "recent matters most" reasoning as
// whatsappSummaryApi.js's own renderThreadsText). Unlike that file, a single
// pasted batch here doesn't need message-level truncation — there's no
// per-message structure to preserve — so if the single oldest remaining
// batch is itself too big to fit, it's simply truncated to its most recent
// characters (the tail) rather than dropped whole, same "keep what's
// closest to now" choice, just at the character level instead of the
// message level.
export function renderThreadsText(threads) {
  const chronological = [...threads].sort((a, b) => {
    const av = a.pasted_at?.toMillis ? a.pasted_at.toMillis() : new Date(a.pasted_at || 0).getTime()
    const bv = b.pasted_at?.toMillis ? b.pasted_at.toMillis() : new Date(b.pasted_at || 0).getTime()
    return av - bv
  })
  // Walk newest-first to decide what survives the budget, then emit in
  // chronological order.
  const kept = []
  let total = 0
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (total >= MAX_INPUT_CHARS) break
    const t = chronological[i]
    const header = `\n=== Pasted ${pasteDateLabel(t)} ===\n`
    const remaining = MAX_INPUT_CHARS - total - header.length
    if (remaining <= 0) break
    const full = t.raw_text || ''
    let body, truncated
    if (full.length <= remaining) {
      body = full
      truncated = false
    } else {
      // Keep the tail (most recent characters within this one paste).
      body = full.slice(full.length - remaining)
      truncated = true
    }
    const block = `${header}${truncated ? '(earlier part of this paste omitted — showing the most recent that fit)\n' : ''}${body}`
    kept.unshift(block)
    total += block.length
  }
  return kept.join('\n')
}

const totalCharCount = threads => threads.reduce((n, t) => n + (t.char_count || (t.raw_text || '').length), 0)

// Generate + write in one step — same posture as
// generateAndSaveWhatsappSummary: one write path shared by both
// CustomerDetail.jsx's card and MarketingContacts.jsx's AlibabaThreads
// component, `collectionName` parameterized so both `customers` and
// `marketing_contacts` write onto their own doc's alibaba_summary field.
export async function generateAndSaveAlibabaSummary(collectionName, id, threads) {
  const result = await refreshAlibabaSummary(renderThreadsText(threads))
  const alibaba_summary = {
    ...result,
    paste_count: threads.length,
    char_count: totalCharCount(threads),
    generated_at: serverTimestamp(),
  }
  await updateDoc(doc(db, collectionName, id), { alibaba_summary })
  return alibaba_summary
}
