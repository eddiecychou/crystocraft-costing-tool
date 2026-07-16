// Client for the ERP archive (read-only, in Supabase) via the /api/erp edge
// function. The browser never talks to Supabase directly — it sends the signed-in
// user's Firebase token and the edge function does the query server-side.
import { auth } from './firebase'

export async function erpLookup(entity, { q = '', limit = 25, activeOnly = false } = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()

  const res = await fetch('/api/erp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity, q, limit, activeOnly }),
  })

  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`)
  return data.rows || []
}
