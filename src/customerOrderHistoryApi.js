// Client for the portal-facing /api/customer-order-history edge function —
// a signed-in customer's OWN JES sales invoice history and line detail.
// Deliberately separate from erpApi.js's erpLookup(), which talks to the
// admin-only /api/erp (trade-secret cost/margin data) — this endpoint is
// scoped server-side to the caller's own account, no admin role needed.
import { authedUser } from './firebase'

async function call(body) {
  const user = await authedUser()
  if (!user) return null
  const token = await user.getIdToken()
  const res = await fetch('/api/customer-order-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  return res.json()
}

// Returns { rows, shared } — shared:true means this account's ERP code is a
// shared "bucket" code (JES never gave this customer a unique one), so no
// history is returned; the caller should show an explanatory note, not an
// empty state.
export async function myOrderHistory() {
  const data = await call({ action: 'history' })
  return { rows: data?.rows || [], shared: !!data?.shared }
}

// Line items for one of the caller's OWN JES invoices — the server re-checks
// ownership, so a bad/foreign code just comes back empty rather than erroring
// the page.
export async function myInvoiceLines(code) {
  const data = await call({ action: 'lines', code })
  return data?.lines || []
}
