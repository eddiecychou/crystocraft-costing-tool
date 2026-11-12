import {
  invoiceReconciliation,
  canonicalInvoiceFinancialRecord,
  isKnownFinancialAmount
} from '../../../src/invoiceFinancialModel.js'
import {
  wooRegistryAutofillFields,
  savedInvoiceRegistryFields
} from '../../../src/invoiceRegistryFields.js'
import { invoiceWriteRow } from '../../shared/invoiceFields.js'
import { cleanUcFields } from '../../shared/ucFields.js'
import {
  sameInvoiceValue,
  invoiceExpected,
  invoiceSubject
} from '../../../src/invoiceRecoveryModel.js'
import { InvoiceRecoveryError } from './invoiceRecoveryRepository.js'
import { orderEditRevision } from '../../../src/orderEditModel.js'

export class InvoiceFollowupReviewed extends Error {
  constructor(outcome) {
    super('Follow-ups were reviewed before this write.')
    this.outcome = outcome
  }
}

function followupResult(rows) {
  const result = rows[0]?.result
  if (result?.followup_review) throw new InvoiceFollowupReviewed(result)
  return result
}

export function createInvoiceRecoverySql({
  url,
  key,
  fetchImpl = fetch,
  clock = () => new Date(),
  timeoutMs = 20000
}) {
  const rest = async (
    path,
    { method = 'GET', body, prefer = 'return=representation' } = {}
  ) => {
    const r = await fetchImpl(url + '/rest/v1/' + path, {
      method,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', Prefer: prefer } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!r.ok) {
      const error = await r.json().catch(() => ({}))
      if (error.message?.includes('reused with different saved details'))
        throw new InvoiceRecoveryError(
          'This invoice request conflicts with its saved SQL receipt. Review required.'
        )
      if (
        /changed (concurrently|after allocation)|ownership requires review/.test(
          error.message || ''
        )
      )
        throw new InvoiceRecoveryError(
          'The financial or UC record was edited separately. Review it manually; those edits were preserved.'
        )
      throw Error(
        'The invoice database request could not be confirmed. Retry the saved operation safely.'
      )
    }
    const data = await r.json()
    if (!Array.isArray(data))
      throw Error(
        'The invoice database returned an incomplete response. Retry the saved operation.'
      )
    return data
  }
  const one = async (table, id) => {
    const rows = await rest(
      table + '?' + new URLSearchParams({ id: 'eq.' + id, limit: '2' })
    )
    if (rows.length !== 1)
      throw Error('The saved financial record could not be read completely.')
    return rows[0]
  }
  const currentOrder = async (repo, id, operation, editRevision) => {
    const state = await repo.state(id)
    if (
      state.order.invoice_allocation_id !== operation.id ||
      invoiceExpected(state.order).si !== operation.result.si_no ||
      invoiceExpected(state.order).uc !== operation.result.uc_no ||
      !sameInvoiceValue(invoiceSubject(state.order), {
        customer: operation.request.customer,
        currency: operation.request.currency
      })
    )
      throw new InvoiceRecoveryError(
        'The current order references have changed. Review these follow-up details manually.'
      )
    if (editRevision !== undefined && orderEditRevision(state.order) !== editRevision)
      throw new InvoiceRecoveryError('The saved order changed. Review its current details before choosing Resume.')
    return state.order
  }
  const apply = async (operation, stage, expected, patch, deadline) => {
    const rows = await rest(deadline
      ? 'rpc/apply_claimed_invoice_followup'
      : 'rpc/apply_invoice_allocation_followup', {
      method: 'POST',
      body: {
        p_operation_id: operation.id,
        p_stage: stage,
        p_expected: expected,
        p_patch: patch,
        ...(deadline ? { p_deadline: deadline } : {})
      }
    })
    return followupResult(rows)
  }
  return {
    allocate: (operation) =>
      rest('rpc/allocate_sales_invoice_once', {
        method: 'POST',
        body: { p_operation_id: operation.id, p_request: operation.request }
      }).then((rows) => {
        if (rows.length !== 1) throw Error('Allocation receipt is incomplete.')
        return rows[0]
      }),
    lookup: (id) =>
      rest('rpc/lookup_invoice_allocation', {
        method: 'POST',
        body: { p_operation_id: id }
      }).then((rows) => {
        if (rows.length > 1) throw Error('Allocation receipt is ambiguous.')
        return rows[0] || null
      }),
    async review(orderId, operationId, identity, reason) {
      const rows = await rest('rpc/review_invoice_allocation_followups', {
        method: 'POST',
        body: {
          p_order_id: orderId,
          p_operation_id: operationId,
          p_by: identity.uid,
          p_reason: reason.trim()
        }
      })
      const outcome = rows[0]?.result
      if (!outcome?.followup_review?.by || !outcome.followup_review.at)
        throw Error('Invoice follow-up review could not be confirmed.')
      return outcome
    },
    async checkFollowupReview(operationId) {
      const rows = await rest('rpc/lookup_invoice_allocation_followups', {
        method: 'POST',
        body: { p_operation_id: operationId }
      })
      if (rows.length !== 1 || !rows[0].result)
        throw new InvoiceRecoveryError('The saved invoice receipt needs review.')
      followupResult(rows)
    },
    async financial({ repo, orderId, operation, identity, deadline, editRevision }) {
      const order = await currentOrder(repo, orderId, operation, editRevision),
        ledger = await one('app_sales_invoice', operation.result.invoice_id)
      if (ledger.si_no !== operation.result.si_no)
        throw new InvoiceRecoveryError(
          'The financial invoice does not match the issued receipt.'
        )
      const plans = invoiceReconciliation([{ ...order, id: orderId }], [ledger])
      if (!plans.length) return
      const plan = plans[0]
      if (!plan.repairable) throw new InvoiceRecoveryError(plan.why)
      const built = invoiceWriteRow(
        plan.payload,
        identity.email || identity.uid,
        clock()
      )
      if (built.error) throw new InvoiceRecoveryError(built.error)
      const latest = await currentOrder(repo, orderId, operation, editRevision)
      if (
        !sameInvoiceValue(
          savedInvoiceRegistryFields({ ...latest, id: orderId }),
          plan.payload
        )
      )
        throw Error(
          'Saved financial details changed during follow-up. Retry using the current saved order.'
        )
      const saved = await apply(operation, 'financial', ledger, built.row, deadline)
      if (!saved)
        throw Error(
          'The financial follow-up result is incomplete. Retry safely.'
        )
      if (
        !sameInvoiceValue(
          canonicalInvoiceFinancialRecord(saved),
          canonicalInvoiceFinancialRecord(built.row)
        )
      )
        throw new InvoiceRecoveryError(
          'Financial details changed concurrently. Review the saved invoice before retrying.'
        )
      const after = await currentOrder(repo, orderId, operation, editRevision)
      if (invoiceReconciliation([{ ...after, id: orderId }], [saved]).length)
        throw Error(
          'The saved order changed during financial follow-up. Retry the current saved details.'
        )
    },
    async woo({ repo, orderId, operation, identity, deadline, editRevision }) {
      const order = await currentOrder(repo, orderId, operation, editRevision)
      if (order.channel !== 'woocommerce' || !operation.result.uc_id) return
      if (!isKnownFinancialAmount(order.total_amount))
        throw new InvoiceRecoveryError(
          'WooCommerce checkout total is unknown. Review the UC Registry details manually.'
        )
      const current = await one('uc_registry', operation.result.uc_id),
        expected = cleanUcFields(wooRegistryAutofillFields(order))
      const plan = await repo.followupPlan(orderId, operation.id, 'woo', {
        expected,
        baseline: current
      })
      const matches = (row) =>
        Object.keys(plan.expected).every((k) =>
          sameInvoiceValue(row[k] ?? null, plan.expected[k] ?? null)
        )
      if (matches(current)) return
      if (!sameInvoiceValue(plan.expected, expected))
        throw new InvoiceRecoveryError(
          'Saved WooCommerce details changed. Review the UC Registry manually.'
        )
      if (operation.request.uc_no && !matches(current))
        throw new InvoiceRecoveryError(
          'The reused UC has different details. Review the UC Registry manually before replacing them.'
        )
      await currentOrder(repo, orderId, operation, editRevision)
      const saved = await apply(operation, 'woo', plan.baseline, {
        ...plan.expected,
        updated_at: clock().toISOString(),
        updated_by: identity.email || identity.uid
      }, deadline)
      if (!saved)
        throw Error('The UC follow-up result is incomplete. Retry safely.')
      if (!matches(saved))
        throw new InvoiceRecoveryError(
          'UC Registry details changed concurrently. Review them before retrying.'
        )
      const after = await currentOrder(repo, orderId, operation, editRevision)
      if (
        !sameInvoiceValue(
          cleanUcFields(wooRegistryAutofillFields(after)),
          plan.expected
        )
      )
        throw new InvoiceRecoveryError(
          'Saved WooCommerce details changed. Review the UC Registry manually.'
        )
    }
  }
}
