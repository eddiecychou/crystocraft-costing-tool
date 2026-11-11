import {
  invoiceExpected,
  invoiceFollowupsDone,
  invoiceSubject,
  sameInvoiceValue,
  validInvoiceOperationId
} from '../../../src/invoiceRecoveryModel.js'

const review = (message) => ({ state: 'review', message })

// Both the Shipping status reader and the invoice claim transaction use the
// same evidence. Looking up the first operation also handles issuance from
// the saved order before its creator returns to the original request.
export async function readInitialDirectInvoice(tx, request, order) {
  if (
    !request.exists ||
    request.get('status') !== 'committed' ||
    request.get('order.source') !== 'direct_invoice' ||
    request.get('order_id') !== order.id ||
    !order.exists ||
    order.get('source') !== 'direct_invoice' ||
    !order.get('createdAt')?.isEqual?.(request.get('committed_at'))
  ) {
    return review(
      'The saved Direct Invoice order is missing or has changed identity. Review it in Shipping.'
    )
  }
  const intent = request.get('initial_invoice')
  if (intent?.state === 'supplied' && intent.si)
    return { state: 'supplied', si: intent.si }
  if (intent?.state !== 'due')
    return review('Review the initial invoice instruction on the saved order.')
  const ledger = order.ref.collection('invoice_allocations')
  const pinned = request.get('initial_invoice_id')
  let operation
  if (pinned) {
    if (!validInvoiceOperationId(pinned))
      return review('The saved first invoice reference needs review.')
    operation = await tx.get(ledger.doc(pinned))
    if (!operation.exists)
      return review('The saved first invoice request is missing.')
  } else {
    const first = await tx.get(
      ledger.where('request.purpose', '==', 'first').limit(2)
    )
    if (first.size > 1)
      return review(
        'Multiple first invoice requests need review on the saved order.'
      )
    operation = first.docs[0]
  }
  const saved = order.data()
  if (operation) {
    const op = operation.data()
    if (
      op.order_id !== order.id ||
      op.request?.order_id !== order.id ||
      op.request.purpose !== 'first' ||
      op.id !== operation.id ||
      !validInvoiceOperationId(op.id)
    )
      return review('The first invoice request does not match this order.')
    const identity = { operation_id: op.id, si: op.result?.si_no || '' }
    if (op.status === 'linked' && identity.si) {
      if (invoiceFollowupsDone(op)) return { state: 'issued', ...identity }
      const refs = invoiceExpected(saved)
      if (
        saved.invoice_allocation_id !== op.id ||
        refs.si !== op.result.si_no ||
        refs.uc !== op.result.uc_no ||
        !sameInvoiceValue(invoiceSubject(saved), {
          customer: op.request.customer,
          currency: op.request.currency
        })
      )
        return {
          ...review('The first invoice has unfinished updates and its saved references changed. Review it on the saved order.'),
          ...identity
        }
      return {
        state: 'followups_pending',
        ...identity,
        message: 'The invoice number is issued. Finish its pending accounting updates using this same request.'
      }
    }
    if (
      saved.invoice_allocation_id !== op.id ||
      !['pending', 'allocated'].includes(op.status) ||
      !sameInvoiceValue(invoiceSubject(saved), {
        customer: op.request.customer,
        currency: op.request.currency
      })
    )
      return {
        ...review('Review the first invoice request on the saved order.'),
        ...identity
      }
    return { state: 'pending', ...identity, message: op.error?.message || '' }
  }
  if (saved.invoice_allocation_id)
    return review(
      'A different invoice operation exists. Review it on the saved order.'
    )
  const expected = invoiceExpected(saved)
  if (expected.si) return { state: 'supplied', si: expected.si }
  if (!sameInvoiceValue(expected, invoiceExpected(request.get('order'))))
    return review(
      'Invoice details changed after Create. Review them on the saved order before issuing.'
    )
  return { state: 'due' }
}
