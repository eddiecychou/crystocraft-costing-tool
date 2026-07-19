// Order → material consumption roll-up (V7.16, JES retirement step 4).
//
// Why this exists: JES made recording material consumption unavoidable — you
// could not move material without a job order. Dropping job orders drops that
// enforcement, so the app has to answer "was this order's consumption actually
// recorded?" somewhere visible. Before this, the answer lived only inside three
// separately-collapsed cards on one order, styled so the *failure* state was
// quieter than the success states.
//
// Deliberately not a nag: a card nobody touched is not counted as missing,
// because plenty of orders legitimately use no packaging or no crystals. Only
// work that was STARTED and left unfinished — or finished with known gaps —
// counts as partial.

// Per-class stage from the order doc. Mirrors the cards' own reading of it.
export function stageOf(orderData, cfg) {
  const d = orderData || {}
  const o = cfg.order
  if (d[o.committed] || d[o.legacyIssued]) return 'committed'
  if (d[o.reserved]) return 'reserved'
  return 'open'
}

// Gaps recorded at reserve time: BOM parts with no ledger component, and order
// lines that matched no Range product. Persisted by reserveForOrder so they
// survive the preview — an order reserved with 3 of 5 components must not look
// identical to one reserved with 5 of 5.
export function gapsOf(orderData, cfg) {
  const g = cfg.order.gaps ? (orderData || {})[cfg.order.gaps] : null
  const missing = g?.missing || []
  const unmatched = g?.unmatched || []
  return { missing, unmatched, count: missing.length + unmatched.length }
}

// Roll-up across every stock class on the order.
//   'none'     — nothing reserved or consumed anywhere
//   'partial'  — started and not finished, or finished with known gaps
//   'recorded' — everything touched was consumed, with no gaps
export function orderStockStatus(orderData, cfgs) {
  const parts = cfgs.map(cfg => ({
    cfg,
    title: cfg.cardTitle || 'Component',
    stage: stageOf(orderData, cfg),
    gaps: gapsOf(orderData, cfg),
  }))
  const touched = parts.filter(p => p.stage !== 'open')
  const gapCount = parts.reduce((n, p) => n + p.gaps.count, 0)

  let state
  if (!touched.length) state = 'none'
  else if (touched.every(p => p.stage === 'committed') && !gapCount) state = 'recorded'
  else state = 'partial'

  return { state, parts, touched, gapCount }
}

// Wording for the chip and the pre-ship confirm. Kept here so the two can never
// disagree about what a state means.
export const STOCK_STATUS_LABEL = {
  none: 'Stock: not recorded',
  partial: 'Stock: partly recorded',
  recorded: 'Stock: recorded',
}

export const STOCK_STATUS_STYLE = {
  none: 'bg-red-50 text-red-700 border-red-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  recorded: 'bg-green-50 text-green-700 border-green-200',
}

// Why an order isn't clean, in one line — used in the confirm dialog so the
// operator sees the actual reason rather than a generic "are you sure".
export function stockStatusDetail({ state, parts, gapCount }) {
  if (state === 'recorded') return ''
  if (state === 'none') return 'No components, crystals or packaging have been reserved or consumed for this order.'
  const bits = []
  for (const p of parts) {
    if (p.stage === 'reserved') bits.push(`${p.title}: reserved but never consumed (production-in not done)`)
    if (p.gaps.count) bits.push(`${p.title}: ${p.gaps.count} line(s) could not be reserved`)
  }
  if (!bits.length && gapCount) bits.push(`${gapCount} line(s) could not be reserved`)
  return bits.join('\n')
}
