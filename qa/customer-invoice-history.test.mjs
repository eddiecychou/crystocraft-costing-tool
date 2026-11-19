import assert from 'node:assert/strict'
import test from 'node:test'
import { customerOcRows } from '../netlify/functions/lib/customerOcInvoices.js'
import { createCustomerOrderHistoryHandler } from '../netlify/functions/lib/customerOrderHistory.js'
import { buyerInvoiceHistory } from '../src/domain/customerInvoiceHistory.js'

const customerId = 'fictional-buyer',
  id = 'fictional-order'
const numbers = ['SI991001', 'SI991002', 'SI991003']
const order = {
  customer_id: customerId,
  status: 'confirmed',
  erp_si_no: numbers[2],
  invoice_allocation_id: 'op2',
  total_amount: 99,
  notes: 'PRIVATE',
}
const receipts = numbers.map((no, i) => ({
  id: 'op' + i,
  order_id: id,
  status: 'linked',
  before: { customerId },
  result: { si_no: no, invoice_id: 100 + i },
  request: { reason: 'PRIVATE' },
}))
const records = [{ id, order, receipts }]
const facts = numbers.map((si_no, i) => ({
  id: 100 + i,
  si_no,
  order_id: id,
  status: 'issued',
  total: 10 + i,
  created_by: 'PRIVATE',
}))
test('first, split and reissued invoices keep their own identities, dates, amounts and document links', async () => {
  const rows = await customerOcRows(records, customerId, async () => facts)
  assert.deepEqual(
    rows.map((r) => [r.no, r.original, r.amount]),
    numbers.map((n, i) => [n, i === 2, 10 + i]),
  )
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|customer_id|invoice_id|request|receipts/)
  assert.deepEqual(
    (await customerOcRows(records, customerId, async () => facts.map((f) => ({ ...f, total: null }))))[0]
      .amount,
    null,
  )
  const merged = buyerInvoiceHistory(rows, [{ code: numbers[0], date: '2026-03-01' }])
  assert.equal(merged.find((r) => r.no === numbers[0]).href, '/shop/invoice/erp-' + numbers[0])
  assert.equal(merged.find((r) => r.no === numbers[1]).href, null)
  assert.equal(
    merged.find((r) => r.no === numbers[2]).href,
    '/shop/invoice/app-fictional-order?si=' + numbers[2],
  )
})
test('conflicting, void, unlinked or foreign receipts and draft orders are withheld', async () => {
  for (const patch of [
    { status: 'void' },
    { order_id: 'foreign' },
    { uc_registry: { customer_id: 'other' } },
    { id: 999 },
  ]) {
    assert.deepEqual(
      await customerOcRows(records, customerId, async () => facts.map((f) => ({ ...f, ...patch }))),
      [],
    )
  }
  for (const patch of [
    { status: 'pending' },
    { before: { customerId: 'other' } },
    { before: {} },
    { order_id: 'foreign' },
  ]) {
    assert.deepEqual(
      await customerOcRows(
        [{ id, order, receipts: receipts.map((r) => ({ ...r, ...patch })) }],
        customerId,
        async () => facts,
      ),
      [],
    )
  }
  for (const patch of [
    { status: 'draft' },
    { customer_id: 'different' },
    { erp_si_no: '', erp_so_no: 'SO991001' },
  ]) {
    assert.deepEqual(
      await customerOcRows([{ id, order: { ...order, ...patch }, receipts }], customerId, async () => []),
      [],
    )
  }
  const legacy = {
    id,
    order: { customer_id: customerId, status: 'shipped', erp_so_no: ' SI980010 ' },
    receipts: [],
  }
  assert.equal((await customerOcRows([legacy], customerId, async () => []))[0].no, 'SI980010')
  assert.deepEqual(
    await customerOcRows([legacy], customerId, async () => [
      { si_no: 'SI980010', order_id: id, status: 'void' },
    ]),
    [],
  )
})
test('history filters JES before limiting and projects only exact confirmed company records', async () => {
  const deps = {
    verifyToken: async () => ({ uid: 'buyer' }),
    getProfile: async () => ({ role: 'customer', status: 'approved', customer_id: customerId }),
    getCustomer: async () => ({ erp_code: 'QA' }),
    fetcher: async (url) => {
      const p = new URL(url).searchParams
      assert.equal(p.get('customer_code'), 'eq.QA')
      assert.equal(p.get('limit'), '200')
      assert.match(p.get('status'), /confirmed/)
      return Response.json([
        { code: 'SI980010', customer_code: 'QA', status: 'confirmed', amount: 30, notes: 'PRIVATE' },
        { code: 'SI980011', customer_code: 'other', status: 'CONFIRMED' },
        { code: 'SI980012', customer_code: 'QA', status: 'VOID' },
      ])
    },
    SUPABASE_URL: 'https://fixture.test',
    SERVICE_KEY: 'fixture',
  }
  const handler = createCustomerOrderHistoryHandler(deps)
  const response = await handler(
    new Request('https://example.test/', {
      method: 'POST',
      headers: { Authorization: 'Bearer QA' },
      body: '{}',
    }),
  )
  assert.equal(response.status, 200)
  const { rows } = await response.json()
  assert.deepEqual(
    rows.map((r) => r.code),
    ['SI980010'],
  )
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|customer_code/)
})
