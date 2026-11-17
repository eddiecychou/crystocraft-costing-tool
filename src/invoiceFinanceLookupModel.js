import { validInvoiceOperationId } from './invoiceRecoveryModel.js'

export const validOcSi = value => typeof value === 'string' && /^SI\d{6,38}$/.test(value)

export function financeLookupTarget(value) {
  const input = value.trim()
  if (validOcSi(input.toUpperCase())) return { si: input.toUpperCase() }
  if (validInvoiceOperationId(input.toLowerCase())) return { requestId: input.toLowerCase() }
  return null
}

export const invoiceFinanceStatus = {
  linked: 'Linked invoice verified.',
  ledger_void: 'Exact invoice verified. The ledger marks it void.',
  awaiting_link: 'Issued receipt verified. Order link pending.',
  order_missing: 'Order missing. Finance review needed.',
  order_closed: 'Order closed. Finance review needed.',
  request_missing: 'Issued receipt verified. Saved Shipping request missing.',
  request_replaced: 'A different invoice request is current. Finance review needed.',
  references_changed: 'Order ownership or references need Finance review.',
  receipt_conflict: 'Receipt evidence conflicts. Finance review needed.',
  ledger_conflict: 'Ledger and receipt evidence conflict. Finance review needed.',
  ledger_missing: 'Receipt found. No matching OC ledger invoice found.',
  ledger_only: 'Exact ledger invoice found. If you have the saved request ID, use it to check the receipt.',
  no_receipt: 'No issued receipt found for this request ID.',
  not_found: 'No matching OC ledger invoice or current saved request found.',
}

export const invoicePurposeLabel = { first: 'First invoice', split: 'Split invoice', reissue: 'Reissued invoice' }
