import { ocDateOnly, ocYear } from './ocTime.js'

export const INVOICE_REFERENCE_FIELDS = [
  'erp_si_no',
  'uc_no',
  'erp_pi_no',
  'erp_so_no',
  'invoiced_at'
]
const text = (v) => (v == null ? '' : String(v).trim())
export const invoiceReferenceValues = (o) =>
  Object.fromEntries(
    INVOICE_REFERENCE_FIELDS.map((k) => [k, o?.[k] == null ? '' : String(o[k])])
  )
export const invoiceOrderSi = (o) =>
  text(o?.erp_si_no) ||
  (/^SI/i.test(text(o?.erp_so_no)) ? text(o.erp_so_no) : '')
export const invoiceOrderUc = (o) => text(o?.uc_no) || text(o?.erp_pi_no)
export const invoiceSubject = (o) => ({
  customer: text(o?.customer_name).slice(0, 200),
  currency: text(o?.currency) || 'USD'
})
export const invoiceExpected = (o) => ({
  ...invoiceSubject(o),
  si: invoiceOrderSi(o),
  uc: invoiceOrderUc(o)
})
export const sameInvoiceValue = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const canonical = (v) =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? v.map(canonical)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])])
        )
    : v
export const validInvoiceOrderId = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
export const validInvoiceOperationId = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v
  )
export const invoiceFollowupsDone = (op) =>
  ['financial', 'woo'].every((k) =>
    ['done', 'manual_review', 'not_applicable'].includes(
      op?.followups?.[k]?.state
    )
  )
export const invoiceReferenceRevision = (o) =>
  Number.isSafeInteger(o?.invoice_reference_revision) &&
  o.invoice_reference_revision >= 0
    ? o.invoice_reference_revision
    : 0

export function invoiceRequestSnapshot(
  order,
  orderId,
  identity,
  purpose,
  reason,
  now = new Date()
) {
  const subject = invoiceSubject(order),
    invoicedAt = text(order.invoiced_at) || ocDateOnly(now)
  if (
    !validInvoiceOrderId(orderId) ||
    !identity?.uid ||
    identity.uid.length > 128
  )
    throw Error('Invalid saved order or initiating identity.')
  if (
    !['first', 'split', 'reissue'].includes(purpose) ||
    reason.length > 500 ||
    (purpose !== 'first' && !reason.trim())
  )
    throw Error('Choose split or reissue and give a short reason.')
  const parsedDate = new Date(invoicedAt + 'T00:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(invoicedAt) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== invoicedAt
  )
    throw Error('Save a valid invoice date before raising the invoice.')
  return {
    year: String(ocYear(now) % 100).padStart(2, '0'),
    ...subject,
    order_id: orderId,
    uc_id: null,
    uc_no: invoiceOrderUc(order) || null,
    created_by: text(identity.email || identity.uid).slice(0, 320),
    actor_uid: identity.uid,
    purpose,
    reason,
    invoiced_at: invoicedAt
  }
}
export function invoiceResult(receipt, operation) {
  if (
    !receipt ||
    receipt.operation_id !== operation.id ||
    receipt.order_id !== operation.order_id ||
    !sameInvoiceValue(receipt.request_json, operation.request) ||
    !/^SI\d{6,}$/.test(receipt.o_si_no || '') ||
    !text(receipt.o_uc_no) ||
    !/^\d+$/.test(String(receipt.o_invoice_id))
  )
    throw Error(
      'The saved SQL receipt does not match this invoice request. Review required.'
    )
  return {
    si_no: receipt.o_si_no,
    uc_no: receipt.o_uc_no,
    uc_id: receipt.o_uc_id ?? null,
    invoice_id: receipt.o_invoice_id
  }
}
export function invoiceReferenceSavePatch(header, base) {
  if (!base?.invoice_allocation_id) return {}
  const changed = !sameInvoiceValue(
    invoiceReferenceValues(header),
    invoiceReferenceValues(base)
  )
  return {
    invoice_reference_revision:
      invoiceReferenceRevision(base) + (changed ? 1 : 0)
  }
}
export function invoiceRecoveryView(order, operation, history = []) {
  const refs = {
    ...invoiceReferenceValues(order),
    invoice_allocation_id: order?.invoice_allocation_id || '',
    invoice_reference_revision: invoiceReferenceRevision(order)
  }
  const view = (op) =>
    op
      ? {
          id: op.id,
          purpose: op.request.purpose,
          reason: op.request.reason,
          customer: op.request.customer,
          currency: op.request.currency,
          status: op.status,
          result: op.result || null,
          error: op.error || null,
          created_at:
            op.created_at?.toDate?.().toISOString() || op.created_at || null,
          followups: Object.fromEntries(
            ['financial', 'woo'].map((k) => [
              k,
              {
                state: op.followups?.[k]?.state || 'pending',
                error: op.followups?.[k]?.error || ''
              }
            ])
          )
        }
      : null
  return {
    order: refs,
    expected: invoiceExpected(order),
    operation: view(operation),
    history: history.map(view),
    canStartNew:
      !operation ||
      (operation.status === 'linked' && invoiceFollowupsDone(operation))
  }
}
