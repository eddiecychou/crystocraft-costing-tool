import { privateJson, validId } from './customerAccess.js'
import { ocDateOnly } from '../../../src/ocTime.js'
import { orderSi, orderStatusOf } from '../../../src/shippingModel.js'

const invoiceNo = value => typeof value === 'string' && /^SI\d{6,}$/i.test(value.trim())
  ? value.trim().toUpperCase() : ''
const orderNumber = order => invoiceNo(orderSi({
  erp_si_no: typeof order.erp_si_no === 'string' ? order.erp_si_no.trim() : '',
  erp_so_no: typeof order.erp_so_no === 'string' ? order.erp_so_no : '',
}))
const amount = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) &&
  Number.isFinite(Number(value)) ? Number(value) : null

function byExactNumber(records, numberOf) {
  const indexed = new Map()
  for (const record of records) {
    const number = numberOf(record)
    if (number) indexed.set(number, indexed.has(number) ? null : record)
  }
  return indexed
}

export function projectOcInvoiceSummaries(ledger, orders, allocations) {
  const ordersById = new Map(orders.map(order => [order.id, order]))
  const current = byExactNumber(orders, orderNumber)
  const receipts = byExactNumber(allocations, op => invoiceNo(op.result?.si_no))
  const ledgerBySi = byExactNumber(ledger, row => invoiceNo(row.si_no))
  const modernOrders = new Set(allocations.map(op => op.orderId))
  const rows = []
  const append = (no, status, date, customer, currency, total) => {
    rows.push({ no, date: ocDateOnly(date) || null, customer: typeof customer === 'string' ? customer : '',
      currency: typeof currency === 'string' ? currency : '', status, amount: amount(total),
      source: 'OC', documentStatus: 'Original unavailable' })
  }

  for (const [no, row] of ledgerBySi) {
    if (!row || !['issued', 'void'].includes(row.status)) continue
    const order = current.get(no)
    if (order === null || (row.order_id && order && order.id !== row.order_id)) continue
    const receipt = receipts.get(no)
    if (receipts.has(no)) {
      if (!receipt || receipt.status !== 'linked' || receipt.orderId !== row.order_id ||
          receipt.order_id !== receipt.orderId || String(receipt.result.invoice_id) !== String(row.id) ||
          (order && order.id !== receipt.orderId)) continue
    } else {
      const linkedOrder = order || ordersById.get(row.order_id)
      if (linkedOrder && (linkedOrder.invoice_allocation_id || modernOrders.has(linkedOrder.id) ||
          orderStatusOf(linkedOrder.status).value === 'draft' || orderNumber(linkedOrder) !== no)) continue
      if (!linkedOrder && row.status !== 'void' && amount(row.total) === null) continue
    }
    append(no, row.status.toUpperCase(), row.invoice_date || row.invoiced_at, row.customer, row.currency, row.total)
  }

  for (const [no, order] of current) {
    // A ledger or receipt takes precedence, including pending and conflicting entries.
    if (!order || ledgerBySi.has(no) || receipts.has(no) || order.invoice_allocation_id ||
        modernOrders.has(order.id) || orderStatusOf(order.status).value === 'draft') continue
    append(no, 'ISSUED', order.invoice_date || order.invoiced_at, order.customer_name, order.currency, order.total_amount)
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.no.localeCompare(a.no))
}

export async function readOcInvoiceLedger(base, key, fetcher = fetch) {
  if (!base || !key) throw Error('Invoice ledger is not configured')
  const signal = AbortSignal.timeout(10000)
  const rows = []
  let id = 0
  for (;;) {
    const params = new URLSearchParams({ select: 'id,si_no,order_id,invoice_date,invoiced_at,customer,currency,status,total',
      order: 'id.asc', id: `gt.${id}`, limit: '500' })
    const response = await fetcher(`${base.replace(/\/$/, '')}/rest/v1/app_sales_invoice?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', Prefer: 'count=exact' },
      signal, redirect: 'error',
    })
    if (!response.ok) throw Error('Invoice ledger unavailable')
    const batch = await response.json()
    const count = response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1]
    if (!Array.isArray(batch) || count === undefined || batch.length > Number(count) ||
        (!batch.length && Number(count) > 0)) throw Error('Incomplete invoice ledger response')
    for (const row of batch) {
      if (!Number.isSafeInteger(row?.id) || row.id <= id) throw Error('Invalid invoice cursor')
      id = row.id
      rows.push(row)
    }
    if (batch.length === Number(count)) return rows
  }
}

export async function loadOcInvoiceSources(db, loadLedger) {
  const [ledger, orders, allocations] = await Promise.all([
    loadLedger(),
    db.collection('orders').select('erp_si_no', 'erp_so_no', 'invoice_allocation_id', 'status', 'invoice_date',
      'invoiced_at', 'customer_name', 'currency', 'total_amount').get(),
    db.collectionGroup('invoice_allocations').select('status', 'result.si_no', 'result.invoice_id', 'order_id').get(),
  ])
  return {
    ledger,
    orders: orders.docs.map(doc => ({ ...doc.data(), id: doc.id })),
    allocations: allocations.docs.flatMap(doc => {
      const order = doc.ref.parent.parent
      return order?.parent.path === 'orders' ? [{ ...doc.data(), orderId: order.id }] : []
    }),
  }
}

export function createOcInvoiceSummariesHandler({ verifyToken, getProfile, load }) {
  return async req => {
    if (req.method !== 'GET') return privateJson({ error: 'Method not allowed' }, 405)
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token || token.length > 8192) return privateJson({ error: 'Please sign in.' }, 401)
    let uid
    try { uid = (await verifyToken(token)).uid } catch { return privateJson({ error: 'Please sign in again.' }, 401) }
    if (!validId(uid)) return privateJson({ error: 'Please sign in again.' }, 401)
    try {
      const profile = await getProfile(uid)
      if (profile?.role !== 'admin' && !(profile?.role === 'staff' &&
          Array.isArray(profile.modules) && profile.modules.includes('invoices'))) {
        return privateJson({ error: 'Access denied' }, 403)
      }
      const { ledger, orders, allocations } = await load()
      return privateJson({ rows: projectOcInvoiceSummaries(ledger, orders, allocations) })
    } catch {
      return privateJson({ error: 'OC invoice summaries are temporarily unavailable. Please retry.' }, 503)
    }
  }
}
