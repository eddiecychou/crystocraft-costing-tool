import { orderEditRevision } from '../../../src/orderEditModel.js'
import { randomUUID } from 'node:crypto'
import {
  invoiceReferenceValues,
  invoiceReferenceRevision,
  invoiceExpected,
  invoiceSubject,
  invoiceRequestSnapshot,
  invoiceFollowupsDone,
  sameInvoiceValue,
  validInvoiceOperationId
} from '../../../src/invoiceRecoveryModel.js'

export class InvoiceRecoveryError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}
export function createInvoiceRecoveryRepository(
  db,
  stamp,
  clock = () => new Date()
) {
  const order = (id) => db.doc('orders/' + id),
    request = (id, op) => order(id).collection('invoice_allocations').doc(op)
  const value = (s) => (s.exists ? { ...s.data(), id: s.id } : null)
  const requireOrder = (s) => {
    if (!s.exists) throw new InvoiceRecoveryError('Saved order not found.', 404)
    return { ...s.data(), id: s.id }
  }
  const current = async (tx, saved) => {
    const id = saved.invoice_allocation_id
    if (!id) return null
    if (!validInvoiceOperationId(id))
      throw new InvoiceRecoveryError('The saved invoice request needs review.')
    const op = value(await tx.get(request(saved.id, id)))
    if (!op || op.order_id !== saved.id)
      throw new InvoiceRecoveryError(
        'The saved invoice request is missing. Review it before invoicing.'
      )
    return op
  }
  const referencePatch = (saved, patch) => ({
    ...patch,
    invoice_reference_revision: invoiceReferenceRevision(saved) + 1,
    // Invoice ownership also invalidates an older commercial editor. Keep the
    // last commercial attempt ID so its own invoice action can adopt this base.
    edit_revision: orderEditRevision(saved) + 1,
    updatedAt: stamp()
  })
  return {
    async state(id) {
      const saved = requireOrder(await order(id).get()),
        pointer = saved.invoice_allocation_id
      if (pointer && !validInvoiceOperationId(pointer))
        throw new InvoiceRecoveryError(
          'The saved invoice request needs review.'
        )
      const [op, history] = await Promise.all([
        pointer ? request(id, pointer).get() : null,
        order(id)
          .collection('invoice_allocations')
          .orderBy('created_at', 'desc')
          .limit(21)
          .get()
      ])
      const operation = op ? value(op) : null
      if (pointer && (!operation || operation.order_id !== id))
        throw new InvoiceRecoveryError(
          'The saved invoice request needs review.'
        )
      return {
        order: saved,
        operation,
        history: history.docs.slice(0, 20).map(value),
        moreHistory: history.size > 20
      }
    },
    async operation(id, operationId) {
      const op = value(await request(id, operationId).get())
      if (!op || op.order_id !== id)
        throw new InvoiceRecoveryError('Invoice request not found.')
      return op
    },
    async begin(id, input, identity) {
      const operationId = randomUUID()
      await db.runTransaction(async (tx) => {
        const saved = requireOrder(await tx.get(order(id))),
          op = await current(tx, saved)
        if (op && input.action !== 'new') return
        if (input.action === 'new') {
          if (
            (saved.invoice_allocation_id || null) !==
            (input.previous_operation_id || null)
          ) {
            if (
              op &&
              op.previous_operation_id ===
                (input.previous_operation_id || null) &&
              op.request.purpose === input.purpose &&
              op.request.reason === input.reason &&
              sameInvoiceValue(op.before.expected, input.expected)
            )
              return
            throw new InvoiceRecoveryError(
              'Another invoice request has already started. Reload and review it before requesting another.'
            )
          }
          if (op && (op.status !== 'linked' || !invoiceFollowupsDone(op)))
            throw new InvoiceRecoveryError(
              'Finish or review the current invoice request before starting another.'
            )
          if (!op && !invoiceExpected(saved).si)
            throw new InvoiceRecoveryError(
              'Raise the first invoice before requesting a split or reissue.'
            )
        } else if (invoiceExpected(saved).si)
          throw new InvoiceRecoveryError(
            'This order already has an invoice. Use the separate split/reissue action for a new invoice.'
          )
        if (!sameInvoiceValue(invoiceExpected(saved), input.expected))
          throw new InvoiceRecoveryError(
            'Save customer, currency and document-reference changes before raising the invoice, then reload if another editor changed them.'
          )
        const purpose = input.action === 'new' ? input.purpose : 'first',
          reason = input.action === 'new' ? input.reason : ''
        const snapshot = invoiceRequestSnapshot(
          saved,
          id,
          identity,
          purpose,
          reason,
          clock()
        )
        const record = {
          id: operationId,
          order_id: id,
          request: snapshot,
          previous_operation_id: saved.invoice_allocation_id || null,
          before: {
            refs: invoiceReferenceValues(saved),
            expected: invoiceExpected(saved)
          },
          status: 'pending',
          result: null,
          error: null,
          followups: {
            financial: { state: 'pending' },
            woo: {
              state:
                saved.channel === 'woocommerce' ? 'pending' : 'not_applicable'
            }
          },
          created_at: stamp(),
          updated_at: stamp(),
          created_by: identity.uid
        }
        tx.create(request(id, operationId), record)
        tx.update(
          order(id),
          referencePatch(saved, { invoice_allocation_id: operationId })
        )
      })
      return this.state(id)
    },
    async result(id, operationId, result) {
      await db.runTransaction(async (tx) => {
        const op = value(await tx.get(request(id, operationId)))
        if (!op || op.order_id !== id)
          throw new InvoiceRecoveryError('Invoice request not found.')
        if (op.result && !sameInvoiceValue(op.result, result))
          throw new InvoiceRecoveryError(
            'The saved invoice result conflicts with its receipt. Review required.'
          )
        if (!op.result)
          tx.update(request(id, operationId), {
            result,
            status: 'allocated',
            error: null,
            updated_at: stamp()
          })
      })
    },
    async link(id, operationId, identity, review) {
      await db.runTransaction(async (tx) => {
        const saved = requireOrder(await tx.get(order(id))),
          op = value(await tx.get(request(id, operationId)))
        if (!op?.result || op.order_id !== id)
          throw new InvoiceRecoveryError(
            'Confirm the existing allocation result before linking.'
          )
        if (
          op.status === 'linked' &&
          saved.invoice_allocation_id !== operationId
        )
          return
        const resultRefs = {
          ...invoiceReferenceValues(saved),
          erp_si_no: op.result.si_no,
          uc_no: op.result.uc_no,
          invoiced_at: op.request.invoiced_at
        }
        const sameSubject = sameInvoiceValue(invoiceSubject(saved), {
          customer: op.request.customer,
          currency: op.request.currency
        })
        const sameBefore = sameInvoiceValue(
            invoiceReferenceValues(saved),
            op.before.refs
          ),
          sameResult = sameInvoiceValue(
            invoiceReferenceValues(saved),
            resultRefs
          )
        const reviewed =
          review &&
          review.reason.trim() &&
          sameInvoiceValue(invoiceExpected(saved), review.expected)
        if (
          saved.invoice_allocation_id !== operationId ||
          !sameSubject ||
          (!sameBefore && !sameResult && !reviewed)
        ) {
          tx.update(request(id, operationId), {
            status: 'review_required',
            error: {
              stage: 'link',
              message: !sameSubject
                ? 'The saved customer/currency changed. Restore the intended saved details or review the issued invoice manually.'
                : 'Current references differ from this request. Review the issued number before linking it.'
            },
            updated_at: stamp()
          })
          return
        }
        if (!sameResult) tx.update(order(id), referencePatch(saved, resultRefs))
        tx.update(request(id, operationId), {
          status: 'linked',
          error: null,
          linked_at: stamp(),
          updated_at: stamp(),
          ...(reviewed
            ? {
                reference_review: {
                  by: identity.uid,
                  reason: review.reason,
                  previous: invoiceReferenceValues(saved),
                  at: stamp()
                }
              }
            : {})
        })
      })
    },
    async error(id, operationId, stage, message, { review = false } = {}) {
      await db.runTransaction(async (tx) => {
        const op = value(await tx.get(request(id, operationId)))
        if (!op || op.status === 'linked') return
        tx.update(request(id, operationId), {
          error: { stage, message },
          ...(review ? { status: 'review_required' } : {}),
          updated_at: stamp()
        })
      })
    },
    async followupPlan(id, operationId, stage, plan) {
      return db.runTransaction(async (tx) => {
        const op = value(await tx.get(request(id, operationId)))
        if (!op || op.status !== 'linked')
          throw new InvoiceRecoveryError(
            'Link the issued invoice before follow-up.'
          )
        const old = op.followups[stage]
        if (old.plan) return old.plan
        tx.update(request(id, operationId), {
          ['followups.' + stage + '.plan']: plan,
          updated_at: stamp()
        })
        return plan
      })
    },
    async followup(id, operationId, stage, outcome) {
      await db.runTransaction(async (tx) => {
        const op = value(await tx.get(request(id, operationId)))
        if (!op || op.status !== 'linked') return
        if (
          ['done', 'manual_review', 'not_applicable'].includes(
            op.followups[stage]?.state
          )
        )
          return
        tx.update(request(id, operationId), {
          ['followups.' + stage]: { ...op.followups[stage], ...outcome },
          updated_at: stamp()
        })
      })
    },
    async manualFollowups(id, operationId, identity, reason) {
      const state = await this.state(id)
      if (!state.operation || state.operation.status !== 'linked')
        throw new InvoiceRecoveryError(
          'Link the issued invoice before reviewing follow-ups.'
        )
      if (state.operation.id !== operationId)
        throw new InvoiceRecoveryError(
          'Another invoice request has started. Reload before reviewing follow-ups.'
        )
      for (const stage of ['financial', 'woo'])
        await this.followup(id, state.operation.id, stage, {
          state: 'manual_review',
          error: '',
          review: { by: identity.uid, reason, at: clock().toISOString() }
        })
    }
  }
}
