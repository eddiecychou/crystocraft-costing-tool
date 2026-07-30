// Client for the /api/send-campaign edge function. Same posture as
// bankAccounts.js: send the signed-in admin's Firebase token, the edge
// function does the actual Resend call server-side (RESEND_API_KEY never
// reaches the browser).
import { authedUser } from './firebase'

export async function sendCampaignBatch({ subject, bodyHtml, contacts }) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/send-campaign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject, bodyHtml, contacts }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data.results || []
}
