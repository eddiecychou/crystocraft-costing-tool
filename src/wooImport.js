// WooCommerce → app order import — Phase 2 (WooCommerce_B2C_Sync_Spec.md §2.4a,
// §4). Maps one summarized WooCommerce order (from wooSyncApi.js's
// listWooOrders) onto the SAME `orders/{id}` model every other order already
// uses, landing it directly in the existing "awaiting invoice" list on
// SalesInvoices.jsx — no new invoicing UI, no new Firestore collection. This
// creates FIRESTORE writes (unlike everything in woo-sync.js so far, which is
// read-only): it creates a draft/confirmed order. It does NOT allocate an
// invoice number or a UC# — that stays a manual step Cindy takes from the
// existing Sales Invoices page, same as any other order (Phase 3).
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { createOrderWithLinesAtId, ORDER_CURRENCIES } from './shipping'

// Deterministic Firestore doc ID from the WooCommerce order id — the actual
// idempotency mechanism (spec §2.3/§9): re-importing the same WooCommerce
// order always resolves to the same doc, so createOrderWithLinesAtId's
// check-then-create can never produce a duplicate order for it.
export const wooOrderDocId = (wooOrderId) => `woo-${wooOrderId}`

// spec §3.2 — the exact display format Cindy asked for. Exported so
// wooRefundImport.js's Credit Note drafts use the identical format —
// a refund's Credit Note should read as the same customer as the invoice
// it's crediting, not a differently-formatted name for the same person.
export const wooCustomerName = (name) => `O07 Online Crystocraft - "${name || 'Unnamed customer'}"`

// V8.9 — Cindy's WooCommerce→SI/UC spec: every synced order's SI/UC
// "Customer link" now points at a REAL customer record (customers/{id}),
// not just this formatted text label. One shared record for the whole
// online-shop channel, created once (scripts/create-o07-customer.mjs, now
// deleted) — deliberately NOT customer_type:'retail' (that's for real
// individual buyers, see linkCustomerToWoo; O07 itself isn't a person and
// must stay out of Daily Drafts' retail-audience outreach).
const O07_CUSTOMER_ID = 'online-crystocraft-o07'

// Three WooCommerce orders that already had a UC allocated by hand before
// this feature existed (Cindy, 2026-08-24) — pre-filling header.uc_no for
// these makes ShipmentForm.jsx's existing doAllocateSi() reuse that UC
// (allocateInvoice's `uc_no` param) instead of minting a new one, same
// mechanism "Duplicate order" avoids on purpose elsewhere. Every OTHER
// WooCommerce order gets no uc_no here, so a fresh one is allocated as
// normal.
const KNOWN_UC_BY_WOO_ORDER_NO = { '57669': 'UC4958', '57670': 'UC4959', '57844': 'UC4960' }

// Woo doesn't carry a real ship-out date (Cuiling arranges shipping
// separately, not tracked in WooCommerce) — owner, 2026-08-24: not worth
// making Cindy fill this by hand for every order, a B2C order typically
// ships 1-3 days after payment, so default to +2 days as an editable
// placeholder rather than leaving it blank.
function estimatedShipDate(orderDate) {
  if (!orderDate) return null
  const d = new Date(`${orderDate}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 2)
  return d.toISOString().slice(0, 10)
}

// A WooCommerce order can be in any of AED/CAD/EUR/GBP/HKD/MXN/RMB/USD (the
// app's own ORDER_CURRENCIES, already measured against real sales orders) —
// if WooCommerce ever reports something outside that list, normOrder would
// silently coerce it to USD, corrupting the amount (spec §3.7 — never
// convert). Surfaced as an explicit rejection instead.
export function wooCurrencySupported(currency) {
  return ORDER_CURRENCIES.includes(String(currency || '').toUpperCase())
}

// Builds the {header, lines} pair for createOrderWithLinesAtId. `o` is one
// row from listWooOrders' `rows` (already carries gateway_fee/net_payout/
// payout_date/deposit_id — see woo-sync.js).
export function mapWooOrderToOrder(o) {
  const currency = String(o.currency || '').toUpperCase()

  // Product lines, priced at their PRE-discount per-unit subtotal — the
  // header's own discount_amount (below) carries the order-level discount,
  // so a line's unit_price must not also have it baked in, or the discount
  // would effectively apply twice once computeOrderTotals recomputes from
  // lines (shipping.js's own convention: subtotal is pre-discount, total is
  // post-discount+charges).
  const productLines = (o.line_items || []).map((l) => ({
    item_code: l.sku || '',
    description: l.name,
    qty_ordered: l.quantity,
    unit: 'pcs',
    unit_price: l.quantity ? +(l.subtotal / l.quantity).toFixed(2) : l.subtotal,
    line_type: 'ad_hoc',        // not matched to any app catalogue product — see LINE_TYPES in shipping.js
    match_status: 'manual',     // deliberately not "unmatched" — there is nothing to match against, not an oversight
  }))

  // Shipping/tax as flat charge lines (qty=null → chargesTotal, not
  // subtotal — shipping.js's computeOrderTotals already treats a
  // no-quantity line exactly this way for freight/insurance on a PI import,
  // so this is the SAME mechanism, not a new one). Discount is NOT a line —
  // it's the header's own discount_amount field, which every order already
  // has and prints as its own line on the invoice.
  const chargeLines = []
  if (o.shipping_total) chargeLines.push({
    item_code: '', description: 'Shipping', qty_ordered: null, unit: 'pcs',
    unit_price: o.shipping_total, line_type: 'non_product', match_status: 'manual',
  })
  if (o.tax_total) chargeLines.push({
    item_code: '', description: 'Tax', qty_ordered: null, unit: 'pcs',
    unit_price: o.tax_total, line_type: 'non_product', match_status: 'manual',
  })

  // Fee/net/payout — automatable per spec §3.6/§8's "Fee details" (resolved
  // 2026-08-22, see WooCommerce_B2C_Sync_Spec.md §3): folded into notes so
  // it travels with the order onto the printed invoice's Remarks field
  // (SalesInvoicePrint.jsx) without needing a new schema field.
  const feeNote = o.gateway_fee != null
    ? `Gateway fee: ${currency} ${o.gateway_fee.toFixed(2)} · Net payout: ${currency} ${(o.net_payout ?? '').toFixed?.(2) ?? o.net_payout}${o.payout_date ? ` · Payout ${o.payout_date}` : ''}`
    : null
  const notes = [
    `WooCommerce order #${o.number}`,
    feeNote,
    o.customer_note ? `Customer note: ${o.customer_note}` : null,
  ].filter(Boolean).join('\n')

  const orderDate = (o.date_paid || o.date_created || '').slice(0, 10)  // spec §3.3 — payment date, not order-created date

  const header = {
    source: 'woocommerce',
    channel: 'woocommerce',
    woo_order_id: o.id,
    woo_order_no: String(o.number),
    // V8.9 (Cindy's spec) — Customer link = the real O07 record;
    // Customer PO = the actual buyer's name (previously only baked into
    // customer_name's display text, now its own field too).
    customer_id: O07_CUSTOMER_ID,
    customer_name: wooCustomerName(o.customer_name),
    customer_po: o.customer_name || '',
    order_date: orderDate,
    est_ship_date: estimatedShipDate(orderDate),
    currency: wooCurrencySupported(currency) ? currency : 'USD',
    // V8.9 — 'draft', not 'confirmed': Cindy's spec has SI/UC generated
    // explicitly ("when save changes in SI, generate new SI number..."),
    // not silently the moment a sync runs. A draft stays out of
    // SalesInvoices.jsx's AWAITING/invoiceable set until reviewed and
    // moved forward, same posture wooRefundImport.js's Credit Note drafts
    // already use.
    status: 'draft',
    // Pre-filled only for the 3 known already-has-a-UC orders — see
    // KNOWN_UC_BY_WOO_ORDER_NO above. ShipmentForm.jsx's doAllocateSi()
    // already passes header.uc_no through to allocateInvoice() to reuse an
    // existing UC rather than mint a new one; every other order gets '' here
    // (unchanged default) and allocates fresh, same as before.
    uc_no: KNOWN_UC_BY_WOO_ORDER_NO[String(o.number)] || '',
    payment_terms: 'Paid online (WooCommerce)',
    notes,
    subtotal: o.subtotal,
    discount_amount: o.discount_total || 0,
    total_amount: o.total,
    // Structured, for the Phase 5 accounting export — see normOrder in
    // shipping.js. `notes` above keeps the human-readable version.
    woo_fee: o.gateway_fee,
    woo_net_payout: o.net_payout,
    woo_payout_date: o.payout_date || null,
  }

  return { header, lines: [...productLines, ...chargeLines] }
}

// Imports one WooCommerce order. Returns { id, created }. created:false means
// it was already imported (re-running a sync is always safe — spec §9).
export async function importWooOrder(o) {
  const { header, lines } = mapWooOrderToOrder(o)
  return createOrderWithLinesAtId(wooOrderDocId(o.id), header, lines)
}

// Which of these WooCommerce order IDs already have an imported order doc —
// used by the sync page to show "Imported" instead of an active button. One
// direct-by-ID read per order (not a query): the doc ID IS the answer, so
// this is exactly as cheap as it looks, no index or collection scan involved.
export async function checkImportedWooOrders(wooOrderIds) {
  const found = new Set()
  await Promise.all((wooOrderIds || []).map(async (id) => {
    const snap = await getDoc(doc(db, 'orders', wooOrderDocId(id)))
    if (snap.exists()) found.add(id)
  }))
  return found
}

// Retail Customer segment (2026-08-22) — links an EXISTING `customers/{id}`
// record to its real WooCommerce identity, once an admin has confirmed via
// "Find a customer's order history" (WooCommerceSync.jsx) that the order
// actually belongs to that person. This is the explicit-review merge path
// the design calls for — never automatic, never triggered by an email match
// alone. Purely additive: only ever sets these three fields on a customer
// doc that already exists; never creates a new customer, never touches
// tags/crm_category/contacts/anything else. Idempotent — re-linking the same
// pair just overwrites the same three fields with the same values.
export async function linkCustomerToWoo(customerId, wooCustomerId) {
  await updateDoc(doc(db, 'customers', customerId), {
    source: 'WooCommerce',
    customer_type: 'retail',
    woo_customer_id: wooCustomerId || null,
    updatedAt: serverTimestamp(),
  })
}
