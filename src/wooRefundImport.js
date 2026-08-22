// WooCommerce refund → draft Credit Note import — Phase 4
// (WooCommerce_B2C_Sync_Spec.md). Same posture as wooImport.js's order
// import: this creates a DRAFT `credit_notes/{id}` doc for Cindy to review
// and post herself via the existing CreditNoteForm.jsx — it never calls
// postCreditNote()/allocates a CN number itself. Do not modify the original
// Sales Invoice (spec §4.1/§4.2) — nothing here touches `orders/{id}` at all.
//
// There is no existing helper for creating a credit note draft (CreditNoteForm.jsx
// does raw Firestore calls inline, addDoc(collection(db,'credit_notes'), {...}));
// this module does the same, just at a deterministic doc ID for idempotency
// instead of addDoc's random one — same reasoning as wooImport.js's
// createOrderWithLinesAtId.
import { doc, getDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { db } from './firebase'
import { wooOrderDocId, wooCustomerName } from './wooImport'

// Deterministic doc ID from the WooCommerce refund id (spec §2.3/§9's
// idempotency requirement, applied to refunds this time — "same WooCommerce
// refund event imported twice → one Credit Note reference").
export const wooRefundDraftDocId = (wooRefundId) => `woo-refund-${wooRefundId}`

// `refund`: one row from listWooOrders' `refunds` array (woo-sync.js's
// summarizeRefund). `order`: the matching row from that same call's `rows`
// array — needed for currency and the formatted customer name, neither of
// which live on the refund object itself. Caller must look this up by
// `refund.order_id` before calling (see WooCommerceSync.jsx).
export function mapWooRefundToDraft(refund, order) {
  const currency = order?.currency || 'USD'
  const orderRef = String(refund.order_number ?? refund.order_id)

  // WooCommerce reports refund quantities/line totals as NEGATIVE numbers —
  // cleanLines() in creditNotes.js filters to `qty_returned > 0`, so a
  // straight copy would silently drop every line. abs() both, and derive a
  // per-unit price the same way wooImport.js does for order lines.
  const lines = (refund.line_items || [])
    .map((l) => {
      const qty = Math.abs(Number(l.quantity) || 0)
      const total = Math.abs(Number(l.total) || 0)
      return {
        item_code: l.sku || '',
        description: l.name,
        qty_returned: qty,
        unit: 'pcs',
        unit_price: qty ? +(total / qty).toFixed(2) : total,
      }
    })
    .filter((l) => l.qty_returned > 0)

  const today = new Date().toISOString().slice(0, 10)
  return {
    status: 'draft',
    // record_date: when this record was entered (today, the import moment).
    // accounting_date: the ACTUAL refund date — spec §4.1/§4.3: "use the
    // actual refund date for the Credit Note date," kept distinct from when
    // it happened to be discovered/imported, which may be later.
    record_date: today,
    accounting_date: String(refund.date_created || '').slice(0, 10),
    customer_id: '',
    customer_name: wooCustomerName(order?.customer_name),
    channel: 'woocommerce',
    // Reference only — same posture as the order's own woo_order_no; not a
    // real order_id if the order was never imported (Phase 2's "Import" is
    // independent of this), so this may point at a doc that doesn't exist
    // yet. That's fine: order_id here is one of several free-text references
    // validateCreditNote accepts, never dereferenced as a hard foreign key.
    order_id: wooOrderDocId(refund.order_id),
    original_si_no: '',
    original_uc_no: '',
    marketplace_ref: orderRef,
    currency,
    // Left blank deliberately — Cindy chooses this during her mandatory
    // review (validateCreditNote requires it before POSTING, not before
    // saving a draft), same as the manual Sales Return flow always required.
    disposition: '',
    reason: refund.reason || '',
    remarks: `WooCommerce refund for order #${orderRef}`,
    lines,
    system_amount: refund.amount,
    accounting_amount: null,
    adjustment_reason: '',
    woo_refund_id: refund.id,
  }
}

// Imports one refund as a draft Credit Note. Returns { id, created }.
// created:false means it was already imported.
export async function importWooRefund(refund, order) {
  const id = wooRefundDraftDocId(refund.id)
  const ref = doc(db, 'credit_notes', id)
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists()) return { id, created: false }
    tx.set(ref, { ...mapWooRefundToDraft(refund, order), createdAt: serverTimestamp() })
    return { id, created: true }
  })
}

// Which of these WooCommerce refund IDs already have a draft — same
// direct-by-ID check as wooImport.js's checkImportedWooOrders.
export async function checkImportedWooRefunds(wooRefundIds) {
  const found = new Set()
  await Promise.all((wooRefundIds || []).map(async (id) => {
    const snap = await getDoc(doc(db, 'credit_notes', wooRefundDraftDocId(id)))
    if (snap.exists()) found.add(id)
  }))
  return found
}
