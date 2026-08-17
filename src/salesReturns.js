import { str, result, addError, addWarning } from './domain/validation'

// Sales Return helpers — the goods-return side of the Sales Return / Credit
// Note work (Phase B; see the Deepseek Spec review for the full design). A
// Sales Return records what came back and its physical disposition. It
// deliberately does NOT touch the stock ledger (see SR_DISPOSITIONS in
// constants.js) and does NOT allocate a Credit Note — that's Phase C, pending
// Cindy's numbering/UC-policy decisions.

export const emptyLine = () => ({
  _uid: 'ln_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  item_code: '', description: '', qty_returned: '', unit: 'pcs', unit_price: '',
})

// Per-line amount = qty returned × unit price (0 when either is blank/invalid).
export const lineAmount = ln => {
  const q = Number(ln.qty_returned), p = Number(ln.unit_price)
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0
}

export function srTotals(lines) {
  const ls = lines || []
  return {
    subtotal: ls.reduce((s, l) => s + lineAmount(l), 0),
    totalQty: ls.reduce((s, l) => s + (Number(l.qty_returned) || 0), 0),
  }
}

// Strip UI-only fields and coerce numeric strings before writing to Firestore.
// A row counts if it has a code/description and an actual quantity — same
// shape as purchaseOrders.js's cleanLines.
export function cleanLines(lines) {
  return (lines || [])
    .filter(l => (l.item_code || l.description) && Number(l.qty_returned) > 0)
    .map(l => ({
      item_code: (l.item_code || '').trim(),
      description: (l.description || '').trim(),
      qty_returned: Number(l.qty_returned) || 0,
      unit: l.unit || 'pcs',
      unit_price: Number(l.unit_price) || 0,
    }))
}

// validateSalesReturn(header, lines). Mirrors validateOrder's shape (shipping.js)
// so the write path and any future Schema Audit entry share one definition.
export function validateSalesReturn(header, lines) {
  const r = result()
  const h = header || {}
  const clean = cleanLines(lines)

  if (!clean.length)
    addError(r, 'salesreturn.lines.empty', 'lines', 'Add at least one returned line with a quantity')

  // Who: a linked customer, a typed name, or a marketplace reference — a
  // retail return often has no `customers` record behind it at all, the same
  // invariant an order carries (see THE INVARIANT in shipping.js).
  if (!h.customer_id && !str(h.customer_name) && !str(h.marketplace_ref))
    addError(r, 'salesreturn.customer.missing', 'customer_name',
      'Identify the customer, or give a marketplace reference')

  // What it's against — never a return with nothing to trace back to.
  if (!h.order_id && !str(h.original_si_no) && !str(h.original_uc_no) && !str(h.marketplace_ref))
    addError(r, 'salesreturn.reference.missing', 'original_si_no',
      'Link the original order, invoice, UC, or a marketplace reference')

  if (!str(h.disposition))
    addError(r, 'salesreturn.disposition.missing', 'disposition',
      'Choose what happened to the returned goods')

  if (!str(h.reason))
    addWarning(r, 'salesreturn.reason.missing', 'reason', 'No reason recorded for this return')

  return r
}
