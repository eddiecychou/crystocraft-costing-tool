// The guard that decides whether a newly created order gets an invoice number.
//
// The real allocateInvoice() is a Postgres call and must not run against
// production to be tested. This pins the decision around it, mirroring the
// inline logic in ShipmentForm handleCreate, plus the ordering property that
// matters: allocation happens AFTER the order commits, so a failed create can
// never burn an invoice number.
//
//   node qa/si-allocate.mjs

let failed = 0
const check = (label, cond) => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
}

function makeAllocator(shouldFail = false) {
  let calls = 0
  return {
    calls: () => calls,
    fn: async () => {
      calls++
      if (shouldFail) throw new Error('postgres unreachable')
      return { si_no: 'SI260095', uc_no: 'UC4952/26' }
    },
  }
}

// Mirrors handleCreate: create first, then allocate for the direct flow only.
async function createOrder({ isDirect, orderData }, allocate, { commitFails = false } = {}) {
  const log = []
  if (commitFails) { log.push('commit-failed'); return { log, order: null, error: 'commit failed' } }
  const order = { id: 'o1', ...orderData }
  log.push('committed')
  let error = null
  if (isDirect && !order.erp_si_no) {
    try {
      const res = await allocate()
      order.erp_si_no = res.si_no
      order.uc_no = res.uc_no || order.uc_no || ''
      order.invoiced_at = order.invoiced_at || '2026-07-23'
      log.push('allocated')
    } catch (e) { error = e.message }
  }
  return { log, order, error }
}

console.log('— a Direct Invoice with no number gets one')
{
  const a = makeAllocator()
  const { order, log } = await createOrder(
    { isDirect: true, orderData: { customer_name: 'Widdop', currency: 'USD', uc_no: 'UC4920/26' } }, a.fn)
  check('invoice number allocated', order.erp_si_no === 'SI260095')
  check('invoice date stamped', !!order.invoiced_at)
  check('allocator called once', a.calls() === 1)
  check('order committed BEFORE allocating', log.join('>') === 'committed>allocated')
  // The whole point: it now has an SI, so the Sales Invoices page lists it.
  check('would appear in the invoiced list', !!order.erp_si_no)
}

console.log('\n— a normal order is left alone (invoicing happens later)')
{
  const a = makeAllocator()
  const { order } = await createOrder(
    { isDirect: false, orderData: { customer_name: 'Widdop', currency: 'USD' } }, a.fn)
  check('no invoice number', !order.erp_si_no)
  check('allocator NOT called', a.calls() === 0)
}

console.log('\n— an invoice number already typed in is kept')
{
  const a = makeAllocator()
  const { order } = await createOrder(
    { isDirect: true, orderData: { erp_si_no: 'SI260012', customer_name: 'W' } }, a.fn)
  check('existing number untouched', order.erp_si_no === 'SI260012')
  check('allocator NOT called', a.calls() === 0)
}

console.log('\n— if the order cannot be created, no number is burned')
{
  const a = makeAllocator()
  const { order } = await createOrder(
    { isDirect: true, orderData: { customer_name: 'W' } }, a.fn, { commitFails: true })
  check('no order', order === null)
  check('allocator NOT called — nothing burned', a.calls() === 0)
}

console.log('\n— if allocation fails, the order survives')
{
  const a = makeAllocator(true)
  const { order, error } = await createOrder(
    { isDirect: true, orderData: { customer_name: 'W' } }, a.fn)
  check('order still exists', !!order && order.id === 'o1')
  check('error surfaced, not swallowed', /postgres unreachable/.test(error || ''))
  check('no invoice number, so Allocate is still available', !order.erp_si_no)
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
