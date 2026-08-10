import { authedUser } from './firebase'

// Client for the two Daily Drafts edge functions (V7.23) — mirrors
// campaignApi.js's shape exactly: authedUser() -> getIdToken() -> fetch with
// bearer -> defensive JSON parse -> throw on !res.ok.

export async function generateDrafts(product, candidates) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/generate-outreach-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ product, candidates }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data.drafts || []
}

export async function sendPersonalEmail({ customerEmail, subject, body }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/send-personal-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerEmail, subject, body }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
