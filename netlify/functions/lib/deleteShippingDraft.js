import { orderEditBase } from '../../../src/orderEditModel.js'
import { sameInvoiceValue } from '../../../src/invoiceRecoveryModel.js'
import { orderDeletionBlock } from '../../../src/orderDeletion.js'
import { OrderRequestError, shippingProfile } from './orderRequestAccess.js'

const blocked = message => new OrderRequestError(message, 409, 'order-delete-blocked')

export async function deleteShippingDraft(db, uid, id, base, hasFinancialHistory) {
  const order = db.collection('orders').doc(id)
  return db.runTransaction(async tx => {
    await shippingProfile(db, tx, uid)
    const saved = (await tx.get(order)).data()
    if (!saved) return { deleted: false }
    if (!sameInvoiceValue(orderEditBase(saved), base)) {
      throw new OrderRequestError('This order changed after you opened it. Reload before deleting.', 409, 'order-delete-changed')
    }
    const reason = orderDeletionBlock(saved)
    if (reason) throw blocked(reason)

    const byOrder = collection => db.collection(collection).where('order_id', '==', id).limit(1)
    const [packing, freight, decision, rfq, allocations, followup, registry, credit, movement] = await Promise.all([
      tx.get(byOrder('packing_lists')),
      tx.get(byOrder('freight_quotes')),
      tx.get(db.collection('freight_decisions').doc(id)),
      tx.get(byOrder('freight_rfqs')),
      tx.get(order.collection('invoice_allocations').limit(1)),
      tx.get(byOrder('invoice_followup_jobs')),
      tx.get(byOrder('uc_invoices')),
      tx.get(byOrder('credit_notes')),
      tx.get(db.collectionGroup('movements').where('order_id', '==', id).limit(1)),
    ])
    if (!movement.empty) throw blocked('This order has stock movements. Keep it for stock history.')
    if (!packing.empty) throw blocked('This draft has a saved Packing List. Keep the order for reference.')
    if (!freight.empty || decision.exists || !rfq.empty) throw blocked('This draft has Freight history. Keep the order for reference.')
    if (!allocations.empty || !followup.empty || !registry.empty || !credit.empty || await hasFinancialHistory(id)) {
      throw blocked('This draft has financial records. Keep the order for reference.')
    }

    const lines = await tx.get(order.collection('lines').limit(500))
    if (lines.size >= 500) throw blocked('This draft has too many lines to delete in one operation.')
    for (const line of lines.docs) tx.delete(line.ref)
    tx.delete(order)
    return { deleted: true }
  })
}

export async function shippingDraftHasFinancialHistory(id, { url, key, fetchImpl = fetch }) {
  if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw Error('Financial history is unavailable.')
  const filter = new URLSearchParams({ select: 'id', order_id: 'eq.' + id, limit: '1' })
  const rows = await Promise.all(['app_sales_invoice', 'app_credit_note'].map(async table => {
    const response = await fetchImpl(new URL(`/rest/v1/${table}?${filter}`, url), {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw Error('Financial history could not be read.')
    const data = await response.json()
    if (!Array.isArray(data)) throw Error('Financial history response is invalid.')
    return data
  }))
  return rows.some(list => list.length > 0)
}
