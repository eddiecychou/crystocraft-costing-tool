// Client for the portal-facing /api/customer-order-history edge function —
// a signed-in customer's OWN JES sales invoice + order ("PI") history.
// Deliberately separate from erpApi.js's erpLookup(), which talks to the
// admin-only /api/erp (trade-secret cost/margin data) — this endpoint is
// scoped server-side to the caller's own account, no admin role needed.
import { authedUser } from './firebase'

// Returns { rows, shared } — shared:true means this account's ERP code is a
// shared "bucket" code (JES never gave this customer a unique one), so no
// history is returned; the caller should show an explanatory note, not an
// empty state.
export async function myOrderHistory() {
  const user = await authedUser()
  if (!user) return { rows: [] }
  const token = await user.getIdToken()
  const res = await fetch('/api/customer-order-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { rows: [] }   // history is a nicety; never break the page
  const data = await res.json()
  return { rows: data.rows || [], shared: !!data.shared }
}
