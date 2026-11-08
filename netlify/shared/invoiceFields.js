// Same normalization/validation for normal saves and durable allocation follow-ups.
export function invoiceWriteRow(body, email, now = new Date()) {
  const si = String(body.si_no ?? '').trim()
  if (!/^SI\d{6,}$/.test(si))
    return { error: 'Bad invoice number', status: 400 }
  // Phase A fields. accounting_total defaults to total when not given, so
  // existing callers (that don't know about it yet) don't leave it null next
  // to a real total. adjustment is derived here rather than trusted from the
  // client — it must always equal accounting_total − total.
  const total = Number.isFinite(Number(body.total)) ? Number(body.total) : null
  const hasAccTotal =
    body.accounting_total !== undefined &&
    body.accounting_total !== null &&
    body.accounting_total !== ''
  const accountingTotal =
    hasAccTotal && Number.isFinite(Number(body.accounting_total))
      ? Number(body.accounting_total)
      : total
  const adjustment =
    accountingTotal != null && total != null
      ? Math.round((accountingTotal - total) * 100) / 100
      : null
  const adjustmentReason = String(body.adjustment_reason ?? '')
    .trim()
    .slice(0, 500)
  // No silent overwrite (SR-05): a nonzero gap between the calculated and
  // accounting totals must carry a reason, checked server-side too — the UI
  // check in ShipmentForm is not the only gate on this rule.
  if (adjustment && Math.abs(adjustment) > 0.005 && !adjustmentReason) {
    return {
      error: 'Adjustment reason required',
      detail:
        'accounting_total differs from total but no adjustment_reason was given',
      status: 400
    }
  }
  const row = {
    si_no: si,
    year: si.slice(2, 4),
    uc_no: body.uc_no ? String(body.uc_no).slice(0, 64) : null,
    order_id: body.order_id ? String(body.order_id).slice(0, 64) : null,
    customer: String(body.customer ?? '').slice(0, 200),
    currency: String(body.currency ?? '').slice(0, 8),
    total,
    invoiced_at: /^\d{4}-\d{2}-\d{2}$/.test(String(body.invoiced_at ?? ''))
      ? body.invoiced_at
      : null,
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.invoice_date ?? ''))
      ? body.invoice_date
      : null,
    customer_po: String(body.customer_po ?? '').slice(0, 200),
    remarks: String(body.remarks ?? '').slice(0, 4000),
    accounting_total: accountingTotal,
    adjustment,
    adjustment_reason: adjustmentReason,
    // WooCommerce B2C sync (docs/specs/WooCommerce_B2C_Sync_Spec.md Phase 3) — cross-
    // reference only, never used as a key; si_no stays in the app's own
    // series regardless of channel (see app_sales_invoice.sql's header).
    channel: body.channel ? String(body.channel).slice(0, 40) : null,
    external_order_no: body.external_order_no
      ? String(body.external_order_no).slice(0, 100)
      : null,
    updated_at: now.toISOString(),
    updated_by: email
  }
  return { row }
}
