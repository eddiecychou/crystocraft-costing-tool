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

export async function sendPersonalEmail({ customerEmail, subject, body, imageUrls, blogLink }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/send-personal-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerEmail, subject, body, imageUrls, blogLink }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// crystocraft.com blog post search, for attaching a real link to a draft
// (see wp-blog-search.js). q='' returns the 10 most recent published posts.
export async function searchBlogPosts(q) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/wp-blog-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ q }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data.posts || []
}
