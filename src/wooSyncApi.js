// Client for the WooCommerce sync edge function (Phase 1, read-only — see
// WooCommerce_B2C_Sync_Spec.md). Same shape as erpApi.js: the browser sends
// the signed-in admin's Firebase token, the edge function holds the
// WooCommerce Consumer Key/Secret and does the actual fetch.
import { authedUser } from './firebase'

async function wooSync(op, extra) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/woo-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `WooCommerce sync failed (${res.status})`)
  return data
}

// Returns { rows, refunds, skipped_unpaid, total_fetched }.
export const listWooOrders = (from, to) => wooSync('list_orders', { from, to })

export const wooOrderRefunds = (orderId) => wooSync('order_refunds', { order_id: orderId }).then(d => d.rows || [])
