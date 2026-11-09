import { invoiceReferenceValues, invoiceReferenceRevision } from './invoiceRecoveryModel.js'

export function orderEditRevision(order) {
  const value = order?.edit_revision ?? 0
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2147483647)
    throw Error('This order has an invalid edit version. Review the saved record before editing.')
  return value
}

export function orderEditBase(order) {
  const created = order?.createdAt
  return {
    revision: orderEditRevision(order),
    lastCommercialId: order?.last_edit_id || '',
    created: created ? [created.seconds ?? created._seconds, created.nanoseconds ?? created._nanoseconds] : null,
    allocation: order?.invoice_allocation_id || '',
    referenceRevision: invoiceReferenceRevision(order),
    references: invoiceReferenceValues(order)
  }
}

export const sameOrderEditBase = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function orderEditPatch(base, attemptId) {
  if (!Number.isSafeInteger(base?.revision) || base.revision < 0 || base.revision >= 2147483647 ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId || ''))
    throw Error('Reload the saved order before saving these edits.')
  const created = base.created
  return { edit_revision: base.revision + 1, last_edit_id: attemptId,
    edit_origin_ms: created && Number.isFinite(created[0]) && Number.isFinite(created[1])
      ? created[0] * 1000 + created[1] / 1000000 : null }
}

export function orderEditConflict(latest) {
  return Object.assign(Error('This order changed after you opened it. Your draft has been kept. Review the latest saved version before saving.'), {
    code: 'order-edit-conflict', latest
  })
}
