import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore'
import { Timestamp as WebTimestamp } from 'firebase/firestore'
import {
  quoteSourceToken,
  quoteSourceCanonical,
  duplicateQuoteFields,
  QUOTE_CONVERSION_FIELDS
} from '../src/quoteConversionModel.js'
import {
  sourceToken,
  normalizeConversionDraft
} from '../netlify/functions/lib/quoteConversionModel.js'
import { createQuoteConversionHandler } from '../netlify/functions/lib/quoteConversionHandler.js'
import { quoteItemToOrderLine } from '../src/rangeQuote.js'
import { normOrder, computeOrderTotals } from '../src/shippingModel.js'
import { soYear, formatSoNo, JES_SEED_BY_YEAR } from '../src/soNumberModel.js'
const quote = {
  customer_id: 'fictional-customer',
  client_name: 'Fictional 中文 & Company',
  quote_currency: 'USD',
  quote_no: 'FICTIONAL-QUOTE'
}
const item = {
  id: 'item',
  is_custom: true,
  product_name: 'Fictional order',
  product_unit: 'pair',
  tiers: [
    { quantity: 1000, price: 1.222, remarks: 'Exact first tier' },
    { quantity: 2000, price: 1.111 }
  ]
}
const draft = () => ({
  order: {
    customer_id: quote.customer_id,
    customer_name: quote.client_name,
    currency: 'USD',
    notes: 'Original notes',
    deposit_paid: 155,
    source_file: { url: 'https://example.invalid/原始.pdf', name: '原始 & source.pdf' }
  },
  lines: [quoteItemToOrderLine(item, 0)]
})
test('browser and Admin source tokens agree across timestamps, unordered maps and item query order', async () => {
  const a = [
      { ...item, createdAt: new WebTimestamp(123, 456) },
      { id: 'Second', tiers: [{ price: 1, quantity: 2 }] }
    ],
    b = [a[1], { createdAt: new AdminTimestamp(123, 456), ...item }]
  assert.equal(await quoteSourceToken(quote, a), sourceToken({ ...quote }, b))
  assert.equal(
    await quoteSourceToken(
      {
        ...quote,
        converted_order_id: 'latest',
        order_conversion_version: 2,
        updatedAt: new WebTimestamp(999, 0)
      },
      a
    ),
    sourceToken(quote, a)
  )
  assert.notEqual(
    sourceToken(quote, a),
    sourceToken(quote, [{ ...a[0], tiers: [{ quantity: 1000, price: 1.223 }] }, a[1]])
  )
  assert.notEqual(sourceToken(quote, a), sourceToken(quote, [a[0]]))
  assert.notEqual(
    sourceToken(quote, a),
    sourceToken({ ...quote, client_name: 'Another buyer' }, a)
  )
})
test('all source item fields including internal prices and array order affect identity without exposing them', () => {
  const original = sourceToken(quote, [item])
  assert.notEqual(original, sourceToken(quote, [{ ...item, internal_cost_hkd: 5 }]))
  assert.notEqual(
    original,
    sourceToken(quote, [{ ...item, tiers: [...item.tiers].reverse() }])
  )
  assert.match(quoteSourceCanonical(quote, [item]), /Exact first tier/)
})
test('source identity distinguishes Firestore typed values, null and literal lookalike maps', () => {
  assert.notEqual(
    sourceToken({ ...quote, extra: NaN }, [item]),
    sourceToken({ ...quote, extra: null }, [item])
  )
  assert.notEqual(
    sourceToken({ ...quote, extra: new WebTimestamp(123, 456) }, [item]),
    sourceToken({ ...quote, extra: { $timestamp: [123, 456] } }, [item])
  )
  assert.notEqual(
    sourceToken({ ...quote, extra: '1' }, [item]),
    sourceToken({ ...quote, extra: 1 }, [item])
  )
})
test('quote Duplicate drops only conversion ownership and keeps commercial fields, attachments and original input', () => {
  const source = {
    id: 'original',
    ...quote,
    notes: 'Original notes',
    attachments: [{ name: '原件.pdf', url: 'https://example.invalid/original.pdf' }],
    custom_unknown: 'Keep me'
  }
  QUOTE_CONVERSION_FIELDS.forEach((k) => (source[k] = 'private-existing-pointer'))
  const before = structuredClone(source),
    copy = duplicateQuoteFields(source)
  for (const field of ['id', ...QUOTE_CONVERSION_FIELDS])
    assert.equal(Object.hasOwn(copy, field), false)
  assert.deepEqual(copy.attachments, source.attachments)
  assert.equal(copy.notes, source.notes)
  assert.equal(copy.custom_unknown, source.custom_unknown)
  assert.deepEqual(source, before)
})
test('shared normalization preserves first-tier precision, units, images, deposits, charge lines and source file', () => {
  const input = draft()
  input.lines[0].line_image = 'https://example.invalid/original.jpg'
  input.lines.push({
    description: 'Fictional charge',
    qty_ordered: null,
    unit_price: 20,
    line_type: 'non_product'
  })
  const prepared = normalizeConversionDraft(input)
  assert.equal(prepared.lines[0].unit_price, 1.222)
  assert.equal(prepared.lines[0].qty_ordered, 1000)
  assert.equal(prepared.lines[0].unit, 'pair')
  assert.equal(prepared.lines[0].tier_remarks, 'Exact first tier')
  assert.equal(prepared.order.total_amount, 1242)
  assert.equal(prepared.order.deposit_paid, 155)
  assert.deepEqual(prepared.order.source_file, input.order.source_file)
  assert.equal(prepared.lines[1].packable, false)
  assert.equal(prepared.order.source, 'in_app_quote')
  assert.equal(prepared.order.client_quote_id, null)
})
test('empty source may receive manually added lines and charge-only existing totals semantics remain unchanged', () => {
  const input = {
    order: { currency: 'GBP' },
    lines: [{ line_type: 'non_product', qty_ordered: null, unit_price: 20 }]
  }
  const prepared = normalizeConversionDraft(input)
  assert.equal(prepared.order.subtotal, null)
  assert.equal(prepared.order.total_amount, null)
  assert.equal(computeOrderTotals(input.order, input.lines).total, 20)
})
test('new draft cannot smuggle invoice allocation metadata or unnormalized monetary totals', () => {
  const input = draft()
  Object.assign(input.order, {
    invoice_allocation_id: 'private',
    invoice_reference_revision: 99,
    subtotal: 1,
    total_amount: 1,
    source: 'woocommerce',
    client_quote_id: 'other'
  })
  const prepared = normalizeConversionDraft(input)
  assert.equal(prepared.order.invoice_allocation_id, undefined)
  assert.equal(prepared.order.invoice_reference_revision, undefined)
  assert.equal(prepared.order.total_amount, 1222)
  assert.equal(prepared.order.source, 'in_app_quote')
})
for (const [name, change] of [
  ['negative deposit', (d) => (d.order.deposit_paid = -1)],
  ['deposit over actual total', (d) => (d.order.deposit_paid = 1223)],
  ['unknown currency', (d) => (d.order.currency = 'UNKNOWN')],
  ['nonfinite line price', (d) => (d.lines[0].unit_price = 'Infinity')],
  ['boolean quantity', (d) => (d.lines[0].qty_ordered = true)],
  ['unreviewed accounting adjustment', (d) => (d.order.accounting_total = 100)],
  ['unbounded notes', (d) => (d.order.notes = 'x'.repeat(20001))],
  ['unbounded line count', (d) => (d.lines = Array(201).fill(d.lines[0]))]
])
  test('reject ' + name + ' before writing', () => {
    const input = draft()
    change(input)
    assert.throws(() => normalizeConversionDraft(input))
  })
test('shared SO year, seeds and formatting remain on Hong Kong calendar', () => {
  assert.equal(soYear(new Date('2026-12-31T16:00:00Z')), '27')
  assert.equal(soYear(new Date('2026-12-31T15:59:59Z')), '26')
  assert.equal(JES_SEED_BY_YEAR['26'], 27)
  assert.equal(formatSoNo('26', 28), 'SO260028')
  assert.equal(
    normOrder({ quote_conversion_id: 'saved-receipt' }).quote_conversion_id,
    'saved-receipt'
  )
})
test('handler rejects anonymous, wrong role, invalid method/JSON/ID before any conversion work', async () => {
  const calls = [],
    handler = createQuoteConversionHandler({
      verifyToken: async (t) => {
        if (t === 'bad') throw Error()
        return { uid: t }
      },
      getProfile: async (uid) =>
        uid === 'admin' ? { role: 'admin' } : { role: 'customer', status: 'approved' },
      repo: new Proxy(
        {},
        {
          get: (_, key) => () => {
            calls.push(key)
            throw Error('Unexpected repository call')
          }
        }
      )
    })
  const send = async (method, token, body) =>
    handler(
      new Request('http://fictional.invalid/api/quote-order-conversion', {
        method,
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        ...(method === 'POST' ? { body } : {})
      })
    )
  assert.equal((await send('GET', null)).status, 405)
  assert.equal((await send('POST', null, '{}')).status, 401)
  assert.equal((await send('POST', 'bad', '{}')).status, 401)
  assert.equal((await send('POST', 'customer', '{}')).status, 403)
  assert.equal((await send('POST', 'admin', 'not-json')).status, 400)
  assert.equal(
    (
      await send(
        'POST',
        'admin',
        JSON.stringify({ action: 'status', quote_id: '../orders/private' })
      )
    ).status,
    400
  )
  assert.equal(
    (await send('POST', 'admin', JSON.stringify({ action: 'ready' }))).status,
    200
  )
  assert.deepEqual(calls, [])
})
test('new endpoint has no SQL/invoice/stock writer; migration is scoped to conversion rules', async () => {
  const wrapper = await readFile('netlify/functions/quote-order-conversion.js', 'utf8'),
    repo = await readFile('netlify/functions/lib/quoteConversionRepository.js', 'utf8')
  assert.doesNotMatch(
    wrapper + repo,
    /SUPABASE|invoiceAction|allocateInvoice|reserveOrder|stockMovement/
  )
})
