// An older OC invoice can have a verified ledger total even when its original
// lines are unavailable. Prefer an exact, confirmed JES copy in that case.
export function buyerInvoiceHistory(orders, legacy) {
  const byNumber = new Map()
  for (const r of legacy)
    byNumber.set(r.code.trim().toUpperCase(), {
      key: 'erp-' + r.code,
      href: '/shop/invoice/erp-' + encodeURIComponent(r.code),
      no: r.code,
      date: r.date,
      uc: r.ref,
      amount: r.amount,
      currency: r.currency,
    })
  for (const r of orders) {
    const number = r.no.toUpperCase()
    if (!r.original && byNumber.has(number)) continue
    byNumber.set(number, {
      ...r,
      key: JSON.stringify([r.id, r.no]),
      href: r.original
        ? '/shop/invoice/app-' + encodeURIComponent(r.id) + '?' + new URLSearchParams({ si: r.no })
        : null,
    })
  }
  return [...byNumber.values()].sort(
    (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.no.localeCompare(b.no),
  )
}
