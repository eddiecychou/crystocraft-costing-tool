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

// Exact order history for one WooCommerce customer ID — used by
// CustomerDetail.jsx's "WooCommerce order history" card once a customer is
// linked (wooImport.js's linkCustomerToWoo captures the real ID).
export const wooOrdersByCustomerId = (customerId) => wooSync('search_orders', { customer_id: customerId }).then(d => d.rows || [])

// One page of all-time paid-order identities (id, email, name, total,
// currency) — for the Retail Customer bulk scan. Caller loops pages itself
// until has_more is false; see wooSync.js's orders_page op for why this is
// client-paginated rather than looped server-side.
export const wooOrdersPage = (page) => wooSync('orders_page', { page })

export const wooOrderRefunds = (orderId) => wooSync('order_refunds', { order_id: orderId }).then(d => d.rows || [])

// One page of the WooCommerce product catalogue with per-variation stock —
// for the Finished-Goods reconciliation (WooStockReconcile.jsx). Caller loops
// pages until has_more is false; client-paginated for the same reason as
// wooOrdersPage (a catalogue plus a /variations call per variable product has
// no safe server-side loop bound). Returns { rows, has_more, ... }.
export const wooProductsPage = (page) => wooSync('products_page', { page })

// One page of the catalogue as PRODUCT-shaped rows (variations nested) plus
// the fields an SEO heuristic needs — for the catalogue overview
// (WooCatalogue.jsx). Client-paginated, and looped per WPML language by the
// caller (`lang` = one language code; omitted → the site's default language).
// Returns { rows, has_more, ... }.
export const wooCataloguePage = (page, lang) => wooSync('catalogue_page', lang ? { page, lang } : { page })

// Diagnostic: whether the WordPress site exposes translation status
// (WPML / Polylang) and SEO meta (Yoast / RankMath) over REST. Returns
// { results: [{ label, status, ok, sample }] }.
export const wooProbeI18nSeo = () => wooSync('probe_i18n_seo', {}).then(d => d.results || [])

// Diagnostic: full meta_data for one order — used to check for a gateway fee
// hiding in private post meta once fee_lines comes back empty. See spec §12 Q4.
export const wooOrderMeta = (orderId) => wooSync('order_meta', { order_id: orderId })

// Diagnostic: tries the documented WooCommerce Payments deposits/transactions
// REST paths and reports what each actually returns — payout DATE isn't in
// per-order meta (only the amount, _wcpay_net, is), so this checks whether
// it's reachable via a separate endpoint before assuming it isn't. See spec
// §12 Q2/Q3.
export const wooProbePayout = (orderId) => wooSync('probe_payout', { order_id: orderId }).then(d => d.results || [])
