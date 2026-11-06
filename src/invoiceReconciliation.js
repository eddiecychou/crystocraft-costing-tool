import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from './firebase'
import { savedInvoiceRegistryFields } from './shipping'

export const isFinancialInvoiceNo = value => typeof value === 'string' && /^SI\d{6,}$/.test(value) && value.length <= 64
// useOrders keeps the original snapshot alongside its display normalization.
// Only the trusted document id is supplied separately; raw fields remain facts.
export const financialOrderSource = order => order._raw ? { ...order._raw, id: order.id } : order
const blank = value => value == null || typeof value === 'string' && value.trim() === ''
const numeric = value => !blank(value) && ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value))
const amount = value => blank(value) ? null : numeric(value) ? Math.round(Number(value) * 100) / 100 : NaN
const adjustment = (total, accounting) => Math.round((Number(accounting) - Number(total)) * 100) / 100
const date = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const limits = { si_no: 64, order_id: 64, uc_no: 64, customer: 200, currency: 8, customer_po: 200, remarks: 4000, adjustment_reason: 500, channel: 40, external_order_no: 100 }
const optional = new Set(['order_id', 'uc_no', 'channel', 'external_order_no'])
const labels = { order_id: 'order link', uc_no: 'UC', customer: 'customer', currency: 'currency', total: 'total', accounting_total: 'Accounting Total', adjustment: 'adjustment', adjustment_reason: 'adjustment reason', invoiced_at: 'allocation date', invoice_date: 'invoice date', customer_po: 'customer PO', remarks: 'notes', channel: 'channel', external_order_no: 'external order number' }

// Match the existing edge's stored projection, including clipping and dates.
// This is comparison normalization; source amounts/strings are not rewritten.
export function canonicalInvoiceFinancialRecord(fields) {
  const result = {}
  for (const [key, limit] of Object.entries(limits)) {
    const text = key === 'adjustment_reason' ? String(fields[key] ?? '').trim() : String(fields[key] ?? '')
    result[key] = optional.has(key) && !text ? null : text.slice(0, limit)
  }
  for (const key of ['total', 'accounting_total', 'adjustment']) result[key] = amount(fields[key])
  for (const key of ['invoiced_at', 'invoice_date']) result[key] = blank(fields[key]) ? null : String(fields[key])
  return result
}

// Use a fresh raw server snapshot: a cached/normalized list must not invent a
// missing approved amount, currency or source field during financial recovery.
export async function getOrderForInvoiceSync(orderId) {
  const snapshot = await getDocFromServer(doc(db, 'orders', orderId))
  return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null
}

function reviewProblems(order, row, payload) {
  const problems = []
  if (!isFinancialInvoiceNo(order.erp_si_no)) problems.push('invalid invoice number')
  if (!order.id || String(order.id).length > 64) problems.push('invalid order link')
  if (!numeric(order.total_amount)) problems.push('saved Total Amount is unknown')
  if (!blank(order.accounting_total) && !numeric(order.accounting_total)) problems.push('invalid Accounting Total')
  if (!String(payload.uc_no || '').trim()) problems.push('UC is missing')
  if (!String(payload.customer || '').trim()) problems.push('customer is missing')
  if (!String(payload.currency || '').trim()) problems.push('currency is missing')
  for (const key of ['invoiced_at', 'invoice_date']) {
    if (!blank(order[key]) && (typeof order[key] !== 'string' || !date(order[key]))) problems.push(`invalid ${labels[key]}`)
  }
  if (row?.order_id && String(row.order_id) !== String(order.id)) problems.push('financial record belongs to another order')
  if (row && row.si_no !== order.erp_si_no) problems.push('financial invoice number needs review')
  if (blank(order.accounting_total)) {
    const ledgerAdjusted = numeric(row?.adjustment) && Math.abs(Number(row.adjustment)) > 0.005
      || numeric(row?.accounting_total) && (!numeric(row?.total) || Math.abs(Number(row.accounting_total) - Number(row.total)) > 0.005)
    if (ledgerAdjusted || numeric(order.adjustment) && Math.abs(Number(order.adjustment)) > 0.005) {
      problems.push('confirm the approved Accounting Total on the order')
    }
  }
  if (numeric(payload.total) && numeric(payload.accounting_total)
      && adjustment(payload.total, payload.accounting_total) !== 0 && !String(payload.adjustment_reason || '').trim()) {
    problems.push('approved adjustment needs a reason')
  }
  return problems
}

// Legacy SI values in erp_so_no stay outside this writer. No allocation or
// historical import is inferred from a display fallback.
export function invoiceReconciliation(orders, ledger) {
  const byNo = new Map(ledger.map(row => [String(row.si_no || '').trim().toUpperCase(), row]))
  return orders.filter(order => order.erp_si_no).flatMap(order => {
    const no = String(order.erp_si_no), row = byNo.get(no.trim().toUpperCase())
    const payload = savedInvoiceRegistryFields(order)
    const problems = reviewProblems(order, row, payload)
    if (problems.length) return [{ order, no, payload, repairable: false, why: `Review required: ${problems.join('; ')}`, fields: [] }]
    const expected = canonicalInvoiceFinancialRecord({ ...payload, adjustment: adjustment(payload.total, payload.accounting_total) })
    const actual = row ? canonicalInvoiceFinancialRecord(row) : null
    const fields = actual ? Object.keys(labels).filter(key => !Object.is(actual[key], expected[key])) : []
    if (actual && !fields.length) return []
    return [{ order, no, payload, repairable: true, fields, why: actual ? `${fields.map(key => labels[key]).join(', ')} differ` : 'not in the financial record' }]
  })
}
