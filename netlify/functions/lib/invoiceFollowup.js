import { InvoiceRecoveryError } from './invoiceRecoveryRepository.js'
import { InvoiceFollowupReviewed } from './invoiceRecoverySql.js'

export async function runInvoiceFollowup({ repo, sql, orderId, operationId, stage, identity, automatic = false }) {
  const claim = await repo.claimFollowup(orderId, operationId, stage, automatic)
  if (!claim) return
  let outcome
  let requiresReview = false
  try {
    await sql.checkFollowupReview(operationId)
    await sql[stage]({
      repo, orderId, operation: claim.operation, identity, deadline: claim.deadline,
      editRevision: claim.editRevision
    })
    outcome = { state: 'done', error: '' }
  } catch (error) {
    if (error instanceof InvoiceFollowupReviewed) {
      await repo.finishFollowupReview(orderId, operationId, error.outcome)
      return
    }
    requiresReview = error instanceof InvoiceRecoveryError
    outcome = { state: 'pending', error: error.message || 'Follow-up needs retry.' }
  }
  if (claim.legacy) await repo.followup(orderId, operationId, stage, outcome)
  else await repo.settleFollowup(orderId, operationId, stage, claim, outcome, requiresReview)
}

export async function retryDueInvoiceFollowups(repo, sql) {
  const jobs = await repo.dueFollowups()
  const results = await Promise.allSettled(jobs.map(job => runInvoiceFollowup({
    repo, sql, orderId: job.order_id, operationId: job.operation_id, stage: job.stage,
    identity: { uid: 'invoice-followup-worker' }, automatic: true
  })))
  if (results.some(result => result.status === 'rejected'))
    throw Error('One or more invoice follow-up jobs could not record a result.')
}
