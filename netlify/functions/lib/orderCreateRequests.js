import { readInitialDirectInvoice } from './initialDirectInvoice.js'
import { invoiceExpected } from '../../../src/invoiceRecoveryModel.js'
import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import {
  computeOrderTotals,
  normLine,
  normOrder,
  validateOrder
} from '../../../src/shippingModel.js'
import {
  formatSoNo,
  JES_SEED_BY_YEAR,
  soYear
} from '../../../src/soNumberModel.js'
import {
  prepareOrderCopy,
  requireCopyPermissions,
  checkUcRequest
} from './duplicateOrderCopy.js'
import {
  OrderRequestError,
  requirePermission,
  permitted,
  shippingProfile
} from './orderRequestAccess.js'
import { conversionCanonical } from '../../../src/quoteConversionModel.js'
import { PI_MAX_FILE_BYTES } from '../../../src/piUploadPolicy.js'

function originalFile(value) {
  if (value == null) return null
  if (value.size > PI_MAX_FILE_BYTES)
    throw new OrderRequestError('This PI exceeds the 20 MB limit. Select a smaller PDF or image.', 413)
  if (
    typeof value.name !== 'string' ||
    !value.name ||
    typeof value.type !== 'string' ||
    !/^(application\/(pdf|octet-stream)|image\/[a-z0-9.+-]+)$/i.test(
      value.type
    ) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    !/^[0-9a-f]{64}$/.test(value.sha256)
  ) {
    throw new OrderRequestError(
      'Invalid PI original. Select the file again.',
      400
    )
  }
  return {
    name: value.name,
    type: value.type,
    size: value.size,
    sha256: value.sha256
  }
}

export function prepareSnapshot(input) {
  const { order: header, lines } = input
  if (
    !header ||
    typeof header !== 'object' ||
    Array.isArray(header) ||
    !Array.isArray(lines) ||
    !lines.length ||
    lines.some(
      (line) => !line || typeof line !== 'object' || Array.isArray(line)
    )
  ) {
    throw new OrderRequestError('An order and its lines are required.', 400)
  }
  if (
    [
      'client_quote_id',
      'quote_conversion_id',
      'invoice_allocation_id',
      'invoice_reference_revision'
    ].some((key) => header[key] != null && header[key] !== '')
  ) {
    throw new OrderRequestError(
      'Use the original quote or invoice workflow for this order.',
      400
    )
  }
  for (const key of ['contact_id', 'customer_id']) {
    if (header[key] != null && typeof header[key] !== 'string')
      throw new OrderRequestError('Invalid customer or contact.', 400)
  }
  if (input.mode != null && input.mode !== 'direct')
    throw new OrderRequestError('Unknown order entry mode.', 400)
  const direct = input.mode === 'direct'
  const file = originalFile(input.file)
  if (file && direct)
    throw new OrderRequestError(
      'A Direct Invoice does not accept a PI upload.',
      400
    )
  const totals = computeOrderTotals(header, lines)
  const fields = {
    ...header,
    source: direct ? 'direct_invoice' : file ? 'imported_pi' : 'manual',
    source_file: null,
    subtotal: totals.subtotal > 0 ? totals.subtotal : null,
    total_amount: totals.subtotal > 0 ? totals.total : null
  }
  const checked = validateOrder(fields, lines)
  if (!checked.ok)
    throw new OrderRequestError(
      checked.errors.map((x) => x.message).join(' · '),
      400
    )
  const order = normOrder(fields)
  // New manual orders never inherit ownership of another workflow.
  order.client_quote_id = null
  delete order.quote_conversion_id
  delete order.invoice_allocation_id
  delete order.invoice_reference_revision
  const defaults = normOrder({})
  for (const key of Object.keys(defaults)) {
    if (key.startsWith('woo_') || key === 'channel') order[key] = defaults[key]
  }
  const items = lines.map((line, index) => {
    const item = normLine(line)
    return { ...item, line_no: item.line_no ?? index + 1 }
  })
  const fingerprint = createHash('sha256')
    .update(conversionCanonical({ order, items, file }))
    .digest('hex')
  return { order, items, file, fingerprint }
}

function view(snap) {
  if (!snap.exists) return { status: 'empty' }
  const data = snap.data()
  return {
    id: snap.id,
    direct: data.order.source === 'direct_invoice',
    status: data.status,
    file: data.file,
    customer: data.order.customer_name,
    customer_po: data.order.customer_po,
    source_id: data.source_id || null,
    source_label: data.source_label || null,
    uc: data.uc_receipt?.number || null,
    uc_started: !!data.uc_started,
    total: data.order.total_amount,
    currency: data.order.currency,
    line_count: data.line_count,
    so: data.so || '',
    order_id: data.status === 'committed' ? data.order_id : null
  }
}

export function createOrderRequests(db, verifyOriginal, getDuplicateUc) {
  const requests = (uid) =>
    db.collection('shipping_create_operators').doc(uid).collection('requests')
  // A deleted or replaced saved order must never be recreated from an old receipt.
  const read = async (tx, ref, includeLines = false, existing = null) => {
    const snap = existing || (await tx.get(ref))
    const result = view(snap)
    if (result.status === 'committed') {
      const order = await tx.get(db.collection('orders').doc(result.order_id))
      if (result.direct) {
        result.invoice = await readInitialDirectInvoice(tx, snap, order)
      }
      if (
        !order.exists ||
        !order.get('createdAt')?.isEqual?.(snap.data().committed_at)
      ) {
        const message =
          'The order linked to this request was removed or replaced. Review it in Shipping.'
        if (result.source_id || result.direct)
          return {
            ...result,
            status: 'review',
            order_id: null,
            review_message: message
          }
        throw new OrderRequestError(message)
      }
    }
    if (result.status === 'prepared' && includeLines) {
      const lines = await tx.get(ref.collection('lines'))
      result.lines = lines.docs
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((doc) => {
          const { item_code, description, qty_ordered, unit, unit_price } =
            doc.data()
          return { item_code, description, qty_ordered, unit, unit_price }
        })
    }
    return result
  }
  return {
    async list(uid, cursor) {
      return db.runTransaction(async (tx) => {
        let query = requests(uid).orderBy('created_at', 'desc')
        if (cursor) {
          const after = await tx.get(requests(uid).doc(cursor))
          if (!after.exists)
            throw new OrderRequestError('Reload the saved requests list.')
          query = query.startAfter(after)
        }
        const page = await tx.get(query.limit(21))
        const rows = page.docs.slice(0, 20)
        return {
          requests: await Promise.all(
            rows.map((snap) =>
              snap.get('order.source') === 'direct_invoice'
                ? read(tx, snap.ref, false, snap)
                : view(snap)
            )
          ),
          next: page.size === 21 ? rows.at(-1).id : null
        }
      })
    },
    async status(uid, id) {
      const ref = requests(uid).doc(id)
      const result = await db.runTransaction((tx) => read(tx, ref, true))
      if (result.status === 'prepared' && result.uc_started) {
        const profile = (await db.doc('users/' + uid).get()).data()
        if (!permitted(profile, 'uc'))
          return {
            ...result,
            uc_error: 'UC permission is required to check issuance.'
          }
        const data = (await ref.get()).data()
        try {
          const receipt = await getDuplicateUc(id, data.uc_request, false)
          result.uc = receipt?.number || null
        } catch (error) {
          result.uc_error =
            error instanceof OrderRequestError
              ? error.message
              : 'UC confirmation is unavailable. Resume the saved copy.'
        }
      }
      return result
    },
    async duplicate(uid, email, id, input) {
      const selected = await prepareOrderCopy(db, uid, email, id, input)
      return {
        ...(await this.status(uid, selected.id)),
        created: selected.created
      }
    },
    async prepare(uid, id, input) {
      const { order, items, file, fingerprint } = prepareSnapshot(input)
      const ref = requests(uid).doc(id)
      const orderId = db.collection('orders').doc().id
      await db.runTransaction(async (tx) => {
        const profile = await shippingProfile(db, tx, uid)
        if (order.source !== 'direct_invoice' && !order.erp_so_no)
          requirePermission(profile, 'quotes')
        const snap = await tx.get(ref)
        if (snap.exists) {
          if (snap.data().source_id || snap.data().fingerprint !== fingerprint)
            throw new OrderRequestError(
              'This request already contains different order details. Review the saved request.'
            )
          return
        }
        tx.create(ref, {
          order,
          file,
          fingerprint,
          order_id: orderId,
          line_count: items.length,
          status: 'prepared',
          created_at: FieldValue.serverTimestamp()
        })
        // Store lines separately so a valid multi-line PI need not fit in one document.
        items.forEach((line, i) =>
          tx.create(ref.collection('lines').doc(String(i)), line)
        )
      })
      return this.status(uid, id)
    },
    async commit(uid, id) {
      const ref = requests(uid).doc(id)
      const before = await db.runTransaction(async (tx) => {
        const result = await read(tx, ref)
        if (result.status === 'prepared' && result.source_id) {
          requireCopyPermissions(await shippingProfile(db, tx, uid))
          const data = (await tx.get(ref)).data()
          checkUcRequest(data, uid)
          if (!result.uc_started) {
            const target = await tx.get(
              db.collection('orders').doc(data.order_id)
            )
            const rows = await tx.get(ref.collection('lines'))
            if (target.exists || rows.size !== data.line_count)
              throw new OrderRequestError(
                'The saved copy or its target needs review before issuing a UC.'
              )
            tx.update(ref, { uc_started: true })
          }
          return { ...result, uc_request: data.uc_request }
        }
        return result
      })
      if (before.status === 'committed') return before
      if (before.status !== 'prepared')
        throw new OrderRequestError('No saved order request was found.')
      // SQL may commit even when the response is lost. The frozen request ID
      // is reused across both stores, including retries after a link failure.
      const uc = before.source_id
        ? await getDuplicateUc(id, before.uc_request, true)
        : null
      if (before.source_id && !uc?.number)
        throw new OrderRequestError('The UC receipt could not be confirmed.')
      const original =
        before.file && (await verifyOriginal(uid, id, before.file))
      if (before.file && !original) return { ...before, needs_file: true }
      return db.runTransaction(async (tx) => {
        const profile = await shippingProfile(db, tx, uid)
        const snap = await tx.get(ref)
        if (!snap.exists)
          throw new OrderRequestError('The saved request is missing.')
        const data = snap.data()
        if (data.status === 'committed') return read(tx, ref)
        if (before.source_id || data.source_id) {
          requireCopyPermissions(profile)
          checkUcRequest(data, uid)
          if (
            !uc ||
            conversionCanonical(data.uc_request) !==
              conversionCanonical(before.uc_request)
          )
            throw new OrderRequestError(
              'The copy request changed during UC issuance. Review the saved receipt.'
            )
        }
        const target = db.collection('orders').doc(data.order_id)
        const existing = await tx.get(target)
        const lines = await tx.get(ref.collection('lines'))
        if (
          existing.exists ||
          data.status !== 'prepared' ||
          lines.size !== data.line_count
        )
          throw new OrderRequestError(
            'The saved request and its order need review.'
          )
        let so = data.order.erp_so_no
        if (!so && data.order.source !== 'direct_invoice') {
          requirePermission(profile, 'quotes')
          const year = soYear()
          const counter = db.collection('counters').doc('so_' + year)
          const last = await tx.get(counter)
          const next =
            (last.exists
              ? Number(last.data().last) || 0
              : JES_SEED_BY_YEAR[year] || 0) + 1
          so = formatSoNo(year, next)
          tx.set(
            counter,
            {
              last: next,
              year,
              kind: 'so',
              updated_at: new Date().toISOString()
            },
            { merge: true }
          )
        }
        const timestamp = FieldValue.serverTimestamp()
        tx.create(target, {
          ...data.order,
          ...(uc ? { uc_no: uc.number } : {}),
          erp_so_no: so,
          source_file: original
            ? { name: data.file.name, url: original.url }
            : null,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        for (const line of lines.docs)
          tx.create(target.collection('lines').doc(), line.data())
        const direct = data.order.source === 'direct_invoice'
        const supplied = invoiceExpected(data.order).si
        const invoice = supplied
          ? { state: 'supplied', si: supplied }
          : { state: 'due' }
        tx.update(ref, {
          status: 'committed',
          ...(direct ? { initial_invoice: invoice } : {}),
          so,
          committed_at: timestamp,
          ...(uc ? { uc_receipt: uc } : {}),
          file_generation: original?.generation || null
        })
        return {
          ...view(snap),
          status: 'committed',
          order_id: target.id,
          ...(direct ? { invoice } : {}),
          so,
          uc: uc?.number || null
        }
      })
    }
  }
}
