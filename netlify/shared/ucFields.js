// Existing UC editable-field and numeric contract, shared without widening it.
const WRITABLE = new Set([
  'doc_date',
  'year',
  'source',
  'jes_si',
  'order_no',
  'customer',
  'customer_id',
  'currency',
  'total',
  'deposit',
  // shipping_cost and delivery_date are deliberately absent: retired from the
  // registry on 2026-07-21 (Cindy). The columns still hold their history, but
  // nothing may write them again.
  'balance',
  'bal_pay_date',
  'shipment',
  'customs',
  'confirmed',
  'pic',
  'remarks',
  'status'
])
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function cleanUcFields(data) {
  const out = {}
  for (const k of Object.keys(data || {})) if (WRITABLE.has(k)) out[k] = data[k]
  // Balance defaults to total − deposit when not given.
  if (out.balance === '' || out.balance == null)
    out.balance = Math.round((num(out.total) - num(out.deposit)) * 100) / 100
  for (const k of ['total', 'deposit', 'balance'])
    if (k in out) out[k] = num(out[k])
  out.confirmed = !!out.confirmed
  // open = outstanding/tracked, closed = paid/done, void = cancelled mistake.
  if (!['open', 'closed', 'void'].includes(out.status)) out.status = 'open'
  return out
}
