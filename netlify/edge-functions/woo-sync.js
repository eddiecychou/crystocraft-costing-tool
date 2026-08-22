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
//           POST { op: 'search_orders', q }         -- email/name, no date bound
//           POST { op: 'order_refunds', order_id }
//           POST { op: 'order_meta', order_id }
//           POST { op: 'probe_payout', order_id? }   -- diagnostic, see below
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

const metaVal = (o, key) => (o.meta_data || []).find(m => m.key === key)?.value

// Gateway fee, resolved 2026-08-22 against real orders (spec §12 Q4): this
// store's gateway is WooCommerce Payments (`payment_method ===
// 'woocommerce_payments'`), which never adds a proper `fee_lines` entry —
// it writes the fee to private post meta instead: `_wcpay_transaction_fee`
// and `_wcpay_net` (net payout amount, i.e. total − fee). Both were found via
// the per-order meta inspector on this page. Falls back to `fee_lines` for
// any other gateway that DOES use it properly; falls back to null (not 0 —
// 0 would wrongly claim "no fee charged") when neither source has anything,
// which currently only happens for the couple of $0 authorization-only test
// rows this account has processed.
// `txn`: the matching row from wc/v3/payments/transactions (see
// fetchTransactionsByOrder below), when found — its fee/net are in minor
// units (cents) and authoritative, since it's WooCommerce Payments' own
// settlement record rather than a value copied into order meta. Preferred
// over _wcpay_transaction_fee/_wcpay_net when present; both ultimately come
// from the same underlying Stripe charge, so they should never disagree.
function gatewayFee(o, txn) {
  if (txn && Number.isFinite(txn.fees)) return { amount: txn.fees / 100, source: 'transactions_api' }
  const fromLines = (o.fee_lines || []).reduce((s, l) => s + (parseFloat(l.total) || 0), 0)
  if (fromLines) return { amount: fromLines, source: 'fee_lines' }
  const wcpay = parseFloat(metaVal(o, '_wcpay_transaction_fee'))
  if (Number.isFinite(wcpay)) return { amount: wcpay, source: 'wcpay_meta' }
  return { amount: null, source: null }
}

// Trims a WooCommerce order object down to what Phase 1 needs to show Cindy
// for review — full raw order kept under `raw` in case something in Phase 2+
// design turns out to need a field not anticipated here.
function summarizeOrder(o, txn) {
  const fee = gatewayFee(o, txn)
  const netMeta = parseFloat(metaVal(o, '_wcpay_net'))
  const net = txn && Number.isFinite(txn.net) ? txn.net / 100 : (Number.isFinite(netMeta) ? netMeta : null)
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
    // The raw WooCommerce customer ID itself — previously computed into
    // is_guest above and then discarded. Needed 2026-08-22 for the Retail
    // Customer segment work: linking an existing CRM customer record to
    // their real WooCommerce identity needs this, not just a yes/no guest
    // flag. 0/absent for guest checkout, same value is_guest is derived from.
    woo_customer_id: o.customer_id || null,
    subtotal: (o.line_items || []).reduce((s, l) => s + (parseFloat(l.subtotal) || 0), 0),
    discount_total: parseFloat(o.discount_total) || 0,
    shipping_total: parseFloat(o.shipping_total) || 0,
    tax_total: parseFloat(o.total_tax) || 0,
    total: parseFloat(o.total) || 0,
    payment_method: o.payment_method,
    payment_method_title: o.payment_method_title,
    transaction_id: o.transaction_id || null,
    gateway_fee: fee.amount,               // spec §3.6/§8 — see gatewayFee() above
    gateway_fee_source: fee.source,        // 'transactions_api' | 'fee_lines' | 'wcpay_meta' | null — shown so a null reads as "not found", not "zero"
    net_payout: net,
    // available_on from wc/v3/payments/transactions — when the settled funds
    // become available to Crystocraft. Confirmed 2026-08-22: this is the
    // only payout-adjacent date reachable via REST API keys (the actual
    // deposits list 500s on a query bug in WooCommerce Payments itself — see
    // probe_payout). It is "available", not necessarily "paid out" — those
    // can differ if WooCommerce Payments batches multiple available dates
    // into one deposit — but it is the closest automatable proxy for the
    // spec's §7 "Balance payment date" and is what deposit_id ties back to.
    payout_date: txn?.available_on ? String(txn.available_on).slice(0, 10) : null,
    deposit_id: txn?.deposit_id || null,
    refunded_total: Math.abs(parseFloat(o.refund_total) || 0), // sign varies by version
    // Per-line detail for the drill-down — description/qty/price, plus each
    // line's own tax and any per-line discount (subtotal minus total, before
    // tax — how WooCommerce represents a coupon applied to that line).
    line_items: (o.line_items || []).map(l => {
      const subtotal = parseFloat(l.subtotal) || 0
      const total = parseFloat(l.total) || 0
      const qty = Number(l.quantity) || 0
      return {
        name: l.name, sku: l.sku || null, quantity: qty,
        unit_price: qty ? +(total / qty).toFixed(2) : total,
        subtotal, total,
        discount: +(subtotal - total).toFixed(2),
        tax: parseFloat(l.total_tax) || 0,
      }
    }),
    // Billing/shipping and any note the customer left — the rest of what
    // "drill down into the order" needs beyond the summary row.
    billing_address: [o.billing?.address_1, o.billing?.address_2, o.billing?.city, o.billing?.state, o.billing?.postcode, o.billing?.country]
      .filter(Boolean).join(', ') || null,
    billing_phone: o.billing?.phone || null,
    shipping_name: [o.shipping?.first_name, o.shipping?.last_name].filter(Boolean).join(' ') || null,
    shipping_address: [o.shipping?.address_1, o.shipping?.address_2, o.shipping?.city, o.shipping?.state, o.shipping?.postcode, o.shipping?.country]
      .filter(Boolean).join(', ') || null,
    customer_note: o.customer_note || null,
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
  // Same auth, arbitrary wp-json path — for probing where payout/deposit date
  // actually lives (see 'probe_payout' below). Not every REST namespace a
  // plugin registers sits under wc/v3.
  const wpJson = (path) => fetch(`${WC_BASE_URL.replace(/\/$/, '')}/wp-json/${path}`, { headers: wcAuthHeader })

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

    // wc/v3/payments/transactions — confirmed working 2026-08-22 (unlike
    // wc/v3/payments/deposits, which 500s on a query-builder bug in
    // WooCommerce Payments itself). Gives authoritative fee/net (in cents)
    // AND available_on (settlement date) per charge — see gatewayFee() and
    // summarizeOrder()'s payout_date. Its own order_id query param does NOT
    // actually filter (confirmed by probe — two different order_id values
    // returned the identical row), so this paginates the full transaction
    // list and matches client-side by the order_id field the row itself
    // carries, stopping once every paid order in this batch has been found
    // or the page cap is hit.
    const wantIds = new Set(paid.map(o => o.id))
    const txnByOrder = new Map()
    for (let page = 1; page <= 20 && txnByOrder.size < wantIds.size; page++) {
      const r = await wc('payments/transactions', { per_page: 100, page })
      if (!r.ok) break // best-effort — a broken transactions call must not fail the whole sync
      const body = await r.json().catch(() => null)
      const rows = body?.data || []
      if (!rows.length) break
      for (const t of rows) if (wantIds.has(t.order_id) && !txnByOrder.has(t.order_id)) txnByOrder.set(t.order_id, t)
    }

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
      rows: paid.map(o => summarizeOrder(o, txnByOrder.get(o.id))),
      refunds,
      skipped_unpaid: notSynced,
      total_fetched: orders.length,
    })
  }

  // ── search for a person's WooCommerce order history by email/name ──────────
  // For checking whether an existing (non-WooCommerce-sourced) customer
  // record actually has real orders behind it before linking the two —
  // 2026-08-22, checking Petar Chankov / confirming Anxo Domínguez Rama and
  // Ryan Cheung. Not date-bounded (list_orders is): identity lookups need the
  // person's FULL order history, not one month's slice. Uses WooCommerce's
  // own `search` param, which matches against billing name/email/order
  // number — broader than an exact email match, but exact matches are
  // trivial to eyeball in a small result set. Any status, not just paid —
  // finding "did they ever order, even unpaid/cancelled" is the point here,
  // unlike list_orders which deliberately only surfaces paid orders as
  // invoicing candidates.
  if (body.op === 'search_orders') {
    const q = String(body.q || '').trim().slice(0, 200)
    if (!q) return json({ error: 'Missing search query' }, 400)
    const orders = []
    for (let page = 1; page <= 5; page++) {
      const r = await wc('orders', { search: q, per_page: 50, page, orderby: 'date', order: 'desc' })
      if (!r.ok) return json({ error: 'WooCommerce search failed', detail: (await r.text()).slice(0, 300) }, 502)
      const rows = await r.json()
      orders.push(...rows)
      if (rows.length < 50) break
    }
    return json({ rows: orders.map(o => summarizeOrder(o)) })
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

  // ── diagnostic: full meta_data for one order ────────────────────────────────
  // Confirmed 2026-08-22 (Cindy's real orders): fee_lines is empty on every
  // order — the gateway doesn't add a proper WC fee line. This op exists to
  // check the other place a gateway plugin sometimes hides it: private post
  // meta (e.g. `_stripe_fee`). WooCommerce's REST API normally strips
  // underscore-prefixed meta from the standard order response, but the
  // individual order endpoint can still expose keys a plugin explicitly
  // registered via register_meta( show_in_rest: true ) — worth checking
  // before concluding the fee genuinely isn't retrievable via the API at all.
  if (body.op === 'order_meta') {
    const orderId = parseInt(body.order_id, 10)
    if (!orderId) return json({ error: 'Missing order_id' }, 400)
    const r = await wc(`orders/${orderId}`, {})
    if (!r.ok) return json({ error: 'WooCommerce order fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
    const o = await r.json()
    return json({
      order_id: orderId,
      payment_method: o.payment_method,
      transaction_id: o.transaction_id || null,
      meta: (o.meta_data || []).map(m => ({ key: m.key, value: m.value })),
    })
  }

  // ── diagnostic: where does payout/deposit date live? ────────────────────────
  // Per-order meta (checked 2026-08-22) has _wcpay_net (payout AMOUNT) but no
  // payout DATE — WooCommerce Payments tracks deposits as their own objects,
  // not per-order fields, since one deposit typically bundles many orders'
  // payouts together. Its deposits/transactions data may or may not be
  // reachable via REST API keys (some WooCommerce Payments admin endpoints
  // require a logged-in wp-admin session/nonce instead). This tries the
  // documented candidates and reports what each one actually returns, rather
  // than guessing — same reasoning as the order-meta inspector: empirical
  // check beats assumption. Purely diagnostic; nothing here is wired into the
  // order summary until one of these is confirmed working.
  if (body.op === 'probe_payout') {
    const orderId = body.order_id ? parseInt(body.order_id, 10) : null
    const candidates = [
      'wc/v3/payments/deposits',
      'wc/v3/payments/transactions',
      ...(orderId ? [`wc/v3/payments/transactions?order_id=${orderId}`] : []),
      'wc-payments/v1/deposits',
      'wc-payments/v1/transactions',
    ]
    const results = []
    for (const path of candidates) {
      try {
        const r = await wpJson(path)
        const text = await r.text()
        results.push({ path, status: r.status, ok: r.ok, body: text.slice(0, 500) })
      } catch (e) {
        results.push({ path, status: null, ok: false, body: String(e?.message || e).slice(0, 300) })
      }
    }
    return json({ results })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}

export const config = { path: '/api/woo-sync' }
