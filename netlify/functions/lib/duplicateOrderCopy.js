import { FieldValue } from 'firebase-admin/firestore'
import {
  normOrder,
  normLine,
  orderSoDisplay
} from '../../../src/shippingModel.js'
import { conversionCanonical } from '../../../src/quoteConversionModel.js'
import { soYear } from '../../../src/soNumberModel.js'
import {
  copyOrderHeader,
  validRequestId
} from '../../../src/orderCreateRequestModel.js'
import {
  OrderRequestError,
  requirePermission,
  shippingProfile
} from './orderRequestAccess.js'

export function requireCopyPermissions(profile) {
  requirePermission(profile, 'uc')
  requirePermission(profile, 'quotes')
}
export function checkUcRequest(data, uid) {
  const request = data.uc_request
  if (
    !request ||
    request.actor_uid !== uid ||
    request.order_id !== data.order_id ||
    request.source_id !== data.source_id ||
    request.customer !== data.order.customer_name ||
    request.currency !== data.order.currency ||
    data.order.source !== 'duplicated'
  )
    throw new OrderRequestError(
      'The saved copy and its UC request do not match. Review the request.'
    )
}

export async function prepareOrderCopy(db, uid, email, id, input) {
  const { source_id: sourceId, previous_id: previous } = input
  if (
    typeof sourceId !== 'string' ||
    !sourceId.length ||
    sourceId.includes('/') ||
    sourceId === '.' ||
    sourceId === '..' ||
    Buffer.byteLength(sourceId) > 1500 ||
    (previous != null && !validRequestId(previous))
  )
    throw new OrderRequestError(
      'Choose a valid source order and copy request.',
      400
    )
  const directory = db.collection('shipping_create_operators').doc(uid)
  const latestRef = directory.collection('copies').doc(sourceId)
  const targetId = db.collection('orders').doc().id
  return db.runTransaction(async (tx) => {
    const profile = await shippingProfile(db, tx, uid)
    requireCopyPermissions(profile)
    const ref = directory.collection('requests').doc(id)
    const existing = await tx.get(ref)
    if (existing.exists) {
      if (
        existing.get('source_id') !== sourceId ||
        existing.get('previous_id') !== (previous || null)
      )
        throw new OrderRequestError(
          'This request ID belongs to a different action.'
        )
      return { id, created: false }
    }
    const pointer = await tx.get(latestRef)
    if (pointer.exists) {
      const latestId = pointer.get('request_id')
      const latest = await tx.get(
        directory.collection('requests').doc(latestId)
      )
      if (!latest.exists || latest.get('source_id') !== sourceId)
        throw new OrderRequestError('The latest copy request needs review.')
      if (!previous || latest.get('previous_id') === previous)
        return { id: latestId, created: false }
      if (latestId !== previous)
        throw new OrderRequestError(
          'Open the latest copy before starting another.'
        )
    } else if (previous)
      throw new OrderRequestError('The previous copy request is missing.')
    const sourceRef = db.collection('orders').doc(sourceId)
    const source = await tx.get(sourceRef)
    if (!source.exists)
      throw new OrderRequestError('The source order no longer exists.')
    const original = normOrder(source.data())
    const header = copyOrderHeader(original)
    if (
      input.expected_header &&
      conversionCanonical(input.expected_header) !== conversionCanonical(header)
    )
      throw new OrderRequestError(
        'The source order changed. Review the current Shipping row and try again.'
      )
    const sourceLines = await tx.get(sourceRef.collection('lines'))
    // The default document-ID order breaks ties. Retain old lines with
    // no line_no after the numbered lines instead of omitting them.
    const items = sourceLines.docs
      .map((line) => normLine(line.data()))
      .sort((a, b) => (a.line_no ?? Infinity) - (b.line_no ?? Infinity))
    const order = normOrder({
      ...header,
      source: 'duplicated',
      status: 'draft'
    })
    const request = {
      order_id: targetId,
      source_id: sourceId,
      actor_uid: uid,
      created_by: email || null,
      year: '/' + soYear(),
      customer: order.customer_name,
      currency: order.currency
    }
    tx.create(ref, {
      order,
      file: null,
      order_id: targetId,
      line_count: sourceLines.size,
      status: 'prepared',
      source_id: sourceId,
      source_label: orderSoDisplay(original) || sourceId,
      previous_id: previous || null,
      uc_request: request,
      created_at: FieldValue.serverTimestamp()
    })
    items.forEach((line, index) =>
      tx.create(ref.collection('lines').doc(String(index)), {
        ...line,
        line_no: index + 1
      })
    )
    tx.set(latestRef, { request_id: id })
    return { id, created: true }
  })
}
