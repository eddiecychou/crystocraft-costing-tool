import { authedUser } from './firebase'

// Client for the two Daily Drafts edge functions (V7.23) — mirrors
// campaignApi.js's shape exactly: authedUser() -> getIdToken() -> fetch with
// bearer -> defensive JSON parse -> throw on !res.ok.

// master = the owner-approved { subject, body } from the Compose phase (see
// draft-outreach-topic.js / discuss-outreach-draft.js) — this personalizes
// it per candidate, it does not draft from scratch.
// memory: { globalRules: string[] } — Draft Memory Layer (V8.9). Per-candidate
// aiContextSummary already travels inside each candidate object.
export async function generateDrafts(master, topicLabel, candidates, historicalHints, targetingNote, memory) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/generate-outreach-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ master, topicLabel, candidates, historicalHints, targetingNote, memory }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data.drafts || []
}

// Compose-phase "Draft with AI" — one starting draft from a free-text topic,
// no candidates/personalization yet (see draft-outreach-topic.js).
// memory: { globalRules: string[] } — Draft Memory Layer (V8.9).
export async function draftTopic(topic, memory) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/draft-outreach-topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic, memory }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export async function sendPersonalEmail({ customerEmail, subject, body, draftId, imageUrls, links, recipientKind, recipientId }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/send-personal-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerEmail, subject, body, draftId, imageUrls, links, recipientKind, recipientId }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// The per-draft "discuss with AI" chat (see discuss-outreach-draft.js).
// memory: { globalRules: string[], contactSummary?: string, recentConclusions?: string[] }
// — Draft Memory Layer (V8.9).
export async function discussDraft({ productContext, customerContext, draftSubject, draftBody, history, message, memory }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/discuss-outreach-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productContext, customerContext, draftSubject, draftBody, history, message, memory }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
