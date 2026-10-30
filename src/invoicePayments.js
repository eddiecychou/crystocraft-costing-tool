import { numOrNull } from './domain/validation'

// A deposit settles part of the invoice; it never reduces sales/discounts or
// the accounting value exported to PBIS. Derive the balance from that value.
export function invoicePaymentTotals(order, calculatedTotal) {
  const invoiceTotal = numOrNull(order?.accounting_total) ?? calculatedTotal
  const depositPaid = numOrNull(order?.deposit_paid) ?? 0
  return {
    invoiceTotal,
    depositPaid,
    outstanding: Math.round((invoiceTotal - depositPaid) * 100) / 100,
  }
}

export function invoiceDepositError(order, calculatedTotal) {
  const value = order?.deposit_paid
  if (value === '' || value == null) return ''
  const deposit = numOrNull(value)
  if (deposit == null || deposit < 0) return 'Deposit paid must be a valid amount of zero or more.'
  if (deposit > invoicePaymentTotals(order, calculatedTotal).invoiceTotal)
    return 'Deposit paid cannot exceed the invoice total.'
  return ''
}
