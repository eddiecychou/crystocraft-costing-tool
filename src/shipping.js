import { INCOTERMS, PAYMENT_TERMS, ORDER_CURRENCIES, ORDER_STATUSES, orderStatusOf, NO_INVOICE_REASONS, noInvoiceReasonOf, LINE_TYPES, lineTypeOf, isPackable, orderUc, orderSi, orderSoDisplay, normOrder, normLine, computeOrderTotals, validateOrderLine, validateOrder } from './shippingModel.js'
export { INCOTERMS, PAYMENT_TERMS, ORDER_CURRENCIES, ORDER_STATUSES, orderStatusOf, NO_INVOICE_REASONS, noInvoiceReasonOf, LINE_TYPES, lineTypeOf, isPackable, orderUc, orderSi, orderSoDisplay, normOrder, normLine, computeOrderTotals, validateOrderLine, validateOrder } from './shippingModel.js'
export {wooRegistryAutofillFields,invoiceRegistryFields,savedInvoiceRegistryFields} from './invoiceRegistryFields.js'
import { useState, useEffect } from 'react'
import { orderEditBase, sameOrderEditBase, orderEditPatch, orderEditConflict } from './orderEditModel.js'
import {
  collection, doc, getDoc, getDocs, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, runTransaction, getDocFromServer, getDocsFromServer,
} from 'firebase/firestore'
import { db } from './firebase'
import { numOrNull } from './domain/validation'
import { invoiceReferenceRevision } from './invoiceRecoveryModel.js'
import { buildProductIndex, matchProductCode } from './criticalComponents'
import { orderDeletionBlock } from './orderDeletion'
import { JES_SEED_BY_YEAR, soYear, formatSoNo } from './soNumber'

// Shipping module — Phase 12.0. An `order` is the commercial anchor for a
// shipment, sourced from an in-app won quote (Path A) or an imported ERP
// proforma invoice (Path B, figurine-only for v1). The app CONSUMES the PI; it
// never authors it (guardrail 1). Order lines are classified in reconciliation
// (guardrail 4) — every line gets a type, and only packable lines reach the
// packing list.
//
//   orders/{id}
//   orders/{id}/lines/{lineId}

// ── Constants ─────────────────────────────────────────────────────────────────

// ── SKU matcher (PI line → figurine product) ─────────────────────────────────
// Delegates to the shared, format-aware matcher (buildProductIndex +
// matchProductCode) so PI reconciliation, the stock-list import, and the MRP
// explosion all agree. Matching on design core ALONE is wrong: "D0355-001"
// (Mini Rose Freestand, format 001) and "D0355-230" (Mini Rose w/ Crystal Bible,
// format 230) share design 0355 but are different products — the format
// disambiguates them.
export function matchRangeProduct(itemCode, rangeProducts) {
  return itemCode ? matchProductCode(itemCode, buildProductIndex(rangeProducts)) : null
}

// ── orders ────────────────────────────────────────────────────────────────────

const ORDERS = () => collection(db, 'orders')
const LINES  = orderId => collection(db, 'orders', orderId, 'lines')

const orderFromDoc = d => ({ id: d.id, ...normOrder(d.data()), _raw: d.data() })

export async function getOrder(id) {
  const snap = await getDoc(doc(db, 'orders', id))
  return snap.exists() ? { id: snap.id, ...normOrder(snap.data()) } : null
}

export async function getOrderLines(orderId) {
  const snap = await getDocs(query(LINES(orderId), orderBy('line_no')))
  return snap.docs.map(d => ({ id: d.id, ...normLine(d.data()) }))
}

// Create an order with its lines in one batch. Returns the new order id.
// Returns the new order id synchronously (available before the write lands) plus
// the commit promise. With persistentLocalCache the write is durable in the
// local cache immediately and syncs in the background, so callers can navigate
// optimistically instead of blocking on the server ack (which can hang if the
// network stalls — the doc is already "saved" locally either way).
function newOrderFields(data) {
  const clean={...data}
  delete clean.invoice_allocation_id;delete clean.invoice_reference_revision
  return normOrder(clean)
}

export function createOrderWithLines(orderData, lines) {
  const orderRef = doc(ORDERS())
  const batch = writeBatch(db)
  batch.set(orderRef, { ...newOrderFields(orderData), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  ;(lines || []).forEach((l, i) => {
    const n = normLine(l)
    if (n.line_no == null) n.line_no = i + 1
    batch.set(doc(LINES(orderRef.id)), n)
  })
  return { id: orderRef.id, commit: batch.commit() }
}

// Same as createOrderWithLines, but the order lands at a CALLER-CHOSEN doc
// ID rather than an auto-generated one, and refuses to create a second order
// there if one already exists. This is the actual idempotency mechanism for
// the WooCommerce importer (docs/specs/WooCommerce_B2C_Sync_Spec.md §2.3/§2.4): the doc
// ID is derived from the WooCommerce order id (wooOrderDocId in wooImport.js),
// so re-running an import for an order already brought in is a no-op instead
// of a duplicate order — the check-then-create happens inside one
// transaction, so two overlapping imports of the same order cannot both pass
// the check and both write (a plain getDoc-then-set has exactly that race).
// Returns { id, created: bool } — created:false means it already existed and
// nothing was written.
export async function createOrderWithLinesAtId(id, orderData, lines) {
  const orderRef = doc(db, 'orders', id)
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(orderRef)
    if (existing.exists()) return { id, created: false }
    tx.set(orderRef, { ...newOrderFields(orderData), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    ;(lines || []).forEach((l, i) => {
      const n = normLine(l)
      if (n.line_no == null) n.line_no = i + 1
      tx.set(doc(LINES(id)), n)
    })
    return { id, created: true }
  })
}

// Same as createOrderWithLines, but optionally allocates the order's SO
// number INSIDE the same Firestore transaction, so the two either both land
// or neither does.
//
// Before this (bug-fix pack B-02), ShipmentForm.jsx allocated the SO number
// first (its own runTransaction against counters/so_<yy>, see soNumber.js)
// and only THEN wrote the order in a separate batch. If that second write
// failed — a network hiccup, a rules rejection, anything after the number
// was already burned — the SO series got a real, permanent gap: the number
// is gone and no order exists to explain why. Reads the SAME counter doc and
// seed table soNumber.js's own allocateSoNo() uses, so the two paths can
// never issue conflicting numbers.
export async function createOrderWithLinesAllocatingSo(orderData, lines, { allocateSo } = {}) {
  return runTransaction(db, async (tx) => {
    let so = orderData.erp_so_no || ''
    if (allocateSo && !so) {
      const yy = soYear()
      const seed = Number(JES_SEED_BY_YEAR[yy]) || 0
      const counterRef = doc(db, 'counters', `so_${yy}`)
      // Firestore transactions require every read before any write.
      const snap = await tx.get(counterRef)
      const last = snap.exists() ? (Number(snap.data().last) || 0) : seed
      const next = last + 1
      so = formatSoNo(yy, next)
      tx.set(counterRef, { last: next, year: yy, kind: 'so', updated_at: new Date().toISOString() }, { merge: true })
    }
    const orderRef = doc(ORDERS())
    tx.set(orderRef, { ...newOrderFields({ ...orderData, erp_so_no: so }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    ;(lines || []).forEach((l, i) => {
      const n = normLine(l)
      if (n.line_no == null) n.line_no = i + 1
      tx.set(doc(LINES(orderRef.id)), n)
    })
    return { id: orderRef.id, so }
  })
}

export async function updateOrder(id, patch) {
  await updateDoc(doc(db, 'orders', id), { ...patch, updatedAt: serverTimestamp() })
}

// Reconcile the order's lines subcollection to exactly the lines passed in:
// update existing, create new, delete removed. One batch, so it is atomic.
//
// This replaced a version that did `batch.update` per line and skipped any line
// with no id. Three ways that silently lost CuiLing's edits (all reproduced):
//   - a newly added line has no id, so it was skipped and never saved;
//   - a line whose doc no longer exists made `update` throw NOT_FOUND, which
//     failed the WHOLE batch — every edit in that save was lost, while the
//     header (written separately) still saved, so it looked like nothing stuck;
//   - a removed line was only dropped from form state, never from Firestore, so
//     it reappeared on the next load.
// `set(..., { merge:true })` creates-or-updates and cannot throw on a missing
// doc, and the diff deletes what the user removed. The lines subcollection ends
// up matching the form, whatever state it was in before.
// Server-confirmed header/line snapshot. Versioned line writes also advance the
// root, so equal versions around this query establish one editable baseline.
export async function getOrderEditSnapshot(orderId) {
  const ref = doc(db, 'orders', orderId)
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await getDocFromServer(ref)
    if (!before.exists()) throw Object.assign(Error('This order could not be found.'), { code: 'not-found' })
    const items = await getDocsFromServer(LINES(orderId))
    const after = await getDocFromServer(ref)
    if (!after.exists()) throw Object.assign(Error('This order could not be found.'), { code: 'not-found' })
    const base = orderEditBase(after.data())
    if (sameOrderEditBase(orderEditBase(before.data()), base)) {
      const lines = items.docs.map(d => ({ id: d.id, ...normLine(d.data()) }))
      lines.sort((a,b) => (a.line_no ?? Number.MAX_SAFE_INTEGER) - (b.line_no ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
      return { order: { id: orderId, ...normOrder(after.data()) }, lines, base,
        deletionBlock: orderDeletionBlock(after.data()),
        lastEditId: after.data().last_edit_id || '' }
    }
  }
  throw Error('This order is being updated. Retry loading it before editing.')
}

// Retained narrow API. Callers editing an earlier snapshot pass that baseline.
export async function saveOrderLines(orderId, lines, options) {
  return saveOrderWithLines(orderId, {}, lines, options)
}

export async function saveOrderWithLines(orderId, patch, lines, options = {}) {
  const base = options.base || (await getOrderEditSnapshot(orderId)).base
  const attemptId = options.attemptId || crypto.randomUUID()
  const existing = await getDocs(LINES(orderId))
  const deletions = existing.docs.filter(d => !(lines || []).some(line => line.id === d.id)).length
  if (1 + (lines || []).length + deletions > 500)
    throw Error('This edit exceeds the atomic save limit. Keep this draft and reduce the number of line changes.')
  const batch = writeBatch(db)
  batch.update(doc(db, 'orders', orderId), { ...patch, ...orderEditPatch(base, attemptId), updatedAt: serverTimestamp() })
  reconcileOrderLines(batch, orderId, lines, existing)
  try {
    await batch.commit()
    return { attemptId }
  } catch (error) {
    // A lost acknowledgement can be checked without issuing another batch.
    // Genuine access failures retain their original error and never become success.
    let latest
    try { latest = await getOrderEditSnapshot(orderId) } catch { throw error }
    if (latest.lastEditId === attemptId && latest.base.revision === base.revision + 1)
      return { attemptId }
    if (!sameOrderEditBase(latest.base, base)) throw orderEditConflict(latest)
    throw error
  }
}

function reconcileOrderLines(batch, orderId, lines, existing) {
  const keep = new Set()
  for (const l of (lines || [])) {
    const ref = l.id ? doc(db, 'orders', orderId, 'lines', l.id)
                     : doc(collection(db, 'orders', orderId, 'lines'))
    keep.add(ref.id)
    batch.set(ref, normLine(l), { merge: true })
  }
  for (const d of existing.docs) {
    if (!keep.has(d.id)) batch.delete(d.ref)
  }
}

// Live order list.
// No orderBy('createdAt') here — Firestore's orderBy is a FILTER as well as a
// sort: any doc missing that field (or, transiently, one whose serverTimestamp()
// hasn't resolved from a pending write yet — e.g. right after createOrderWithLines)
// is silently excluded from the query results entirely, not just left unsorted.
// That's exactly why a newly-created PI could vanish from every screen that reads
// useOrders() (Orders list, MRP Requirements picker, Dashboard). Fetch everything,
// sort client-side instead — same fix already applied to loadCustomers.
export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(
    ORDERS(),
    snap => {
      const list = snap.docs.map(orderFromDoc)
      list.sort((a, b) => (b._raw?.createdAt?.seconds || 0) - (a._raw?.createdAt?.seconds || 0))
      setOrders(list)
      setLoading(false)
    },
    () => setLoading(false),
  ), [])
  return { orders, loading }
}

// All figurine products (for SKU matching during import / reconciliation).
export async function loadRangeProductsLite() {
  try {
    const snap = await getDocs(collection(db, 'range_products'))
    return snap.docs.map(d => {
      const x = d.data()
      return {
        id: d.id,
        // The product's real display name is entered in the Description field
        // (RangeForm has no separate design-name input — design_name/name are
        // legacy/unused on current products), so that must be the last fallback.
        name: x.design_name || x.name || x.description || '',
        brand_code: x.brand_code || '',
        design_no: x.design_no || '',
        design_code: x.design_code || '',
        format_code: x.format_code || '',   // required to disambiguate same-design products by format
      }
    })
  } catch {
    return []
  }
}

// Fields filled after allocating a WooCommerce invoice in the UC Registry.
// Merge parsed PI fields into the current shipment draft.
export function applyExtractedPiHeader(header, data, customers) {
  let customer_id = header.customer_id
  let customer_name = header.customer_id ? header.customer_name : (data.customer_name || header.customer_name)
  if (!customer_id && data.customer_name) {
    const lower = data.customer_name.toLowerCase()
    const match = customers.find(c => {
      const cn = (c.company_name || '').toLowerCase()
      return cn && (lower.includes(cn) || cn.includes(lower))
    })
    if (match) {
      customer_id = match.id
      customer_name = match.company_name
    }
  }
  return {
    ...header,
    customer_id,
    customer_name,
    // The parser's "pi_no" is the UC reference on the document (the
    // PDFs are named e.g. "… UC4920-26.pdf"), so it lands in uc_no now.
    uc_no: data.pi_no || header.uc_no,
    erp_so_no: data.so_no || header.erp_so_no,
    order_date: data.order_date || header.order_date,
    est_ship_date: data.est_ship_date || header.est_ship_date,
    currency: ['USD', 'EUR', 'RMB', 'HKD'].includes(data.currency) ? data.currency : header.currency,
    incoterm: INCOTERMS.includes(data.incoterm) ? data.incoterm : header.incoterm,
    payment_terms: data.payment_terms != null ? data.payment_terms : header.payment_terms,
    // The parsed PI totals are the stated reference, not the order value.
    pi_subtotal:     data.subtotal        != null ? data.subtotal        : header.pi_subtotal,
    discount_pct:    data.discount_pct    != null ? data.discount_pct    : header.discount_pct,
    discount_amount: data.discount_amount != null ? data.discount_amount : header.discount_amount,
    pi_total:        data.total_amount    != null ? data.total_amount    : header.pi_total,
  }
}

// Fields applied when a user classifies a shipment line.
export function lineClassificationPatch(line, type, rangeProducts) {
  // Switching to figurine re-runs the match; other types clear the product ref.
  if (type === 'range') {
    const product = line.item_code ? matchRangeProduct(line.item_code, rangeProducts) : null
    return {
      line_type: 'range', packable: true,
      matched_product_ref: product ? { collection: 'range_products', id: product.id, name: product.name } : null,
      match_status: product ? 'manual' : 'unmatched',
      // Fill Description from the match, but only if it's still empty.
      description: product ? (line.description || product.name || line.description) : line.description,
    }
  }

  return { line_type: type, packable: isPackable(type), matched_product_ref: null, match_status: 'manual' }
}

// Apply auto-match to freshly-extracted PI lines. Sets line_type=range +
// matched_product_ref + match_status on hits; leaves the rest unmatched for the
// user to classify (ad_hoc / non_product). "Promote to catalogue" is deferred.
export function autoMatchLines(lines, rangeProducts) {
  const index = buildProductIndex(rangeProducts)   // build once, reuse per line
  return (lines || []).map((l, i) => {
    const p = l.item_code ? matchProductCode(l.item_code, index) : null
    if (p) {
      return {
        ...l, line_no: l.line_no ?? i + 1,
        line_type: 'range', packable: true,
        matched_product_ref: { collection: 'range_products', id: p.id, name: p.name },
        match_status: 'matched',
        // Fill Description from the catalogue match, but only if it's still
        // empty — never clobber a description already extracted from the PI
        // or typed by hand (which can carry customer-specific detail like
        // "Tunes: You are my Sunshine" that isn't in the catalogue record).
        description: l.description || p.name || l.description,
      }
    }
    return { ...l, line_no: l.line_no ?? i + 1, line_type: null, match_status: 'unmatched' }
  })
}

// Re-run auto-match on already-loaded lines, PRESERVING any line the user
// classified manually (match_status 'manual'). Used by the reconciliation
// "Re-match" button to correct PIs that were auto-matched by the old matcher.
export function rematchLines(lines, rangeProducts) {
  const index = buildProductIndex(rangeProducts)
  return (lines || []).map((l, i) => {
    if (l.match_status === 'manual') return l
    const p = l.item_code ? matchProductCode(l.item_code, index) : null
    if (p) {
      return {
        ...l, line_no: l.line_no ?? i + 1,
        line_type: 'range', packable: true,
        matched_product_ref: { collection: 'range_products', id: p.id, name: p.name },
        match_status: 'matched',
        description: l.description || p.name || l.description,
      }
    }
    return { ...l, line_no: l.line_no ?? i + 1, line_type: null, matched_product_ref: null, match_status: 'unmatched' }
  })
}

// Subtotal/discount/total derived from line items, mirroring the "Order
// Totals" card shown in the editor. Used both to render that card and, as a
// fallback on save, to persist a value when the PI extraction never captured
// a stated total — otherwise the order silently has no total_amount even
// though a correct one is computable and was visible on screen.
//
// A line with no quantity (e.g. a flat Freight/Insurance charge — the
// extractor leaves qty_ordered null for pure charges, putting the flat amount
// in unit_price) is a lump sum, not a per-unit price for zero units. Those
// lines are kept OUT of `subtotal` (which mirrors the PI's own product-only
// "Subtotal" field, so the ✓/⚠ comparison against header.subtotal stays
// meaningful) and rolled into `chargesTotal` instead, which IS added into the
// final total — otherwise freight/insurance silently vanish from the total.
// Editable fields loaded from an existing shipment order. The editor supplies
// its destination defaults; the saved-record whitelist and fallbacks stay intact.
export function orderEditFields(o, blankDestination) {
  return {
    ...(o.quote_conversion_id?{quote_conversion_id:o.quote_conversion_id,client_quote_id:o.client_quote_id,source:o.source}:{}),
    ...(o.source==='direct_invoice'?{source:o.source}:{}),
    ...(o.invoice_allocation_id ? {invoice_allocation_id:o.invoice_allocation_id,invoice_reference_revision:invoiceReferenceRevision(o)} : {}),
    customer_id: o.customer_id, contact_id: o.contact_id || '', customer_name: o.customer_name,
    // uc_no is seeded through orderUc so an order whose UC lives in the
    // legacy erp_pi_no shows it in the UC# field and does not look
    // un-allocated to doAllocateSi. erp_pi_no is still carried so
    // saving does not silently drop it.
    erp_pi_no: o.erp_pi_no, erp_so_no: o.erp_so_no || '', erp_si_no: o.erp_si_no || '', uc_no: orderUc(o),
    customer_po: o.customer_po || '',
    invoiced_at: o.invoiced_at || '',
    invoice_date: o.invoice_date || '',
    accounting_total: o.accounting_total ?? '',
    adjustment_reason: o.adjustment_reason || '',
    order_date: o.order_date || '',
    est_ship_date: o.est_ship_date || '',
    currency: o.currency, incoterm: o.incoterm, payment_terms: o.payment_terms || '', status: o.status,
    destination: { ...blankDestination, ...o.destination }, notes: o.notes,
    discount_pct:    o.discount_pct    ?? '',
    discount_amount: o.discount_amount ?? '',
    deposit_paid: o.deposit_paid ?? '',
    total_amount: o.total_amount ?? null,
    hide_total_qty: !!o.hide_total_qty,
    pi_revision: o.pi_revision ? String(o.pi_revision) : '',
    // Reference figures for the mismatch check. New orders carry their
    // own pi_* fields; older imported orders predate them and still
    // hold the PI value in subtotal/total_amount, so fall back to those.
    pi_subtotal: o.pi_subtotal ?? (o.source === 'imported_pi' ? o.subtotal : null) ?? '',
    pi_total:    o.pi_total    ?? (o.source === 'imported_pi' ? o.total_amount : null) ?? '',
    // WooCommerce B2C sync (spec Phase 3) — carried through so the
    // save path (handleSave) can pass it on to upsert_invoice.
    // Missing from this whitelist would silently drop it on every
    // load, same trap contact_id hit before it was added here.
    channel: o.channel || null,
    woo_order_no: o.woo_order_no || '',
    // V8.10 — these three were the SAME trap: doAllocateSi()'s UC
    // Registry fee-note auto-fill (below) reads header.woo_fee /
    // woo_net_payout / woo_payout_date, but none of them were ever
    // added to this load whitelist, so it silently produced a
    // fee-less remarks note for every WooCommerce order opened by ID
    // (the normal path — not just right after import). Fixed here,
    // not by chasing the symptom in doAllocateSi.
    woo_fee: o.woo_fee ?? null,
    woo_net_payout: o.woo_net_payout ?? null,
    woo_net_payout_hkd: o.woo_net_payout_hkd ?? null,
    woo_payout_date: o.woo_payout_date || null,
  }
}

// Header fields for a new shipment order before its creation transaction.
export function orderCreateFields(header, computed, sourceFile, isDirect) {
  // Was hardcoded 'imported_pi' for every creation path (bug-fix pack
  // B-02) — a manually-typed order or a Direct Invoice got the same
  // source as a genuinely PI-parsed one, which matters because
  // normOrder's pi_subtotal/pi_total fallback (see shipping.js) trusts
  // 'imported_pi' orders to have a real stated-PI figure behind them.
  // isDirect: the retail "Direct Invoice" flow (?direct=1). sourceFile: a PI was
  // actually uploaded and parsed this session (pendingFile, set only by
  // the drag-drop importer). Neither: typed by hand.
  const source = isDirect ? 'direct_invoice' : sourceFile ? 'imported_pi' : 'manual'
  return {
    ...header,
    source, source_file: sourceFile,
    // Actual value = computed from the lines. PI figures kept only as the
    // stated reference for the mismatch check.
    subtotal:        computed.subtotal > 0 ? computed.subtotal : null,
    total_amount:    computed.subtotal > 0 ? computed.total : null,
    pi_subtotal:     header.pi_subtotal !== '' ? parseFloat(header.pi_subtotal) : null,
    pi_total:        header.pi_total    !== '' ? parseFloat(header.pi_total)    : null,
    discount_pct:    header.discount_pct    !== '' ? parseFloat(header.discount_pct)    : null,
    discount_amount: header.discount_amount !== '' ? parseFloat(header.discount_amount) : (computed.discountAmount > 0 ? computed.discountAmount : null),
    deposit_paid: header.deposit_paid !== '' ? Number(header.deposit_paid) : null,
    pi_revision: header.pi_revision !== '' ? parseInt(header.pi_revision, 10) || null : null,
  }
}

// Persisted header fields for an existing shipment order.
export function orderSaveFields(header, computed, accountingTotal, adjustment) {
  return {
    customer_id: header.customer_id, contact_id: header.contact_id || null, customer_name: header.customer_name,
    erp_pi_no: header.erp_pi_no, erp_so_no: header.erp_so_no, erp_si_no: header.erp_si_no,
    customer_po: header.customer_po,
    invoiced_at: header.invoiced_at || null, uc_no: header.uc_no,
    invoice_date: header.invoice_date || null,
    accounting_total: header.erp_si_no ? accountingTotal : null,
    adjustment: header.erp_si_no && Math.abs(adjustment) > 0.005 ? adjustment : null,
    adjustment_reason: header.erp_si_no ? header.adjustment_reason.trim() : '',
    order_date: header.order_date || null,
    est_ship_date: header.est_ship_date || null,
    currency: header.currency, incoterm: header.incoterm, payment_terms: header.payment_terms, status: header.status,
    destination: header.destination, notes: header.notes,
    hide_total_qty: !!header.hide_total_qty,
    pi_revision: header.pi_revision !== '' ? parseInt(header.pi_revision, 10) || null : null,
    // Actual value follows the lines; PI figures stay as the reference.
    subtotal:        computed.subtotal > 0 ? computed.subtotal : null,
    total_amount:    computed.subtotal > 0 ? computed.total : null,
    pi_subtotal:     header.pi_subtotal !== '' ? parseFloat(header.pi_subtotal) : null,
    pi_total:        header.pi_total    !== '' ? parseFloat(header.pi_total)    : null,
    discount_pct:    header.discount_pct    !== '' ? parseFloat(header.discount_pct)    : null,
    discount_amount: header.discount_amount !== '' ? parseFloat(header.discount_amount) : (computed.discountAmount > 0 ? computed.discountAmount : null),
    deposit_paid: header.deposit_paid !== '' ? Number(header.deposit_paid) : null,
  }
}

// ── Validators (shared guardrail result format) ───────────────────────────────
// validateOrder / validateOrderLine return { ok, errors, warnings, infos } so the
// write path and the read-only Schema Audit page share one set of rules. These
// are advisory for now (warnings/infos) — the spec's hard blocks on unresolved
// figurine plating land with the A-1 procurement build, not this foundation pass.
