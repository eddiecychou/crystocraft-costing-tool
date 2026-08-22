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

// Full order history (any status, no date bound) for one person — email or
// name — used to check whether an existing customer record actually has
// WooCommerce orders behind it before linking the two records.
export const searchWooOrders = (q) => wooSync('search_orders', { q }).then(d => d.rows || [])

export const wooOrderRefunds = (orderId) => wooSync('order_refunds', { order_id: orderId }).then(d => d.rows || [])

// Diagnostic: full meta_data for one order — used to check for a gateway fee
// hiding in private post meta once fee_lines comes back empty. See spec §12 Q4.
export const wooOrderMeta = (orderId) => wooSync('order_meta', { order_id: orderId })

// Diagnostic: tries the documented WooCommerce Payments deposits/transactions
// REST paths and reports what each actually returns — payout DATE isn't in
// per-order meta (only the amount, _wcpay_net, is), so this checks whether
// it's reachable via a separate endpoint before assuming it isn't. See spec
// §12 Q2/Q3.
export const wooProbePayout = (orderId) => wooSync('probe_payout', { order_id: orderId }).then(d => d.results || [])
