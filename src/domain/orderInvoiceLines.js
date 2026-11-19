// Customer-facing fields only. Charges have an amount but no quantity/unit.
export function orderInvoiceLines(lines) {
  return lines
    .filter(
      (l) =>
        Number(l.qty_ordered) > 0 || (Number(l.unit_price) !== 0 && Number.isFinite(Number(l.unit_price))),
    )
    .map((l) => {
      const qty = Number(l.qty_ordered) || 0
      const price = Number(l.unit_price) || 0
      return {
        item_code: l.item_code,
        description: l.description,
        tier_remarks: l.tier_remarks || '',
        qty: qty > 0 ? qty : null,
        unit: qty > 0 ? l.unit || 'pcs' : '',
        unit_price: qty > 0 ? price : null,
        amount: qty > 0 ? qty * price : price,
      }
    })
}
