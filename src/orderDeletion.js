// Check the saved order, before normalisation can turn unknown statuses into drafts.
const stockFlags = ['components', 'crystals', 'packaging'].flatMap(kind =>
  ['reserved', 'committed', 'issued'].map(stage => `${kind}_${stage}`))
const stockHistory = [
  'component_lines', 'crystal_lines', 'packaging_lines', 'issued_lines',
  'crystal_issued_lines', 'packaging_issued_lines', 'component_gaps',
  ...stockFlags.map(flag => `${flag}_at`),
  ...['components', 'crystals', 'packaging'].map(kind => `${kind}_reserved_generation`),
]
const present = value => Array.isArray(value) ? value.length > 0 : Boolean(value)

export function orderDeletionBlock(order) {
  if ((order.status ?? 'draft') !== 'draft') return 'Only draft orders can be permanently deleted.'
  if (order.stock_activity || order.stock_reserved || order.metal_reserved || stockFlags.some(field => order[field]) ||
      stockHistory.some(field => present(order[field]))) {
    return 'This order has stock activity. Keep it for stock and production history.'
  }
  if ((order.source && order.source !== 'manual') || [
    'quote_conversion_id', 'client_quote_id', 'source_file', 'channel', 'woo_order_id', 'woo_order_no',
    'erp_pi_no', 'erp_so_no', 'erp_si_no', 'uc_no', 'invoice_allocation_id', 'invoiced_at',
    'invoice_date', 'customer_po', 'deposit_paid', 'no_invoice_reason', 'no_invoice_at', 'pi_revision',
  ].some(field => present(order[field]))) {
    return 'This draft has document or financial history. Keep it for reference.'
  }
  return ''
}
