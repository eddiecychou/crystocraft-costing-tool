import { isDeepStrictEqual } from 'node:util'
import { FieldValue } from 'firebase-admin/firestore'
import { freightPackingBasis, normFreightQuote, packingRevision } from '../../../src/freightQuoteModel.js'
import { validInvoiceOrderId } from '../../../src/invoiceRecoveryModel.js'
import { OrderRequestError, shippingProfile } from './orderRequestAccess.js'

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const scenarioChanged = () => new OrderRequestError(
  'The packing scenario changed. Reload its totals before saving.', 409, 'freight/scenario-changed'
)

export function createPackingFreight(db) {
  const quotes = db.collection('freight_quotes')
  const scenarios = db.collection('packing_lists')

  return async (uid, body) => {
    const { action, order_id: orderId, id } = body
    if (!validInvoiceOrderId(orderId) || !validId(id))
      throw new OrderRequestError('Choose a saved order and a valid record.', 400)

    return db.runTransaction(async tx => {
      await shippingProfile(db, tx, uid)
      const order = (await tx.get(db.collection('orders').doc(orderId))).data()
      if (!order) throw new OrderRequestError('Order is no longer available.', 404)
      const closed = order.shipping_closed === true

      if (action === 'create_freight_quote') {
        const ref = quotes.doc(id)
        const existing = (await tx.get(ref)).data()
        if (existing) {
          if (existing.order_id !== orderId) throw new OrderRequestError('Freight quote belongs to another order.')
          return { ...existing, id }
        }
        if (closed) throw new OrderRequestError('This Shipping order is closed.')
        const input = body.quote
        if (!input || typeof input !== 'object' || input.order_id !== orderId ||
          (input.scenario_id !== null && !validId(input.scenario_id)))
          throw new OrderRequestError('Invalid freight quote.', 400)
        const payload = normFreightQuote({ ...input, is_chosen: false })
        if (!payload.vendor_name && !payload.vendor_id)
          throw new OrderRequestError('Enter a vendor name or pick from the list.', 400)
        if (payload.scenario_id) {
          const scenarioRef = scenarios.doc(payload.scenario_id)
          const scenario = (await tx.get(scenarioRef)).data()
          if (scenario?.order_id !== orderId || !isDeepStrictEqual(freightPackingBasis(scenario), body.basis))
            throw scenarioChanged()
          payload.scenario_label = scenario.label || 'Standard carton'
          payload.scenario_revision = body.basis.revision.save_id
          if (body.basis.revision.legacy_stamp) payload.scenario_legacy_stamp = body.basis.revision.legacy_stamp
          // Share a written document with deletion, even if its reverse lookup is empty.
          tx.update(scenarioRef, { freight_link_revision: FieldValue.increment(1) })
        }
        tx.create(ref, { ...payload, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        return { ...payload, id }
      }

      if (closed) throw new OrderRequestError('This Shipping order is closed.')
      const ref = scenarios.doc(id)
      const scenario = (await tx.get(ref)).data()
      if (!scenario) return { deleted: false }
      if (scenario.order_id !== orderId || !isDeepStrictEqual(packingRevision(scenario), body.revision))
        throw new OrderRequestError('This packing scenario changed elsewhere. Reopen the latest version before deleting.')

      const linked = await tx.get(quotes.where('scenario_id', '==', id).limit(1))
      if (!linked.empty)
        throw new OrderRequestError('This packing scenario has a saved freight quote and cannot be deleted.', 409, 'packing/freight-linked')

      const cartons = await tx.get(ref.collection('cartons').limit(500))
      let writesLeft = 499 - cartons.size
      const children = cartons.docs.map(carton => carton.ref)
      for (const carton of cartons.docs) {
        if (writesLeft < 0) break
        const contents = await tx.get(carton.ref.collection('contents').limit(writesLeft + 1))
        writesLeft -= contents.size
        children.push(...contents.docs.map(item => item.ref))
      }
      if (writesLeft < 0) throw new OrderRequestError('This packing plan is too large to delete in one operation.')
      for (const child of children) tx.delete(child)
      tx.delete(ref)
      return { deleted: true }
    })
  }
}
