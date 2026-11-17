import { orderEditBase } from '../../../src/orderEditModel.js'
import {
  invoiceRecoveryView,
  invoiceResult,
  invoiceFollowupReviewTarget,
  invoiceLinkOwnershipIssue,
  sameInvoiceValue,
  validInvoiceOrderId,
  validInvoiceOperationId,
  invoiceFollowupsDone
} from '../../../src/invoiceRecoveryModel.js'
import { validRequestId } from '../../../src/orderCreateRequestModel.js'
import { InvoiceRecoveryError } from './invoiceRecoveryRepository.js'
import { runInvoiceFollowup } from './invoiceFollowup.js'
import { reviewClosureInvoice } from './shippingClosure.js'
import { OrderRequestError } from './orderRequestAccess.js'
import { followupStages } from './invoiceFollowupQueue.js'
import { readInvoiceReceiptStatus } from './invoiceReceiptStatus.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Netlify-CDN-Cache-Control': 'no-store',
      Vary: 'Authorization',
      'X-Content-Type-Options': 'nosniff'
    }
  })
const has = (profile, module) =>
  profile?.role === 'admin' ||
  (profile?.role === 'staff' &&
    Array.isArray(profile.modules) &&
    profile.modules.includes(module))
export function createInvoiceRecoveryHandler({
  verifyToken,
  getProfile,
  repo,
  sql
}) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const token = req.headers
      .get('authorization')
      ?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192)
      return json({ error: 'Not signed in' }, 401)
    let identity
    try {
      identity = await verifyToken(token)
      if (!identity.uid) throw Error()
    } catch {
      return json({ error: 'Invalid or expired session' }, 401)
    }
    try {
      const profile = await getProfile(identity.uid)
      if (!has(profile, 'shipping'))
        return json({ error: 'Access denied' }, 403)
      const raw = await req.text()
      if (Buffer.byteLength(raw) > 8192)
        throw new InvoiceRecoveryError('Invoice request is too large.', 400)
      let input
      try {
        input = JSON.parse(raw)
      } catch {
        throw new InvoiceRecoveryError('Bad JSON', 400)
      }
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (k) =>
            ![
              'action',
              'order_id',
              'expected',
              'previous_operation_id',
              'request_id',
              'purpose',
              'reason',
              'review_expected',
              'followup_id',
              'invoice_request_id'
            ].includes(k)
        )
      )
        throw new InvoiceRecoveryError('Invalid invoice request.', 400)
      if (input.followup_id !== undefined && (input.action !== 'status' || !validInvoiceOperationId(input.followup_id)))
        throw new InvoiceRecoveryError('Choose a valid invoice follow-up.', 400)
      if (input.invoice_request_id !== undefined && (input.followup_id !== undefined ||
          !validInvoiceOperationId(input.invoice_request_id) ||
          (input.action !== 'status' && (!['resume', 'link_review'].includes(input.action) ||
            input.previous_operation_id !== input.invoice_request_id))))
        throw new InvoiceRecoveryError('Choose a valid saved invoice request.', 400)
      if (input.action === 'ready') {
        await sql.lookup('00000000-0000-0000-0000-000000000000')
        return json({ ready: true })
      }
      if (
        !validInvoiceOrderId(input.order_id) ||
        ![
          'status',
          'raise',
          'initial_direct',
          'resume',
          'new',
          'link_review',
          'manual_followups',
          'closure_review_followups'
        ].includes(input.action)
      )
        throw new InvoiceRecoveryError(
          'Choose a saved order and valid invoice action.',
          400
        )
      const id = input.order_id
      const canManage = has(profile, 'uc')
      const respond = async (state, receipt) => {
        let followupChecklist
        try { followupChecklist = await repo.followupChecklist(state.order, state.operation, input.followup_id) }
        catch { followupChecklist = { unavailable: true, entries: [] } }
        const view = invoiceRecoveryView(state.order, state.operation, state.history)
        if (input.action === 'status' && view.operation) {
          view.operation.receiptStatus = receipt?.status ?? null
          if (receipt?.status === 'verified' && !view.operation.result) {
            view.operation.result = receipt.result
            if (view.operation.status === 'pending') view.operation.status = 'allocated'
          }
          if (receipt?.status !== 'verified') view.linkReviewTarget = null
        }
        return json({ ...view,
          editBase: orderEditBase(state.order), moreHistory: state.moreHistory, followupChecklist, canManage,
          ...(input.invoice_request_id ? { focusedInvoiceRequestId: input.invoice_request_id } : {}),
          ...(input.followup_id ? { focusedFollowupId: input.followup_id } : {}) })
      }
      if (input.action === 'status') {
        const state = await repo.state(id),
          op = state.operation
        const selected = !input.invoice_request_id || input.invoice_request_id === op?.id
        const receipt = selected && op && op.status !== 'linked' ? await readInvoiceReceiptStatus(op, sql.lookup) : null
        return respond(state, receipt)
      }
      if (!canManage)
        return json(
          {
            error:
              input.action === 'initial_direct'
                ? 'UC permission is required to issue this invoice. The order is saved.'
                : 'Access denied'
          },
          403
        )
      if (
        input.action === 'initial_direct' &&
        !validRequestId(input.request_id)
      )
        throw new InvoiceRecoveryError(
          'Choose the saved Direct Invoice request.',
          400
        )
      if (input.action === 'new') {
        if (
          input.previous_operation_id != null &&
          !validInvoiceOperationId(input.previous_operation_id)
        )
          throw new InvoiceRecoveryError(
            'Invalid previous invoice request.',
            400
          )
        if (
          !['split', 'reissue'].includes(input.purpose) ||
          typeof input.reason !== 'string' ||
          !input.reason.trim() ||
          input.reason.length > 500
        )
          throw new InvoiceRecoveryError(
            'Choose split/reissue and give a short reason.',
            400
          )
      }
      if (
        ['new', 'raise'].includes(input.action) &&
        (!input.expected ||
          typeof input.expected !== 'object' ||
          Array.isArray(input.expected))
      )
        throw new InvoiceRecoveryError(
          'Confirm the saved invoice details before raising it.',
          400
        )
      if (
        ['manual_followups', 'closure_review_followups', 'link_review'].includes(input.action) &&
        (typeof input.reason !== 'string' ||
          !input.reason.trim() ||
          input.reason.length > 500)
      )
        throw new InvoiceRecoveryError('Give a short review reason.', 400)
      if (
        ['manual_followups', 'closure_review_followups', 'link_review'].includes(input.action) &&
        !validInvoiceOperationId(input.previous_operation_id)
      )
        throw new InvoiceRecoveryError(
          'Choose the reviewed invoice request.',
          400
        )
      if (input.action === 'closure_review_followups') {
        if (input.review_expected !== undefined) {
          const [state, op] = await Promise.all([repo.state(id), repo.operation(id, input.previous_operation_id)])
          if (!sameInvoiceValue(input.review_expected, invoiceFollowupReviewTarget(state.order, op)))
            throw new InvoiceRecoveryError('The selected invoice or saved references changed. Reload before recording Finance review.')
        }
        await reviewClosureInvoice(repo, sql, id, input.previous_operation_id, identity, input.reason.trim())
        return json({ reviewed: true })
      }
      if (input.action === 'manual_followups') {
        const { order, operation } = await repo.state(id)
        if (operation?.status !== 'linked')
          throw new InvoiceRecoveryError('Link the issued invoice before reviewing follow-ups.')
        if (operation.id !== input.previous_operation_id)
          throw new InvoiceRecoveryError('Another invoice request has started. Reload before reviewing follow-ups.')
        if (!sameInvoiceValue(input.review_expected, invoiceFollowupReviewTarget(order, operation)))
          throw new InvoiceRecoveryError('The selected invoice or saved references changed. Reload before recording Finance review.')
        const outcome = await sql.review(id, operation.id, identity, input.reason)
        await repo.finishFollowupReview(id, operation.id, outcome)
      } else {
        if (input.action === 'resume' && !validInvoiceOperationId(input.previous_operation_id))
          throw new InvoiceRecoveryError('Reload and select the saved invoice request before resuming.')
        let state = ['raise', 'new', 'initial_direct'].includes(input.action)
          ? await repo.begin(id, input, identity)
          : await repo.state(id)
        if (state.order?.shipping_closed === true) throw new InvoiceRecoveryError('This order is closed. Its invoices remain available for reference.')
        let op = state.operation
        if (!op && input.action === 'initial_direct')
          return json({ initial_complete: true })
        if (!op)
          throw new InvoiceRecoveryError(
            'There is no saved invoice request to resume. Use Raise Invoice first.'
          )
        const operationId = op.id
        if (input.action === 'resume' && operationId !== input.previous_operation_id)
          throw new InvoiceRecoveryError('Another invoice request is current. Reload and select the invoice to resume.')
        if (
          input.action === 'link_review' &&
          operationId !== input.previous_operation_id
        )
          throw new InvoiceRecoveryError(
            'Another invoice request has started. Reload before reviewing references.'
          )
        if (input.action === 'link_review' && !op.result)
          throw new InvoiceRecoveryError('Confirm the existing issued invoice before reviewing its order link.')
        let verifiedResult
        if (input.invoice_request_id) {
          if (op.status === 'linked') return respond(state)
          const receipt = await readInvoiceReceiptStatus(op, sql.lookup)
          if (receipt.status !== 'verified')
            throw new InvoiceRecoveryError('The issued receipt could not be verified. Refresh the saved request before linking.')
          verifiedResult = receipt.result
        }
        if (!op.result) {
          // Before the SQL result exists locally, Resume can create a number.
          // Leave unverifiable ownership for Finance before calling the allocator.
          if (state.order && invoiceLinkOwnershipIssue(state.order, op)) return respond(state)
          try {
            const result = verifiedResult ?? invoiceResult(await sql.allocate(op), op)
            try {
              await repo.result(id, op.id, result)
            } catch {
              await repo
                .error(
                  id,
                  op.id,
                  'result',
                  'A number may already be issued, but its confirmation could not be saved. Resume this same request.'
                )
                .catch(() => {})
              throw Error(
                'The issued result could not be saved. Resume the existing invoice request; do not start another.'
              )
            }
          } catch (error) {
            await repo
              .error(
                id,
                op.id,
                'allocation',
                error.message ||
                  'The allocation result could not be confirmed.',
                { review: error instanceof InvoiceRecoveryError }
              )
              .catch(() => {})
            state = await repo.state(id)
            return respond(state)
          }
          op = await repo.operation(id, operationId)
        }
        if (op.status !== 'linked' || input.action === 'link_review') {
          try {
            await repo.link(
              id,
              op.id,
              identity,
              input.action === 'link_review'
                ? { expected: input.review_expected, reason: input.reason }
                : null
            )
          } catch (error) {
            if (error instanceof InvoiceRecoveryError) throw error
            await repo
              .error(
                id,
                op.id,
                'link',
                'Invoice issued; the order link could not be saved. Resume the same request.'
              )
              .catch(() => {})
            throw error
          }
          op = await repo.operation(id, operationId)
        }
        if (op.status === 'linked' && !invoiceFollowupsDone(op)) {
          for (const stage of followupStages)
            await runInvoiceFollowup({ repo, sql, orderId: id, operationId: op.id, stage, identity })
        }
      }
      const state = await repo.state(id)
      return respond(state)
    } catch (error) {
      return json(
        {
          error:
            (error instanceof InvoiceRecoveryError || error instanceof OrderRequestError)
              ? error.message
              : 'Invoice recovery is temporarily unavailable. Reopen the saved order and resume the same request.'
        },
        error instanceof InvoiceRecoveryError || error instanceof OrderRequestError ? error.status : 503
      )
    }
  }
}
