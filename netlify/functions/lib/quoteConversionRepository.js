import { randomUUID } from 'node:crypto'
import {
  conversionRevision,
  validConversionId
} from '../../../src/quoteConversionModel.js'
import { JES_SEED_BY_YEAR, soYear, formatSoNo } from '../../../src/soNumberModel.js'
import {
  QuoteConversionError,
  normalizeConversionDraft,
  sourceToken,
  valueToken,
  operationView,
  checkQuote
} from './quoteConversionModel.js'

// All conversion writes are server-owned. Commercial order fields use the same
// pure normalizers/totals as the editor; numbering remains in Firestore.
export function createQuoteConversionRepository(db, stamp, clock = () => new Date()) {
  const quoteRef = (id) => db.doc('client_quotes/' + id)
  const opRef = (id, op) => quoteRef(id).collection('order_conversions').doc(op)
  const requireQuote = (snap) => {
    if (!snap.exists)
      throw new QuoteConversionError('That quote could not be found.', 404)
    return { ...snap.data(), id: snap.id }
  }
  const items = async (tx, id) => {
    const snap = await tx.get(quoteRef(id).collection('items').limit(1001))
    if (snap.size > 1000)
      throw new QuoteConversionError(
        'This quote is too large for a single conversion. Review its scope first.',
        400
      )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  }
  const readOp = async (tx, id, operationId) => {
    if (!validConversionId(operationId))
      throw new QuoteConversionError('The saved conversion request needs review.')
    const snap = await tx.get(opRef(id, operationId))
    if (!snap.exists || snap.data().quote_id !== id || snap.data().id !== operationId)
      throw new QuoteConversionError(
        'The saved conversion request is missing or mismatched. Review it before creating another order.'
      )
    return snap.data()
  }
  const legacyId = (q) =>
    q.legacy_converted_order_id ||
    (!q.latest_order_conversion_id ? q.converted_order_id : null)
  const readLegacy = async (tx, q) => {
    const id = legacyId(q)
    if (!id) return null
    if (!validConversionId(id))
      throw new QuoteConversionError('The legacy order link needs review.')
    const snap = await tx.get(db.doc('orders/' + id)),
      order = snap.exists ? snap.data() : null
    return {
      order_id: id,
      missing: !order,
      customer_matches: !!order && order.customer_id === q.customer_id,
      order_no: order?.erp_so_no || '',
      customer_name: order?.customer_name || '',
      review_token: valueToken({ id, order }),
      verified: false
    }
  }
  const checkLegacy = (legacy, input) => {
    if (
      legacy &&
      (!input.legacy_review ||
        input.legacy_review.order_id !== legacy.order_id ||
        input.legacy_review.review_token !== legacy.review_token)
    )
      throw new QuoteConversionError(
        'Review the current legacy order link before creating a separate additional order.'
      )
  }
  const requireRevision = (q, input) => {
    if (
      !Number.isSafeInteger(input.expected_revision) ||
      input.expected_revision !== conversionRevision(q)
    )
      throw new QuoteConversionError(
        'Another conversion changed this quote. Reload its saved requests before creating an additional order.'
      )
  }
  const checkSource = (q, rows, token) => {
    if (sourceToken(q, rows) !== token)
      throw new QuoteConversionError(
        'The quote or its items changed. Review the updated source before creating this order.'
      )
    checkQuote(q, rows)
  }
  return {
    async state(id, cursor = null) {
      return db.runTransaction(async (tx) => {
        const q = requireQuote(await tx.get(quoteRef(id))),
          rows = await items(tx, id)
        const active = q.active_order_conversion_id
          ? await readOp(tx, id, q.active_order_conversion_id)
          : null
        const latest = q.latest_order_conversion_id
          ? await readOp(tx, id, q.latest_order_conversion_id)
          : null
        const legacy = await readLegacy(tx, q)
        let query = quoteRef(id)
          .collection('order_conversions')
          .orderBy('created_at', 'desc')
          .orderBy('__name__', 'desc')
        if (cursor) {
          const selected = await tx.get(opRef(id, cursor))
          if (!selected.exists)
            throw new QuoteConversionError(
              'The selected history page is unavailable. Reload the quote.'
            )
          query = query.startAfter(selected)
        }
        const history = await tx.get(query.limit(21))
        const visible = history.docs.slice(0, 20).map((d) => d.data())
        const orders = new Map()
        for (const op of [...visible, ...(latest ? [latest] : [])])
          if (op.status === 'committed' && !orders.has(op.order_id)) {
            const snap = await tx.get(db.doc('orders/' + op.order_id))
            orders.set(op.order_id, {
              missing: !snap.exists,
              customer_matches: snap.exists && snap.data().customer_id === q.customer_id
            })
          }
        const view = (op) =>
          op ? { ...operationView(op), ...(orders.get(op.order_id) || {}) } : null
        return {
          revision: conversionRevision(q),
          source_token: sourceToken(q, rows),
          active: view(active),
          latest: view(latest),
          legacy,
          history: visible.map(view),
          more_history: history.size > 20,
          next_cursor: history.size > 20 ? visible.at(-1).id : null
        }
      })
    },
    async prepare(id, input, identity) {
      // Generated outside the transaction callback: contention may rerun it.
      const operationId = randomUUID(),
        orderId = db.collection('orders').doc().id
      const payload = normalizeConversionDraft(input.draft),
        fingerprint = valueToken(payload)
      return db.runTransaction(async (tx) => {
        const q = requireQuote(await tx.get(quoteRef(id)))
        if (q.active_order_conversion_id) {
          const op = await readOp(tx, id, q.active_order_conversion_id)
          if (
            op.payload_token === fingerprint &&
            op.kind === input.kind &&
            op.reason === (input.reason || '') &&
            op.initial_revision === input.expected_revision &&
            op.source_token === input.expected_source
          )
            return { operation_id: op.id }
          throw new QuoteConversionError(
            'A saved conversion is already pending. Resume or cancel that request before starting another.'
          )
        }
        if (
          input.kind === 'initial' &&
          (q.converted_order_id || q.latest_order_conversion_id)
        )
          return { existing: true }
        requireRevision(q, input)
        if (
          input.kind === 'additional' &&
          !q.converted_order_id &&
          !q.latest_order_conversion_id
        )
          throw new QuoteConversionError(
            'Create the first order before requesting an additional order.'
          )
        const rows = await items(tx, id),
          legacy = await readLegacy(tx, q)
        checkSource(q, rows, input.expected_source)
        checkLegacy(legacy, input)
        if (q.customer_id && payload.order.customer_id !== q.customer_id)
          throw new QuoteConversionError(
            'The order customer differs from the quote. Review the customer association first.'
          )
        const record = {
          id: operationId,
          quote_id: id,
          order_id: orderId,
          kind: input.kind,
          reason: input.reason || '',
          initial_revision: conversionRevision(q),
          source_token: input.expected_source,
          payload_token: fingerprint,
          payload,
          legacy_review: legacy ? { ...legacy, reason: input.reason } : null,
          status: 'prepared',
          result: null,
          error: '',
          created_by_uid: identity.uid,
          created_at: stamp()
        }
        tx.create(opRef(id, operationId), record)
        tx.update(quoteRef(id), {
          active_order_conversion_id: operationId,
          order_conversion_version: conversionRevision(q),
          ...(legacy && !q.legacy_converted_order_id
            ? { legacy_converted_order_id: legacy.order_id }
            : {}),
          updatedAt: stamp()
        })
        return { operation_id: operationId }
      })
    },
    async commit(id, operationId) {
      return db.runTransaction(async (tx) => {
        const q = requireQuote(await tx.get(quoteRef(id))),
          op = await readOp(tx, id, operationId)
        const order = db.doc('orders/' + op.order_id),
          existing = await tx.get(order)
        if (op.status === 'committed') {
          if (
            !existing.exists ||
            existing.data().client_quote_id !== id ||
            existing.data().quote_conversion_id !== op.id
          )
            throw new QuoteConversionError(
              'The saved conversion receipt has a missing or mismatched order. Review it; do not recreate it.'
            )
          return op.result
        }
        if (op.status !== 'prepared' || q.active_order_conversion_id !== op.id)
          throw new QuoteConversionError(
            'This request is no longer active. Reload the quote before continuing.'
          )
        if (existing.exists)
          throw new QuoteConversionError(
            'This order ID already exists without a matching conversion receipt. Review required.'
          )
        if (valueToken(op.payload) !== op.payload_token)
          throw new QuoteConversionError(
            'The frozen request does not match its saved fingerprint. Review required.'
          )
        if (conversionRevision(q) !== op.initial_revision)
          throw new QuoteConversionError(
            'The conversion revision changed. Review the saved request.'
          )
        const rows = await items(tx, id)
        checkSource(q, rows, op.source_token)
        const legacy = await readLegacy(tx, q)
        if ((legacy?.review_token || null) !== (op.legacy_review?.review_token || null))
          throw new QuoteConversionError(
            'The reviewed legacy link changed. Cancel this request and review it again.'
          )
        const now = clock(),
          yy = soYear(now),
          counter = db.doc('counters/so_' + yy)
        let so = op.payload.order.erp_so_no || '',
          next = null
        if (!so) {
          const snap = await tx.get(counter)
          const last = snap.exists
            ? Number(snap.data().last) || 0
            : Number(JES_SEED_BY_YEAR[yy]) || 0
          next = last + 1
          so = formatSoNo(yy, next)
        }
        // Every read is complete. Counter, order, lines, receipt and source link
        // either all commit or all roll back. No later best-effort backlink.
        const result = { order_id: op.order_id, so }
        if (next != null)
          tx.set(
            counter,
            { last: next, year: yy, kind: 'so', updated_at: now.toISOString() },
            { merge: true }
          )
        tx.create(order, {
          ...op.payload.order,
          source: 'in_app_quote',
          client_quote_id: id,
          quote_conversion_id: op.id,
          erp_so_no: so,
          createdAt: stamp(),
          updatedAt: stamp()
        })
        op.payload.lines.forEach((line, i) =>
          tx.create(order.collection('lines').doc('quote-line-' + (i + 1)), line)
        )
        tx.update(opRef(id, op.id), {
          status: 'committed',
          result,
          committed_at: stamp(),
          error: ''
        })
        tx.update(quoteRef(id), {
          converted_order_id: op.order_id,
          latest_order_conversion_id: op.id,
          active_order_conversion_id: null,
          order_conversion_version: conversionRevision(q) + 1,
          updatedAt: stamp()
        })
        return result
      })
    },
    async cancel(id, operationId, identity, reason) {
      return db.runTransaction(async (tx) => {
        const q = requireQuote(await tx.get(quoteRef(id))),
          op = await readOp(tx, id, operationId)
        if (op.status === 'cancelled') return
        if (op.status !== 'prepared' || q.active_order_conversion_id !== op.id)
          throw new QuoteConversionError(
            'Only the active uncommitted request can be cancelled. No existing order will be deleted.'
          )
        if ((await tx.get(db.doc('orders/' + op.order_id))).exists)
          throw new QuoteConversionError(
            'An order already exists for this request. Review it before cancelling.'
          )
        tx.update(opRef(id, op.id), {
          status: 'cancelled',
          cancelled_by_uid: identity.uid,
          cancel_reason: reason,
          cancelled_at: stamp()
        })
        tx.update(quoteRef(id), {
          active_order_conversion_id: null,
          order_conversion_version: conversionRevision(q) + 1,
          updatedAt: stamp()
        })
      })
    }
  }
}
