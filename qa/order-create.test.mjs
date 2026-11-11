import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prepareSnapshot } from '../netlify/functions/lib/orderCreateRequests.js'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { requestUrl, validRequestId } from '../src/orderCreateRequestModel.js'
import { PI_MAX_FILE_BYTES, assertPiUploadSize } from '../src/piUploadPolicy.js'
import { preparePiUploadFile } from '../src/piUploadFile.js'
import { readFile } from 'node:fs/promises'

const order = {
  customer_id: 'fixture',
  customer_name: 'Review',
  erp_so_no: '',
  currency: 'GBP',
  deposit_paid: 100,
  pi_revision: 3
}
const line = {
  item_code: 'QA',
  qty_ordered: 1000,
  unit_price: 1.222,
  line_type: 'ad_hoc',
  unit: 'pcs'
}
test('PI size boundary matches frontend, server and Storage; oversized selection never reads bytes', async () => {
  const file = { name: 'fictional.pdf', type: 'application/pdf', size: PI_MAX_FILE_BYTES, sha256: 'a'.repeat(64) }
  assert.doesNotThrow(() => assertPiUploadSize(file))
  assert.equal(prepareSnapshot({ order, lines: [line], file }).file.size, PI_MAX_FILE_BYTES)
  for (const size of [PI_MAX_FILE_BYTES + 1, 2 * 1024 * 1024 * 1024]) {
    const oversized = { ...file, size, arrayBuffer() { assert.fail('Oversized original must not be read') } }
    assert.throws(() => assertPiUploadSize(oversized), { code: 'pi-file-too-large' })
    await assert.rejects(preparePiUploadFile(oversized), { code: 'pi-file-too-large' })
    assert.throws(() => prepareSnapshot({ order, lines: [line], file: oversized }), e => e.status === 413 && /20 MB/.test(e.message))
  }
  const rules = await readFile('storage.rules', 'utf8')
  const match = rules.match(/match \/shipping_pi_originals[\s\S]*?request\.resource\.size <= (\d+) \* 1024 \* 1024/)
  assert.equal(Number(match?.[1]) * 1024 * 1024, PI_MAX_FILE_BYTES)
})
test('normalized manual and PI requests retain current precision, stated totals and optional fields', () => {
  const first = prepareSnapshot({ order, lines: [line] })
  assert.equal(first.order.total_amount, 1222)
  assert.equal(first.order.source, 'manual')
  assert.equal(first.order.deposit_paid, 100)
  assert.equal(first.order.pi_revision, 3)
  assert.equal(first.items[0].line_no, 1)
  assert.equal(first.items[0].unit_price, 1.222)
  const file = {
    name: '來源.pdf',
    type: 'application/pdf',
    size: 4,
    sha256: 'b'.repeat(64)
  }
  const pi = prepareSnapshot({
    order: {
      ...order,
      erp_so_no: 'SO-LEGACY',
      pi_subtotal: 2000,
      discount_amount: 0
    },
    file,
    lines: [line]
  })
  assert.equal(pi.order.pi_subtotal, 2000)
  assert.equal(pi.order.source, 'imported_pi')
  assert.equal(pi.order.erp_so_no, 'SO-LEGACY')
  assert.deepEqual(pi.file, file)
  assert.notEqual(first.fingerprint, pi.fingerprint)
  assert.equal(
    first.fingerprint,
    prepareSnapshot({ lines: [{ ...line }], order: { ...order } }).fingerprint
  )
  assert.notEqual(
    first.fingerprint,
    prepareSnapshot({ order: { ...order, notes: 'revised' }, lines: [line] })
      .fingerprint
  )
})
test('invalid deposits, foreign workflow ownership, malformed files and missing lines are rejected', () => {
  for (const changes of [
    { order: { ...order, deposit_paid: 1223 } },
    { order: { ...order, invoice_allocation_id: 'forged' } },
    { order: { ...order, client_quote_id: 'forged' } },
    { file: { name: 'x.pdf' } },
    { lines: [] }
  ])
    assert.throws(
      () => prepareSnapshot({ order, lines: [line], ...changes }),
      (e) => e.status === 400
    )
})
test('request links retain the customer and bind one operation to its owner', () => {
  const id = randomUUID(),
    u = new URL(
      requestUrl('QA', id, new URLSearchParams('customer_id=fixture')),
      'https://example.invalid'
    )
  assert.equal(u.searchParams.get('customer_id'), 'fixture')
  assert.equal(u.searchParams.get('operator'), 'QA')
  assert.equal(u.searchParams.get('request'), id)
  assert.ok(validRequestId(id))
  assert.equal(validRequestId('../records'), false)
})
test('endpoint refuses missing login, customers, malformed IDs and another operator before repository calls', async () => {
  const handler = orderRequestHandler({
    verifyToken: async (uid) => ({ uid }),
    getProfile: async (uid) =>
      uid === 'admin' ? { role: 'admin' } : { role: 'customer' },
    repo: {}
  })
  const call = (uid, body, method = 'POST') =>
    handler(
      new Request('https://fixture.invalid/api/shipping-order-request', {
        method,
        headers: uid ? { authorization: 'Bearer ' + uid } : {},
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
      })
    )
  assert.equal((await call('admin', {}, 'GET')).status, 405)
  assert.equal((await call(null, {})).status, 401)
  assert.equal((await call('customer', { action: 'list' })).status, 403)
  assert.equal(
    (
      await call('admin', {
        action: 'status',
        operator: 'other',
        id: randomUUID()
      })
    ).status,
    403
  )
  assert.equal(
    (
      await call('admin', {
        action: 'commit',
        operator: 'admin',
        id: '../oops'
      })
    ).status,
    400
  )
})

test('direct mode retains a supplied reference, exact line totals, and its own fingerprint', () => {
  const header = { ...order, erp_si_no: 'SI-SUPPLIED' }
  const direct = prepareSnapshot({
    order: header,
    lines: [line],
    mode: 'direct'
  })
  const manual = prepareSnapshot({ order: header, lines: [line] })
  assert.equal(direct.order.source, 'direct_invoice')
  assert.equal(direct.order.erp_so_no, '')
  assert.equal(direct.order.erp_si_no, 'SI-SUPPLIED')
  assert.equal(direct.order.total_amount, 1222)
  assert.notEqual(direct.fingerprint, manual.fingerprint)
  assert.throws(
    () => prepareSnapshot({ order, lines: [line], mode: 'arbitrary' }),
    (e) => e.status === 400
  )
})
