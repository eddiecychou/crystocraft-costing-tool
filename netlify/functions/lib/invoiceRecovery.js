import { orderEditBase } from '../../../src/orderEditModel.js'
import {
  invoiceRecoveryView,
  invoiceResult,
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
              'review_expected'
            ].includes(k)
        )
      )
        throw new InvoiceRecoveryError('Invalid invoice request.', 400)
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
      if (input.action === 'status') {
        const state = await repo.state(id),
          op = state.operation
        if (op && !op.result && op.status === 'pending') {
          try {
            const receipt = await sql.lookup(op.id)
            if (receipt) {
              op.result = invoiceResult(receipt, op)
              op.status = 'allocated'
            }
          } catch {
            op.error = {
              stage: 'check',
              message:
                'The issued-number check is temporarily unavailable. Resume the same saved request safely.'
            }
          }
        }
        return json({
          ...invoiceRecoveryView(state.order, op, state.history),
          editBase: orderEditBase(state.order),
          moreHistory: state.moreHistory
        })
      }
      if (!has(profile, 'uc'))
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
        await reviewClosureInvoice(repo, sql, id, input.previous_operation_id, identity, input.reason.trim())
        return json({ reviewed: true })
      }
      if (input.action === 'manual_followups') {
        const { operation } = await repo.state(id)
        if (operation?.status !== 'linked')
          throw new InvoiceRecoveryError('Link the issued invoice before reviewing follow-ups.')
        if (operation.id !== input.previous_operation_id)
          throw new InvoiceRecoveryError('Another invoice request has started. Reload before reviewing follow-ups.')
        const outcome = await sql.review(id, operation.id, identity, input.reason)
        await repo.finishFollowupReview(id, operation.id, outcome)
      } else {
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
        if (
          input.action === 'link_review' &&
          operationId !== input.previous_operation_id
        )
          throw new InvoiceRecoveryError(
            'Another invoice request has started. Reload before reviewing references.'
          )
        if (!op.result) {
          try {
            const receipt = await sql.allocate(op),
              result = invoiceResult(receipt, op)
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
            return json({
              ...invoiceRecoveryView(
                state.order,
                state.operation,
                state.history
              ),
              editBase: orderEditBase(state.order),
              moreHistory: state.moreHistory
            })
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
      return json({
        ...invoiceRecoveryView(state.order, state.operation, state.history),
        editBase: orderEditBase(state.order),
        moreHistory: state.moreHistory
      })
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
