import { createHash } from 'node:crypto'
import {
  normOrder,
  normLine,
  computeOrderTotals,
  validateOrder,
  ORDER_CURRENCIES
} from '../../../src/shippingModel.js'
import {
  conversionCanonical,
  quoteSourceCanonical
} from '../../../src/quoteConversionModel.js'
import { hasIncompleteRangeLine } from '../../../src/rangeQuote.js'

export class QuoteConversionError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const sourceToken = (quote, items) => digest(quoteSourceCanonical(quote, items))
export const valueToken = (value) => digest(conversionCanonical(value))
export function checkQuote(quote, items) {
  if (quote.quote_type === 'uploaded')
    throw new QuoteConversionError('This uploaded quote has no product lines to convert.')
  if (items.some(hasIncompleteRangeLine))
    throw new QuoteConversionError(
      'Complete the Crystocraft Range quantities and prices before converting this quote.'
    )
}
export function normalizeConversionDraft(draft) {
  if (
    !draft ||
    typeof draft !== 'object' ||
    Array.isArray(draft) ||
    !draft.order ||
    typeof draft.order !== 'object' ||
    Array.isArray(draft.order) ||
    !Array.isArray(draft.lines) ||
    draft.lines.length < 1 ||
    draft.lines.length > 200
  )
    throw new QuoteConversionError('Review an order with between 1 and 200 lines.', 400)
  if (!ORDER_CURRENCIES.includes(draft.order.currency))
    throw new QuoteConversionError('Choose a supported order currency.', 400)
  for (const key of ['customer_id', 'contact_id']) {
    const value = draft.order[key]
    if (
      value != null &&
      value !== '' &&
      (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    )
      throw new QuoteConversionError('Invalid order contact or customer identity.', 400)
  }
  for (const line of draft.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line))
      throw new QuoteConversionError('Invalid order line.', 400)
    for (const key of ['qty_ordered', 'unit_price']) {
      const n = line[key]
      if (
        n != null &&
        n !== '' &&
        (!['string', 'number'].includes(typeof n) ||
          !Number.isFinite(Number(n)) ||
          Math.abs(Number(n)) > 1e12)
      )
        throw new QuoteConversionError(
          'Order quantities and prices must be finite amounts.',
          400
        )
    }
    if (
      line.matched_product_ref &&
      (typeof line.matched_product_ref !== 'object' ||
        Array.isArray(line.matched_product_ref) ||
        Object.keys(line.matched_product_ref).some(
          (k) => !['collection', 'id', 'name'].includes(k)
        ) ||
        !['products', 'range_products'].includes(line.matched_product_ref.collection) ||
        typeof line.matched_product_ref.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(line.matched_product_ref.id))
    )
      throw new QuoteConversionError('Invalid matched product reference.', 400)
  }
  const checked = validateOrder(draft.order, draft.lines)
  if (!checked.ok)
    throw new QuoteConversionError(checked.errors.map((x) => x.message).join(' · '), 400)
  const totals = computeOrderTotals(draft.order, draft.lines)
  const order = normOrder({
    ...draft.order,
    source: 'in_app_quote',
    client_quote_id: null,
    subtotal: totals.subtotal > 0 ? totals.subtotal : null,
    total_amount: totals.subtotal > 0 ? totals.total : null
  })
  const normalizedCheck = validateOrder(order, draft.lines)
  if (!normalizedCheck.ok)
    throw new QuoteConversionError(
      normalizedCheck.errors.map((x) => x.message).join(' · '),
      400
    )
  // Allocation metadata belongs only to the saved invoice protocol, never a new order.
  delete order.invoice_allocation_id
  delete order.invoice_reference_revision
  for (const [key, value] of Object.entries(order))
    if (typeof value === 'string' && value.length > 20000)
      throw new QuoteConversionError('An order field is too long: ' + key, 400)
  if (
    order.source_file &&
    (typeof order.source_file !== 'object' ||
      Array.isArray(order.source_file) ||
      Object.keys(order.source_file).some((k) => !['url', 'name'].includes(k)) ||
      typeof order.source_file.name !== 'string' ||
      order.source_file.name.length > 500 ||
      typeof order.source_file.url !== 'string' ||
      order.source_file.url.length > 4000 ||
      !/^https:\/\//.test(order.source_file.url))
  )
    throw new QuoteConversionError('Invalid source attachment.', 400)
  const lines = draft.lines.map((line, i) => {
    const normalized = normLine(line)
    return {
      ...normalized,
      line_no: normalized.line_no == null ? i + 1 : normalized.line_no
    }
  })
  if (
    lines.some((l) =>
      Object.values(l).some((v) => typeof v === 'string' && v.length > 20000)
    )
  )
    throw new QuoteConversionError('An order line is too long.', 400)
  return { order, lines }
}
export const operationView = (op) =>
  op
    ? {
        id: op.id,
        status: op.status,
        kind: op.kind,
        reason: op.reason || '',
        cancellation_reason: op.cancel_reason || '',
        order_id: op.order_id,
        source_token: op.source_token,
        summary: {
          customer_name: op.payload.order.customer_name,
          customer_po: op.payload.order.customer_po,
          currency: op.payload.order.currency,
          total_amount: op.payload.order.total_amount,
          line_count: op.payload.lines.length,
          quantity: op.payload.lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0)
        },
        lines: op.payload.lines.map((l) => ({
          description: l.description,
          item_code: l.item_code,
          qty_ordered: l.qty_ordered,
          unit: l.unit,
          unit_price: l.unit_price,
          tier_remarks: l.tier_remarks
        })),
        result: op.result || null,
        error: op.error || ''
      }
    : null
