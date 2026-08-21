// WooCommerce B2C sync — Phase 1 (WooCommerce_B2C_Sync_Spec.md). Read-only:
// pulls paid orders and their refunds from the Crystocraft WordPress site's
// WooCommerce REST API for review. Writes NOTHING to Firestore or Supabase —
// no invoice numbers or UC#s are burned here. That starts in a later phase,
// once Cindy has reviewed what this actually returns.
//
// Same posture as erp.js/uc.js/credit-note.js: admin-gated via requireAdmin(),
// external credentials stay server-side, the browser never sees them.
//
// Env (Netlify → Site config → Environment variables):
//   WC_BASE_URL         e.g. https://crystocraft.com  (same site as WP_BASE_URL,
//                        but WooCommerce's own REST API needs its own keys —
//                        it does NOT accept the WP_USER/WP_PASS Application
//                        Password publish-to-wordpress.js uses.)
//   WC_CONSUMER_KEY      WooCommerce → Settings → Advanced → REST API → key (ck_…)
//   WC_CONSUMER_SECRET    same screen → secret (cs_…)
//
// Request:  POST { op: 'list_orders', from, to }   -- from/to: 'YYYY-MM-DD'
//           POST { op: 'order_refunds', order_id }
// Response: { rows: [...] }  (list_orders)  /  { rows: [...] }  (order_refunds)
import { requireAdmin } from './lib/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// "Paid" per the spec's §2.1: inspect the actual payment field, not just
// status === 'processing' || 'completed'. WooCommerce sets date_paid the
// moment payment_complete() runs regardless of which status the order then
// moves to, so a non-null date_paid is the correct signal — a refunded order
// still carries its original date_paid and is reported separately via
// refunds, matching the spec's "do not touch the original invoice" rule.
function isPaid(order) {
  return !!order.date_paid
}

// Trims a WooCommerce order object down to what Phase 1 needs to show Cindy
// for review — full raw order kept under `raw` in case something in Phase 2+
// design turns out to need a field not anticipated here.
function summarizeOrder(o) {
  const fee = (o.fee_lines || []).reduce((s, l) => s + (parseFloat(l.total) || 0), 0)
  return {
    id: o.id,
    number: o.number,                     // WooCommerce's own order number — spec §3.4
    status: o.status,
    date_paid: o.date_paid,               // spec §3.3 invoice_date source
    date_created: o.date_created,
    currency: o.currency,                 // spec §3.7 — preserved, never converted
    customer_name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || null,
    customer_email: o.billing?.email || null,
    is_guest: !o.customer_id,             // spec §12 Q10
    subtotal: (o.line_items || []).reduce((s, l) => s + (parseFloat(l.subtotal) || 0), 0),
    discount_total: parseFloat(o.discount_total) || 0,
    shipping_total: parseFloat(o.shipping_total) || 0,
    tax_total: parseFloat(o.total_tax) || 0,
    total: parseFloat(o.total) || 0,
    payment_method: o.payment_method,
    payment_method_title: o.payment_method_title,
    transaction_id: o.transaction_id || null,
    // Gateway fee is NOT a guaranteed field on core WooCommerce orders — some
    // gateway plugins add a fee_lines entry, others store it only in gateway-
    // specific meta the REST API doesn't expose at all. `fee_lines_total` is
    // best-effort; a 0 here is not proof no fee was charged (spec §12 Q4 —
    // this is exactly the empirical check Phase 1 exists to make).
    fee_lines_total: fee,
    refunded_total: Math.abs(parseFloat(o.refund_total) || 0), // sign varies by version
    line_items: (o.line_items || []).map(l => ({
      name: l.name, sku: l.sku, quantity: l.quantity,
      subtotal: parseFloat(l.subtotal) || 0, total: parseFloat(l.total) || 0,
    })),
    raw_meta_keys: (o.meta_data || []).map(m => m.key), // for eyeballing what a payout/fee field might be called on this install
  }
}

function summarizeRefund(r, orderId, orderNumber) {
  return {
    id: r.id,
    order_id: orderId,
    order_number: orderNumber,
    date_created: r.date_created,          // spec §4.1/§4.2 — actual refund date, distinct from the order's date_paid
    amount: Math.abs(parseFloat(r.amount) || 0),
    reason: r.reason || null,
    line_items: (r.line_items || []).map(l => ({
      name: l.name, sku: l.sku, quantity: l.quantity, total: parseFloat(l.total) || 0,
    })),
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const WC_BASE_URL = Deno.env.get('WC_BASE_URL')
  const WC_KEY = Deno.env.get('WC_CONSUMER_KEY')
  const WC_SECRET = Deno.env.get('WC_CONSUMER_SECRET')
  if (!WC_BASE_URL || !WC_KEY || !WC_SECRET) {
    return json({ error: 'WooCommerce credentials not configured (WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET)' }, 500)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  // Basic auth with the Consumer Key/Secret — WooCommerce's documented method
  // for HTTPS stores (the alternative, OAuth1 query-string signing, is only
  // required over plain HTTP).
  const wcAuthHeader = { Authorization: `Basic ${btoa(`${WC_KEY}:${WC_SECRET}`)}` }
  const wc = (path, params) => {
    const url = new URL(`${WC_BASE_URL.replace(/\/$/, '')}/wp-json/wc/v3/${path}`)
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, v)
    return fetch(url, { headers: wcAuthHeader })
  }

  // ── list paid orders in a date range, with their refunds ───────────────────
  if (body.op === 'list_orders') {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : null
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to : null
    if (!from || !to) return json({ error: 'from and to must be YYYY-MM-DD' }, 400)

    // Pull every status — "paid" is determined from date_paid (see isPaid),
    // not from WooCommerce's status filter, per spec §2.1. Paginated: WC caps
    // per_page at 100.
    const orders = []
    for (let page = 1; page <= 20; page++) {
      const r = await wc('orders', {
        after: `${from}T00:00:00`, before: `${to}T23:59:59`,
        per_page: 100, page, orderby: 'date', order: 'asc',
      })
      if (!r.ok) return json({ error: 'WooCommerce order fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
      const rows = await r.json()
      orders.push(...rows)
      if (rows.length < 100) break
    }

    const paid = orders.filter(isPaid)
    const notSynced = orders.length - paid.length

    // Refunds per order that has any (refund_total present or status
    // refunded/partially-refunded) — one extra call per such order, capped
    // at 100 per sync so a large batch doesn't run away.
    const refundCandidates = paid.filter(o => o.status === 'refunded' || (parseFloat(o.refund_total) || 0) !== 0).slice(0, 100)
    const refunds = []
    for (const o of refundCandidates) {
      const r = await wc(`orders/${o.id}/refunds`, { per_page: 50 })
      if (!r.ok) continue // best-effort — don't fail the whole sync over one order's refund lookup
      const rows = await r.json()
      for (const rf of rows) refunds.push(summarizeRefund(rf, o.id, o.number))
    }

    return json({
      rows: paid.map(summarizeOrder),
      refunds,
      skipped_unpaid: notSynced,
      total_fetched: orders.length,
    })
  }

  // ── refunds for one order, on demand ────────────────────────────────────────
  if (body.op === 'order_refunds') {
    const orderId = parseInt(body.order_id, 10)
    if (!orderId) return json({ error: 'Missing order_id' }, 400)
    const r = await wc(`orders/${orderId}/refunds`, { per_page: 50 })
    if (!r.ok) return json({ error: 'WooCommerce refund fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
    const rows = await r.json()
    return json({ rows: rows.map(rf => summarizeRefund(rf, orderId, null)) })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}

export const config = { path: '/api/woo-sync' }
