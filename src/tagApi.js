// V8.2 — TagManager.jsx's client for the one AI edge function it uses.
import { authedUser } from './firebase'

export async function suggestTagMerges(tags) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/suggest-tag-merges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tags }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return Array.isArray(data.groups) ? data.groups : []
}
