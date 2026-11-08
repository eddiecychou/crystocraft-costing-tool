// Shared pure projections for ordinary saves and durable invoice follow-ups.
export function wooRegistryAutofillFields(header) {
  return {
    source: 'Online Shop',
    customer_id: header.customer_id || null,
    order_no: header.woo_order_no || '',
    total: header.total_amount ?? null,
    deposit: header.total_amount ?? null, // paid in full at checkout — see PROJECT-PLAN.md
    balance: 0,
    bal_pay_date: header.woo_payout_date || null,
    // V8.10 — Cindy, 2026-08-24: fee/payout detail only when the
    // transaction currency isn't HKD, and the payout must read in
    // HKD (the currency that actually lands in the bank), not the
    // transaction currency — same rule and same fields as
    // wooImport.js's order-notes feeNote, just re-derived here since
    // the UC Registry remarks are built independently at allocation
    // time.
    remarks: [
      header.customer_po,
      header.woo_fee != null && header.currency !== 'HKD'
        ? `Gateway fee: ${header.currency} ${Number(header.woo_fee).toFixed(2)} · Net payout: ${header.woo_net_payout_hkd != null ? `HKD ${Number(header.woo_net_payout_hkd).toFixed(2)}` : 'HKD amount — fill in manually'}${header.woo_payout_date ? ` · Payout ${header.woo_payout_date}` : ''}`
        : null
    ]
      .filter(Boolean)
      .join(' — ')
  }
}

// Invoice registry fields sent after an existing shipment order is saved.
export function invoiceRegistryFields(
  orderId,
  header,
  computed,
  accountingTotal
) {
  const total =
    computed.subtotal > 0
      ? computed.total
      : header.pi_total !== ''
        ? parseFloat(header.pi_total)
        : null
  return invoiceRegistryProjection(
    orderId,
    header,
    total,
    total != null ? accountingTotal : null
  )
}

// Recovery uses persisted invoice facts, never a list subtotal or PI estimate.
// Validation/authority checks belong to invoiceReconciliation before any write.
export function savedInvoiceRegistryFields(order) {
  const total = order.total_amount ?? null
  const accounting =
    order.accounting_total == null ||
    (typeof order.accounting_total === 'string' &&
      order.accounting_total.trim() === '')
      ? total
      : order.accounting_total
  return invoiceRegistryProjection(
    order.id,
    { ...order, uc_no: order.uc_no || order.erp_pi_no || '' },
    total,
    accounting
  )
}

// One complete field contract for ordinary saving and explicit recovery.
function invoiceRegistryProjection(orderId, header, total, accountingTotal) {
  return {
    si_no: header.erp_si_no,
    uc_no: header.uc_no || null,
    order_id: orderId,
    customer: header.customer_name,
    currency: header.currency,
    total,
    invoiced_at: header.invoiced_at || null,
    invoice_date: header.invoice_date || null,
    customer_po: header.customer_po || '',
    remarks: header.notes || '',
    accounting_total: accountingTotal,
    adjustment_reason: header.adjustment_reason || '',
    // WooCommerce B2C sync (spec Phase 3) — cross-reference only; blank
    // for every order that isn't WooCommerce-sourced, same as before.
    channel: header.channel || null,
    external_order_no: header.woo_order_no || ''
  }
}
