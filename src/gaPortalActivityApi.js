// Client for ga-portal-activity.js — see that file's own comment for what
// this is (aggregate site traffic, NOT matched to individual accounts).
import { authedUser } from './firebase'

export async function fetchPortalTraffic() {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/ga-portal-activity', {
    headers: { Authorization: `Bearer ${token}` },
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `GA lookup failed (${res.status})`)
  return data.rows || []
}
