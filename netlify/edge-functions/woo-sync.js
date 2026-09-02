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
//           POST { op: 'search_orders', customer_id }  -- exact WC customer ID
//           POST { op: 'orders_page', page }        -- lightweight, client-paginated, all-time
//           POST { op: 'products_page', page }       -- catalogue + per-variation stock, client-paginated
//           POST { op: 'catalogue_page', page }       -- product-shaped rows + SEO fields, client-paginated
//           POST { op: 'probe_i18n_seo' }             -- diagnostic: WPML/Polylang + Yoast over REST?
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
  // Cindy, 2026-08-24: for a non-HKD order the UC Registry/SI remarks need
  // the NET PAYOUT IN HKD, not the transaction-currency figure `net` above
  // — WooCommerce Payments settles into this store's HKD account using its
  // OWN exchange rate at charge time (not one this app computes or copies
  // from JES, per CLAUDE.md's "never compute" rule for FX). The
  // wc/v3/payments/transactions row carries that settlement conversion as
  // store_currency/store_amount alongside the customer-currency net/fees
  // already used above — when this store's currency is HKD, store_amount
  // IS the HKD net payout. Falls back to null (never a guessed figure) if
  // the field isn't present, e.g. an older WooCommerce Payments version —
  // wooImport.js's remarks note then asks Cindy to fill it in by hand.
  const net_payout_hkd = txn && Number.isFinite(txn.store_amount) && String(txn.store_currency || '').toUpperCase() === 'HKD'
    ? +(txn.store_amount / 100).toFixed(2)
    : null
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
    net_payout_hkd: net_payout_hkd,       // Cindy's spec — see net_payout_hkd's own comment above; null if not available from the transactions API
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
  // `customer_id` (WooCommerce's own numeric ID, exact match via WC's native
  // `customer` filter) takes priority over `q` (fuzzy `search` text) when
  // both are given — used by CustomerDetail.jsx's "WooCommerce order
  // history" card, which knows the exact ID once a customer is linked
  // (wooImport.js's linkCustomerToWoo) and wants their real order list, not
  // a name/email guess.
  if (body.op === 'search_orders') {
    const customerId = parseInt(body.customer_id, 10)
    const q = String(body.q || '').trim().slice(0, 200)
    if (!customerId && !q) return json({ error: 'Missing search query' }, 400)
    const params = customerId
      ? { customer: customerId, per_page: 50, orderby: 'date', order: 'desc' }
      : { search: q, per_page: 50, orderby: 'date', order: 'desc' }
    const orders = []
    for (let page = 1; page <= 5; page++) {
      const r = await wc('orders', { ...params, page })
      if (!r.ok) return json({ error: 'WooCommerce search failed', detail: (await r.text()).slice(0, 300) }, 502)
      const rows = await r.json()
      orders.push(...rows)
      if (rows.length < 50) break
    }
    return json({ rows: orders.map(o => summarizeOrder(o)) })
  }

  // ── one page of all-time PAID order identities, for the Retail Customer bulk
  // scan (WooCommerceSync.jsx's "Sync all WooCommerce customers", 2026-08-22)
  // ─────────────────────────────────────────────────────────────────────────
  // Deliberately CLIENT-paginated (the browser calls this once per page and
  // keeps going until hasMore is false) rather than looping server-side like
  // list_orders/search_orders do — an all-time scan across a store's full
  // order history has no known upper bound, and a single edge-function
  // invocation looping through it risks the platform's execution time limit.
  // Client-side pagination has no such ceiling, just a longer visible scan
  // with live progress in the UI.
  //
  // Deliberately lightweight — none of summarizeOrder()'s gateway-fee/
  // wc/v3/payments/transactions matching, which is exactly the expensive
  // part that would make looping through years of history impractical. This
  // scan only needs identity + spend, not accounting detail.
  if (body.op === 'orders_page') {
    const page = Math.max(1, parseInt(body.page, 10) || 1)
    const r = await wc('orders', { per_page: 100, page, orderby: 'date', order: 'asc' })
    if (!r.ok) return json({ error: 'WooCommerce fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
    const rows = await r.json()
    return json({
      rows: rows.filter(isPaid).map(o => ({
        order_id: o.id,
        woo_customer_id: o.customer_id || null,
        email: (o.billing?.email || '').trim().toLowerCase() || null,
        name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || null,
        date_paid: o.date_paid,
        currency: o.currency,
        total: parseFloat(o.total) || 0,
      })),
      has_more: rows.length === 100,
    })
  }

  // ── one page of the WooCommerce product catalogue + stock, for the
  // Finished-Goods reconciliation (WooStockReconcile.jsx) ───────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // CLIENT-paginated, same reasoning as orders_page: a catalogue has no known
  // upper bound and every VARIABLE product needs an extra /variations call,
  // so looping the whole thing server-side risks the edge-function time limit.
  // The browser calls this once per page until has_more is false.
  //
  // Most B2C products are variable products (owner, 2026-09-02): colour/plating
  // is a variation, and stock is tracked per VARIATION — the parent product's
  // own stock_quantity is null. So a variable product emits one row per
  // variation (carrying the parent's name + the variation's own sku/attributes/
  // stock); a simple product emits a single row. Variation fetches for the
  // page are run in small parallel batches to stay inside the time budget.
  if (body.op === 'products_page') {
    const page = Math.max(1, parseInt(body.page, 10) || 1)
    // status=any → includes draft/private/pending, excludes only trash, so a
    // not-yet-published product still shows up in the reconciliation rather
    // than looking like "missing from Woo".
    const r = await wc('products', { per_page: 100, page, status: 'any', orderby: 'id', order: 'asc' })
    if (!r.ok) return json({ error: 'WooCommerce product fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
    const products = await r.json()

    const attrPairs = (list) => (list || []).map(a => ({ name: a.name, option: a.option ?? a.options?.join(', ') ?? '' }))
    const baseRow = (p, extra) => ({
      product_id: p.id,
      type: p.type,
      status: p.status,
      name: p.name,
      permalink: p.permalink || null,
      ...extra,
    })

    const rows = []
    const variableProducts = []
    for (const p of products) {
      if (p.type === 'variable') { variableProducts.push(p); continue }
      // simple / grouped / external — one row, its own sku + stock
      rows.push(baseRow(p, {
        variation_id: null,
        sku: p.sku || '',
        parent_sku: '',
        attributes: [],
        manage_stock: !!p.manage_stock,
        stock_quantity: Number.isFinite(p.stock_quantity) ? p.stock_quantity : null,
        stock_status: p.stock_status || null,
        price: p.price || null,
      }))
    }

    // Variations, in parallel batches of 6.
    for (let i = 0; i < variableProducts.length; i += 6) {
      const batch = variableProducts.slice(i, i + 6)
      await Promise.all(batch.map(async (p) => {
        const vars = []
        for (let vp = 1; vp <= 10; vp++) {
          const vr = await wc(`products/${p.id}/variations`, { per_page: 100, page: vp })
          if (!vr.ok) break // best-effort — one product's variation lookup failing must not sink the page
          const vrows = await vr.json()
          vars.push(...vrows)
          if (vrows.length < 100) break
        }
        if (!vars.length) {
          // variable product with no variations defined yet — still surface it
          rows.push(baseRow(p, {
            variation_id: null, sku: p.sku || '', parent_sku: p.sku || '',
            attributes: [], manage_stock: false, stock_quantity: null,
            stock_status: p.stock_status || null, price: p.price || null,
          }))
          return
        }
        for (const v of vars) {
          rows.push(baseRow(p, {
            variation_id: v.id,
            sku: v.sku || '',
            parent_sku: p.sku || '',
            attributes: attrPairs(v.attributes),
            manage_stock: !!v.manage_stock,
            stock_quantity: Number.isFinite(v.stock_quantity) ? v.stock_quantity : null,
            stock_status: v.stock_status || null,
            price: v.price || null,
          }))
        }
      }))
    }

    return json({
      rows,
      has_more: products.length === 100,
      products_on_page: products.length,
      variable_count: variableProducts.length,
    })
  }

  // ── one page of the catalogue as PRODUCT-shaped rows for the overview +
  // SEO checklist (WooCatalogue.jsx) ───────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // Distinct from products_page (which flattens to one row per variation for
  // stock matching). Here each row IS a product, variations nested, plus the
  // fields an SEO heuristic needs — trimmed server-side (word counts, alt
  // coverage) so the cached payload stays small. Client-paginated, same
  // reasoning as products_page.
  if (body.op === 'catalogue_page') {
    const page = Math.max(1, parseInt(body.page, 10) || 1)
    const r = await wc('products', { per_page: 100, page, status: 'any', orderby: 'id', order: 'asc' })
    if (!r.ok) return json({ error: 'WooCommerce product fetch failed', detail: (await r.text()).slice(0, 300) }, 502)
    const products = await r.json()

    const wordCount = (html) => {
      const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').trim()
      return text ? text.split(/\s+/).length : 0
    }
    const attrPairs = (list) => (list || []).map(a => ({ name: a.name, option: a.option ?? a.options?.join(', ') ?? '' }))

    // Variations for variable products, in parallel batches of 6.
    const variableProducts = products.filter(p => p.type === 'variable')
    const varsByProduct = new Map()
    for (let i = 0; i < variableProducts.length; i += 6) {
      await Promise.all(variableProducts.slice(i, i + 6).map(async (p) => {
        const acc = []
        for (let vp = 1; vp <= 10; vp++) {
          const vr = await wc(`products/${p.id}/variations`, { per_page: 100, page: vp })
          if (!vr.ok) break
          const rows = await vr.json()
          acc.push(...rows)
          if (rows.length < 100) break
        }
        varsByProduct.set(p.id, acc)
      }))
    }

    const rows = products.map(p => {
      const images = p.images || []
      const vars = varsByProduct.get(p.id) || []
      return {
        product_id: p.id,
        type: p.type,
        status: p.status,                         // publish | draft | pending | private
        catalog_visibility: p.catalog_visibility, // visible | catalog | search | hidden
        name: p.name,
        name_len: (p.name || '').length,
        slug: p.slug || '',
        permalink: p.permalink || null,
        sku: p.sku || '',
        categories: (p.categories || []).map(c => c.name),
        tag_count: (p.tags || []).length,
        price: p.price || null,
        regular_price: p.regular_price || null,
        sale_price: p.sale_price || null,
        on_sale: !!p.on_sale,
        stock_status: p.stock_status || null,
        stock_quantity: Number.isFinite(p.stock_quantity) ? p.stock_quantity : null,
        total_sales: Number.isFinite(p.total_sales) ? p.total_sales : 0,
        date_created: p.date_created || null,
        date_modified: p.date_modified || null,
        image_count: images.length,
        images_missing_alt: images.filter(im => !String(im.alt || '').trim()).length,
        description_words: wordCount(p.description),
        short_description_words: wordCount(p.short_description),
        variations: vars.map(v => ({
          variation_id: v.id, sku: v.sku || '',
          attributes: attrPairs(v.attributes),
          price: v.price || null,
          stock_status: v.stock_status || null,
          stock_quantity: Number.isFinite(v.stock_quantity) ? v.stock_quantity : null,
        })),
      }
    })

    return json({ rows, has_more: products.length === 100, products_on_page: products.length })
  }

  // ── diagnostic: does this WordPress expose translation status (WPML /
  // Polylang) and SEO meta (Yoast / RankMath) over REST? ────────────────────
  // Purely reports what each candidate endpoint returns — nothing here is
  // wired into the catalogue yet. Same shape as probe_payout.
  if (body.op === 'probe_i18n_seo') {
    const results = []
    const tryJson = async (label, promise) => {
      try {
        const r = await promise
        const text = await r.text()
        let parsed = null
        try { parsed = JSON.parse(text) } catch { /* keep raw */ }
        results.push({ label, status: r.status, ok: r.ok, sample: parsed ? JSON.stringify(parsed).slice(0, 1200) : text.slice(0, 800) })
      } catch (e) {
        results.push({ label, status: null, ok: false, sample: String(e?.message || e).slice(0, 300) })
      }
    }
    await tryJson('wp-json root (namespaces)', wpJson(''))
    await tryJson('wc/v3/products first row keys', wc('products', { per_page: 1 }))
    await tryJson('wp/v2/types/product', wpJson('wp/v2/types/product'))
    await tryJson('wp/v2/product first (lang/translations/yoast)', wpJson('wp/v2/product?per_page=1&_fields=id,slug,status,lang,translations,yoast_head_json'))
    await tryJson('pll/v1 languages (Polylang)', wpJson('pll/v1/languages'))
    return json({ results })
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
