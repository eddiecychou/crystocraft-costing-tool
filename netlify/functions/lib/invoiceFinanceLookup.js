import { validOcSi } from '../../../src/invoiceFinanceLookupModel.js'
import { invoiceLinkOwnershipIssue, invoiceLinkedReferences, invoiceReferenceValues,
  sameInvoiceValue, validInvoiceOperationId, validInvoiceOrderId } from '../../../src/invoiceRecoveryModel.js'
import { InvoiceReceiptConflict, readInvoiceReceiptStatus } from './invoiceReceiptStatus.js'

const numericIdentity = value => ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value))
class InvoiceLedgerConflict extends Error {}
const orderFields = ['invoice_allocation_id', 'shipping_closed', 'customer_id', 'customer_name', 'currency',
  'erp_si_no', 'erp_so_no', 'erp_pi_no', 'uc_no', 'invoiced_at']

function validReceipt(receipt, requestId) {
  return receipt.operation_id === requestId && validInvoiceOrderId(receipt.order_id) &&
    receipt.request_json?.order_id === receipt.order_id && validOcSi(receipt.o_si_no) &&
    typeof receipt.o_uc_no === 'string' && Boolean(receipt.o_uc_no.trim()) && numericIdentity(receipt.o_invoice_id)
}

function ledgerIdentity(ledger, si) {
  if (ledger.si_no !== si || !numericIdentity(ledger.id) || !['issued', 'void'].includes(ledger.status))
    throw new InvoiceLedgerConflict('Invalid exact ledger response')
  return { si, ledgerId: String(ledger.id), ledgerStatus: ledger.status,
    ...(validInvoiceOrderId(ledger.order_id) ? { orderId: ledger.order_id } : {}) }
}

function linkStatus(order, operation, result) {
  if (!order) return 'order_missing'
  if (operation.status === 'linked') return 'linked'
  if (order.shipping_closed) return 'order_closed'
  if (order.invoice_allocation_id !== operation.id) return 'request_replaced'
  const refs = invoiceReferenceValues(order)
  if (operation.status === 'review_required' || invoiceLinkOwnershipIssue(order, operation) ||
    (!sameInvoiceValue(refs, operation.before?.refs) && !sameInvoiceValue(refs, invoiceLinkedReferences(order, operation, result))))
    return 'references_changed'
  return 'awaiting_link'
}

async function inspect(identity, order, saved, receipt, ledger) {
  if (saved?.exists && (saved.id !== identity.requestId || saved.get('id') !== identity.requestId ||
    !['pending','allocated','review_required','linked'].includes(saved.get('status')) ||
    saved.get('order_id') !== identity.orderId || saved.get('request.order_id') !== identity.orderId))
    return { ...identity, status:'receipt_conflict' }
  if (!receipt) {
    if (saved?.get('result')) return { ...identity, status:'receipt_conflict' }
    return { ...identity, status:ledger ? 'ledger_only' : saved?.exists ? 'no_receipt' : 'not_found' }
  }
  if (!validReceipt(receipt, identity.requestId)) return { ...identity, status:'receipt_conflict' }
  if (!ledger) return { ...identity, status:'ledger_missing' }
  if (receipt.o_si_no !== ledger.si_no || String(receipt.o_invoice_id) !== String(ledger.id) ||
    receipt.order_id !== ledger.order_id || receipt.o_uc_no !== ledger.uc_no ||
    String(receipt.o_uc_id ?? '') !== String(ledger.uc_id ?? ''))
    return { ...identity, status:'ledger_conflict' }
  const verified = { ...identity, uc:receipt.o_uc_no,
    ...(['first','split','reissue'].includes(receipt.request_json.purpose) ? { purpose:receipt.request_json.purpose } : {}) }
  const status = ledger.status === 'void' ? 'ledger_void' : 'request_missing'
  if (!saved?.exists) return { ...verified, status }
  const operation = saved.data()
  const compared = await readInvoiceReceiptStatus(operation, async () => receipt)
  return compared.status === 'verified'
    ? { ...verified, status:ledger.status === 'void' ? status : linkStatus(order, operation, compared.result) }
    : { ...identity, status:'receipt_conflict' }
}

function orderRecord(snapshot) {
  return snapshot.exists ? { ...snapshot.data(), id:snapshot.id } : null
}

async function exactLedger(sql, si) {
  const rows = await sql.readLedgerMatches(si)
  if (rows.length > 1 || (rows.length === 1 && (!rows[0] || typeof rows[0] !== 'object')))
    throw new InvoiceLedgerConflict('Ambiguous exact ledger response')
  return rows[0] ?? null
}

export async function readInvoiceFinanceLookup(db, sql, target) {
  let identity = target
  try {
    if (target.requestId) {
      const requestId = target.requestId
      const receipt = await sql.lookup(requestId)
      if (!receipt) {
        const { docs } = await db.collection('orders').where('invoice_allocation_id', '==', requestId).select().limit(2).get()
        if (docs.length > 1) return { ...identity, status:'receipt_conflict' }
        if (!docs.length) return { ...identity, status:'no_receipt' }
        identity = { ...identity, orderId:docs[0].id }
        const saved = await docs[0].ref.collection('invoice_allocations').doc(requestId).get()
        return inspect(identity, null, saved, null, null)
      }
      if (!validReceipt(receipt, requestId)) return { ...identity, status:'receipt_conflict' }
      identity = { ...identity, orderId:receipt.order_id }
      const ref = db.doc(`orders/${receipt.order_id}`)
      const [ledger, [header, saved]] = await Promise.all([exactLedger(sql, receipt.o_si_no),
        db.getAll(ref, ref.collection('invoice_allocations').doc(requestId))])
      const ledgerView = ledger ? ledgerIdentity(ledger, receipt.o_si_no) : {}
      // Keep the request's order distinct if ledger evidence points elsewhere.
      return inspect({ ...ledgerView, ...identity }, orderRecord(header), saved, receipt, ledger)
    }

    const ledger = await exactLedger(sql, target.si)
    if (!ledger) return { ...identity, status:'not_found' }
    identity = ledgerIdentity(ledger, target.si)
    if (!identity.orderId) return { ...identity, status:'ledger_only' }
    const ref = db.doc(`orders/${identity.orderId}`)
    const allocations = ref.collection('invoice_allocations')
    const [[header], { docs }] = await Promise.all([db.getAll(ref, { fieldMask:orderFields }),
      allocations.where('result.si_no', '==', target.si).limit(2).get()])
    if (docs.length > 1) return { ...identity, status:'receipt_conflict' }
    const order = orderRecord(header)
    const pointer = order?.invoice_allocation_id
    const saved = docs[0]
    // The current request may lack a stored result after a lost response or deletion.
    if (!saved && validInvoiceOperationId(pointer)) {
      const current = await allocations.doc(pointer).get()
      if (!current.get('result')) {
        const receipt = await sql.lookup(pointer)
        if (receipt?.o_si_no === target.si)
          return inspect({ ...identity, requestId:pointer }, order, current, receipt, ledger)
      }
    }
    if (!saved) return { ...identity, status:'ledger_only' }
    if (!validInvoiceOperationId(saved.id)) return { ...identity, status:'receipt_conflict' }
    identity = { ...identity, requestId:saved.id }
    return inspect(identity, order, saved, await sql.lookup(saved.id), ledger)
  } catch (error) {
    if (error instanceof InvoiceLedgerConflict) return { ...identity, status:'ledger_conflict' }
    if (error instanceof InvoiceReceiptConflict) return { ...identity, status:'receipt_conflict' }
    throw error
  }
}
