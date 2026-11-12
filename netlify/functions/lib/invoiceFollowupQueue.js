import { randomUUID } from 'node:crypto'
import { validInvoiceOperationId, validInvoiceOrderId } from '../../../src/invoiceRecoveryModel.js'
import { orderEditRevision } from '../../../src/orderEditModel.js'

export const followupStages = ['financial', 'woo']
const terminal = new Set(['done', 'not_applicable', 'manual_review'])
const minute = 60_000
const automaticLimit = 4
const paused = Number.MAX_SAFE_INTEGER
const exhausted = 'Automatic retries ended. Review the invoice or choose Resume.'

export function createInvoiceFollowupQueue(db, stamp) {
  const jobs = db.collection('invoice_followup_jobs')
  const jobRef = (operationId, stage) => jobs.doc(operationId + '_' + stage)
  const orderRef = (orderId) => db.doc('orders/' + orderId)
  const operationRef = (orderId, operationId) =>
    orderRef(orderId).collection('invoice_allocations').doc(operationId)

  return {
    enqueue(tx, operation, editRevision) {
      for (const stage of followupStages) {
        if (terminal.has(operation.followups[stage].state)) continue
        tx.create(jobRef(operation.id, stage), {
          order_id: operation.order_id,
          operation_id: operation.id,
          stage,
          edit_revision: editRevision,
          next_at: Date.now() + minute,
          automatic_attempts: 0
        })
      }
    },
    remove(tx, operationId) {
      for (const stage of followupStages) tx.delete(jobRef(operationId, stage))
    },
    async dueFollowups() {
      const snapshot = await jobs.where('next_at', '<=', Date.now())
        .orderBy('next_at').limit(3).get()
      return snapshot.docs.map(doc => doc.data())
    },
    async claimFollowup(orderId, operationId, stage, automatic) {
      if (!validInvoiceOrderId(orderId) || !validInvoiceOperationId(operationId) ||
          !followupStages.includes(stage)) return null
      return db.runTransaction(async tx => {
        const ref = jobRef(operationId, stage)
        const opRef = operationRef(orderId, operationId)
        const [jobSnap, opSnap, order] = await tx.getAll(ref, opRef, orderRef(orderId))
        const job = jobSnap.data()
        const operation = opSnap.data()
        if (job && (job.order_id !== orderId || job.operation_id !== operationId || job.stage !== stage))
          return null
        if (!operation?.result || operation.id !== operationId || operation.order_id !== orderId ||
            operation.status !== 'linked' || terminal.has(operation.followups[stage]?.state) ||
            order.get('invoice_allocation_id') !== operationId) {
          if (job) tx.delete(ref)
          return null
        }
        // Older linked receipts keep their foreground Resume path.
        if (!job) return automatic ? null : { operation, legacy: true }
        const now = Date.now()
        if (job.lease_until > now || (automatic && job.next_at > now)) return null
        if (automatic && orderEditRevision(order.data()) !== job.edit_revision) {
          tx.update(ref, { next_at: paused, automatic_paused: true })
          tx.update(opRef, {
            ['followups.' + stage + '.error']: 'The saved order changed. Review its current details before choosing Resume.',
            updated_at: stamp()
          })
          return null
        }
        if (automatic && job.automatic_attempts >= automaticLimit) {
          tx.update(ref, { next_at: paused })
          tx.update(opRef, { ['followups.' + stage + '.error']: exhausted, updated_at: stamp() })
          return null
        }
        const token = randomUUID()
        const leaseUntil = now + minute
        tx.update(ref, {
          token,
          lease_until: leaseUntil,
          next_at: leaseUntil,
          automatic_attempts: job.automatic_attempts + Number(automatic),
          automatic_paused: job.automatic_paused === true || job.next_at === paused
        })
        return {
          operation, token, deadline: new Date(leaseUntil).toISOString(),
          editRevision: automatic ? job.edit_revision : undefined
        }
      })
    },
    async settleFollowup(orderId, operationId, stage, claim, outcome, requiresReview) {
      await db.runTransaction(async tx => {
        const ref = jobRef(operationId, stage)
        const opRef = operationRef(orderId, operationId)
        const [jobSnap, opSnap] = await tx.getAll(ref, opRef)
        const job = jobSnap.data()
        const op = opSnap.data()
        if (job?.token !== claim.token || !op || terminal.has(op.followups[stage]?.state)) return
        let result = outcome
        if (outcome.state === 'done') tx.delete(ref)
        else {
          const limitReached = job.automatic_attempts >= automaticLimit
          const suspend = requiresReview || limitReached || job.automatic_paused
          tx.update(ref, {
            lease_until: 0,
            token: null,
            automatic_paused: suspend,
            next_at: suspend ? paused : Date.now() + minute * 2 ** Math.max(0, job.automatic_attempts - 1)
          })
          if (limitReached && !requiresReview) result = { ...outcome, error: exhausted }
        }
        tx.update(opRef, {
          ['followups.' + stage]: { ...op.followups[stage], ...result },
          updated_at: stamp()
        })
      })
    }
  }
}
