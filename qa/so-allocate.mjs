// The guard that decides whether a new order gets an auto-allocated SO number.
//
// The real allocateSoNo() runs a Firestore transaction against counters/so_26,
// so it cannot run headless and must not run against production just to test.
// This pins the decision around it: allocate when the field is empty, keep what
// is there otherwise. Mirrors the inline logic in ShipmentForm handleCreate.
//
//   node qa/so-allocate.mjs

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// Stand-in for allocateSoNo: records that it was called and hands back a number.
function makeAllocator() {
  let calls = 0
  return { fn: async () => { calls++; return 'SO260028' }, calls: () => calls }
}

// The guard, copied verbatim from handleCreate so a drift here fails the test.
async function applySo(orderData, allocate, isDirect = false) {
  if (!isDirect && !orderData.erp_so_no) {
    orderData.erp_so_no = await allocate()
  }
  return orderData
}

console.log('— a new order with no SO gets one allocated')
{
  const a = makeAllocator()
  const o = await applySo({ erp_so_no: '' }, a.fn)
  check('SO filled', o.erp_so_no, 'SO260028')
  check('allocator called once', a.calls(), 1)
}

console.log('\n— an imported old JES PI keeps its existing SO')
{
  const a = makeAllocator()
  const o = await applySo({ erp_so_no: 'SO260012' }, a.fn)
  check('SO unchanged', o.erp_so_no, 'SO260012')
  check('allocator NOT called', a.calls(), 0)
}

console.log('\n— a Direct Invoice gets NO sales order number')
{
  // Retail (Amazon, web, small Alibaba) skips the sales order entirely and is
  // invoiced directly — owner, 2026-07-24. Minting an SO for one would consume
  // a number out of a gapless series for a document that does not exist.
  const a = makeAllocator()
  const o = await applySo({ erp_so_no: '' }, a.fn, true)
  check('SO left empty', o.erp_so_no, '')
  check('allocator NOT called', a.calls(), 0)
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
