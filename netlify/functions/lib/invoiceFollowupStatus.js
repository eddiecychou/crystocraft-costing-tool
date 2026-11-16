import { invoiceExpected, invoiceFollowupStages, invoiceFollowupSettled } from '../../../src/invoiceRecoveryModel.js'

// Callers verify the linked receipt and its owning order before classifying it.
export function classifyInvoiceFollowup(order, operation, jobs, now) {
  const current = order.invoice_allocation_id === operation.id
  const stages = invoiceFollowupStages.filter(stage => !invoiceFollowupSettled(operation.followups?.[stage])).map(stage => {
    const followup = operation.followups?.[stage]
    const job = current ? jobs.get(stage) : null
    const inProgress = job?.operation_id === operation.id && job.order_id === order.id &&
      job.stage === stage && job.lease_until > now
    return { stage, error: followup?.error || '', inProgress, requiresReview: followup?.requires_review === true }
  })
  const expected = invoiceExpected(order)
  const matches = expected.si === operation.result.si_no && expected.uc === operation.result.uc_no &&
    expected.customer === operation.request?.customer && expected.currency === operation.request?.currency
  const disposition = stages.some(stage => stage.inProgress) ? 'in_progress'
    : !current || !matches || order.shipping_closed || stages.some(stage => stage.requiresReview) ? 'finance_review' : 'resume'
  return { id: operation.id, result: { si_no: operation.result.si_no, uc_no: operation.result.uc_no },
    current, disposition, referenceConflict: current && !matches, stages }
}
