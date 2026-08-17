import { authedUser } from './firebase'
import { str, result, addError, addWarning } from './domain/validation'

// Credit Note helpers — Sales Return / Credit Note Phase C. Folds in what
// Phase B built as a separate "Sales Return" record: Cindy confirmed
// (2026-08-17) "there was never a sales return without credit note or vice
// versa" — in JES, one document served as both the goods-return record AND
// the accounting document. This module and CreditNoteForm.jsx replace
// salesReturns.js / SalesReturnForm.jsx / srNumber.js entirely; nothing was
// migrated because no real Sales Return had been created yet (confirmed with
// Cindy before removing them).
//
// The working record lives in Firestore (credit_notes/{id}, editable, no
// financial weight). Posting calls /api/credit-note, which allocates the
// CN number and writes the permanent fact to Postgres (app_credit_note) in
// one transaction — same "invoice is two things" split app_sales_invoice.sql
// already documents. A posted credit note is never edited in place; void is
// the only other write.

async function creditNoteApi(op, extra) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/credit-note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `Credit note ${op} failed (${res.status})`)
  return data
}

// Allocates the CN number and writes the posted fact. `fields` mirrors
// app_credit_note's own columns (see credit-note.js for the exact shape).
// Returns { cn_no, id }.
export const postCreditNote = (fields) => creditNoteApi('post_credit_note', fields)
export const voidCreditNote = (id) => creditNoteApi('void_credit_note', { id })
export const listCreditNotes = (filters) => creditNoteApi('list_credit_notes', filters).then(d => d.rows || [])

export const emptyLine = () => ({
  _uid: 'ln_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  item_code: '', description: '', qty_returned: '', unit: 'pcs', unit_price: '',
})

// Per-line amount = qty returned × unit price (0 when either is blank/invalid).
export const lineAmount = ln => {
  const q = Number(ln.qty_returned), p = Number(ln.unit_price)
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0
}

export function cnTotals(lines) {
  const ls = lines || []
  return {
    subtotal: ls.reduce((s, l) => s + lineAmount(l), 0),
    totalQty: ls.reduce((s, l) => s + (Number(l.qty_returned) || 0), 0),
  }
}

// Strip UI-only fields and coerce numeric strings before posting.
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

// validateCreditNote(header, lines). Mirrors validateOrder's shape
// (shipping.js) so the write path and any future Schema Audit entry share
// one definition.
export function validateCreditNote(header, lines) {
  const r = result()
  const h = header || {}
  const clean = cleanLines(lines)

  if (!clean.length)
    addError(r, 'creditnote.lines.empty', 'lines', 'Add at least one returned line with a quantity')

  // Who: a linked customer, a typed name, or a marketplace reference — a
  // retail return often has no `customers` record behind it at all, the same
  // invariant an order carries (see THE INVARIANT in shipping.js).
  if (!h.customer_id && !str(h.customer_name) && !str(h.marketplace_ref))
    addError(r, 'creditnote.customer.missing', 'customer_name',
      'Identify the customer, or give a marketplace reference')

  // What it's against — reference only (no new UC/SI, Cindy 2026-08-17),
  // but never a credit note with nothing to trace back to.
  if (!h.order_id && !str(h.original_si_no) && !str(h.original_uc_no) && !str(h.marketplace_ref))
    addError(r, 'creditnote.reference.missing', 'original_si_no',
      'Link the original order, invoice, UC, or a marketplace reference')

  if (!str(h.disposition))
    addError(r, 'creditnote.disposition.missing', 'disposition',
      'Choose what happened to the returned goods')

  if (!str(h.reason))
    addWarning(r, 'creditnote.reason.missing', 'reason', 'No reason recorded for this credit note')

  // Adjustment reason required whenever accounting_amount differs from
  // system_amount (SR-05) — checked again server-side at post time, this is
  // not the only gate.
  const sys = Number(h.system_amount)
  const acc = h.accounting_amount === '' || h.accounting_amount == null ? sys : Number(h.accounting_amount)
  if (Number.isFinite(sys) && Number.isFinite(acc)) {
    const adj = Math.round((acc - sys) * 100) / 100
    if (Math.abs(adj) > 0.005 && !str(h.adjustment_reason))
      addError(r, 'creditnote.adjustment.reason_required', 'adjustment_reason',
        'Accounting amount differs from the calculated amount — a reason is required')
  }

  return r
}

// Over-credit check (SR-05, warn not block — Cindy 2026-08-17): sum this
// credit note's own lines against every OTHER non-void posted credit note
// for the same original invoice, per item_code, and flag any that together
// exceed what was actually ordered. `orderedQtyByCode` comes from the
// original order's lines (same shape ShipmentForm/SalesReturnForm already
// build); `postedElsewhereByCode` from listCreditNotes({si_no}) summed
// client-side (mirrors SalesReturnForm's own over-quantity check).
export function overCreditWarnings(lines, orderedQtyByCode, postedElsewhereByCode) {
  const warnings = []
  for (const l of cleanLines(lines)) {
    const ordered = orderedQtyByCode?.[l.item_code]
    if (ordered == null) continue
    const elsewhere = postedElsewhereByCode?.[l.item_code] || 0
    const total = elsewhere + l.qty_returned
    if (total > ordered) warnings.push({ item_code: l.item_code, ordered, total })
  }
  return warnings
}
