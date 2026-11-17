import { invoiceResult, sameInvoiceValue } from '../../../src/invoiceRecoveryModel.js'

export class InvoiceReceiptConflict extends Error {}

// A successful empty response is evidence of absence. A failed read or a
// response inconsistent with the saved request cannot establish absence.
export async function readInvoiceReceiptStatus(operation, lookup) {
  let receipt
  try {
    receipt = await lookup(operation.id)
  } catch (error) {
    return { status: error instanceof InvoiceReceiptConflict ? 'conflict' : 'unavailable' }
  }
  if (receipt === null) return { status: operation.result ? 'conflict' : 'not_found' }

  let result
  try {
    result = invoiceResult(receipt, operation)
  } catch {
    return { status: 'conflict' }
  }
  if (operation.result && !sameInvoiceValue(result, operation.result)) return { status: 'conflict' }
  return { status: 'verified', result }
}
