// Client for ga-portal-activity.js — see that file's own comment for what
// this is (site-wide traffic, PLUS a per-account breakdown for sessions
// carrying the app_uid custom dimension — see useAuthState.js).
import { authedUser } from './firebase'

// Returns { rows, byUid }: rows = daily site-wide {date, activeUsers,
// sessions}; byUid = { [firebaseUid]: {sessions, activeUsers} }, only for
// uids GA4 actually reported (no entry ≠ zero, just no matched sessions
// yet in the window queried).
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
  return { rows: data.rows || [], byUid: data.byUid || {} }
}
