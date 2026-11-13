import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { orderEditBase } from '../../../src/orderEditModel.js'
import { invoiceFollowupsDone, sameInvoiceValue, validInvoiceOperationId } from '../../../src/invoiceRecoveryModel.js'
import { noInvoiceReasonOf, orderSi } from '../../../src/shippingModel.js'
import { OrderRequestError, shippingProfile, permitted } from './orderRequestAccess.js'
import { closureStock } from './orderClosureStock.js'

export function createShippingClosure(db) {
  return (uid, id, input) => db.runTransaction(async tx => {
    const profile = await shippingProfile(db, tx, uid)
    const ref = db.collection('orders').doc(id)
    const auditRef = ref.collection('closure_audit').doc('closed')
    const orderSnap = await tx.get(ref)
    const order = orderSnap.data()
    if (!order) throw new OrderRequestError('Saved order not found.', 404)
    const base = orderEditBase(order)
    if (order.shipping_closed === true) {
      const audit = (await tx.get(auditRef)).data()
      if (!audit || (input.action === 'close_order' && !sameInvoiceValue(input.base, audit.base)))
        throw new OrderRequestError('Reload the closed order to see its saved details.')
      return { closed: true, reason: audit.reason, closedAt: audit.closed_at?.toMillis() ?? null, invoices: audit.invoices || [] }
    }

    const byOrder = name => db.collection(name).where('order_id', '==', id)
    const [movements, allocations, jobs, packing, freight, decision, rfqs] = await Promise.all([
      tx.get(db.collectionGroup('movements').where('order_id', '==', id).limit(5001)),
      tx.get(ref.collection('invoice_allocations').limit(501)),
      tx.get(byOrder('invoice_followup_jobs').limit(1001)),
      tx.get(byOrder('packing_lists').limit(501)), tx.get(byOrder('freight_quotes').limit(501)),
      tx.get(db.collection('freight_decisions').doc(id)), tx.get(byOrder('freight_rfqs').limit(501)),
    ])
    if ([allocations, packing, freight, rfqs].some(snap => snap.size > 500) || movements.size > 5000 || jobs.size > 1000)
      throw new OrderRequestError('This order has too much linked history for automatic closure. Review it with an administrator.')
    const stock = closureStock(order, movements.docs)
    const blockers = stock.filter(part => ['review', 'reserved'].includes(part.state)).map(part => part.state === 'reserved'
      ? `${part.label}: release the remaining reservation in Order & Lines, then refresh this review.`
      : `${part.label}: Supply must review the stock movements and saved reservation before closure.`)
    const invoices = allocations.docs.map(doc => {
      const op = doc.data()
      const linked = validInvoiceOperationId(doc.id) && op.id === doc.id && op.status === 'linked' && op.result?.si_no && op.order_id === id
      const pending = !linked || !invoiceFollowupsDone(op)
      return { id: doc.id, si: op.result?.si_no || '', uc: op.result?.uc_no || '', state: linked ? (pending ? 'followups' : 'ready') : 'allocation' }
    })
    if (order.invoice_allocation_id && !invoices.some(op => op.id === order.invoice_allocation_id))
      blockers.push('The current invoice request is missing. Ask Finance to review it.')
    if (invoices.some(op => op.state === 'allocation')) blockers.push('Finish or recover the outstanding invoice allocation before closure.')
    const current = invoices.find(op => op.id === order.invoice_allocation_id)
    if (current?.si && current.si !== orderSi(order)) blockers.push('The current invoice number differs from its receipt. Ask Finance to review the references.')
    if (invoices.some(op => op.state === 'followups')) blockers.push('Finish or have Finance review the pending invoice follow-ups before closure.')
    if (!jobs.empty) blockers.push('Invoice retry jobs remain. Refresh after Finance has resolved them.')
    if (!orderSi(order) && !['invoiced_in_jes', 'cancelled'].includes(noInvoiceReasonOf(order.no_invoice_reason)?.value) &&
        ((order.status && order.status !== 'draft') || order.source === 'direct_invoice' || Number(order.deposit_paid) > 0))
      blockers.push('Confirm the billing disposition in Sales Invoices before closure.')

    // Bind confirmation to the stock, finance and document versions the user reviewed.
    const version = snap => [snap.ref.path, snap.updateTime?.seconds ?? null, snap.updateTime?.nanoseconds ?? null]
    const token = createHash('sha256').update(JSON.stringify([
      version(orderSnap), version(decision), ...[movements, allocations, jobs, packing, freight, rfqs].flatMap(snap => snap.docs.map(version)),
    ])).digest('hex')
    if (input.action === 'closure_status') return {
      closed: false, base, token, stage: order.status || 'draft', stock, blockers,
      documents: { packing: packing.size, freight: freight.size }, invoices,
      canReviewInvoices: permitted(profile, 'uc'),
    }
    if (blockers.length) throw new OrderRequestError('Resolve the closure checklist before closing the order.', 409, 'closure-blocked')
    if (input.token !== token || !sameInvoiceValue(input.base, base))
      throw new OrderRequestError('The order or linked work changed. Refresh the closure checklist.', 409, 'closure-changed')
    tx.create(auditRef, { by: uid, reason: input.reason, closed_at: FieldValue.serverTimestamp(), base, stage: order.status || 'draft', invoices })
    tx.update(ref, { shipping_closed: true })
    return { closed: true, reason: input.reason, invoices }
  }, { readOnly: input.action === 'closure_status' })
}

export function validateClosureRequest(input) {
  if (input.action === 'closure_status') return
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500 ||
      !input.base || typeof input.base !== 'object' || !/^[a-f0-9]{64}$/.test(input.token || ''))
    throw new OrderRequestError('Refresh the checklist and enter a closure reason.', 400)
  input.reason = input.reason.trim()
}

export async function reviewClosureInvoice(repo, sql, orderId, operationId, identity, reason) {
  if (!validInvoiceOperationId(operationId)) throw new OrderRequestError('Choose a valid invoice receipt.', 400)
  const op = await repo.operation(orderId, operationId)
  if (op.status !== 'linked' || !op.result) throw new OrderRequestError('Link the issued invoice before reviewing its follow-ups.')
  const outcome = await sql.review(orderId, operationId, identity, reason)
  await repo.finishFollowupReview(orderId, operationId, outcome)
}
