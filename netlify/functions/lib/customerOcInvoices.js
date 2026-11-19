import { customerAppInvoiceNo } from '../../../src/domain/salesInvoiceHistory.js'
import { computeOrderTotals, normLine, orderUc } from '../../../src/shippingModel.js'
import { ocDateOnly } from '../../../src/ocTime.js'
import { orderInvoiceLines } from '../../../src/domain/orderInvoiceLines.js'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const amount = (v) =>
  (typeof v === 'number' || (typeof v === 'string' && v.trim())) && Number.isFinite(Number(v))
    ? Number(v)
    : null
const summaryFields = [
  'customer_id',
  'status',
  'erp_si_no',
  'erp_so_no',
  'invoice_allocation_id',
  'erp_pi_no',
  'uc_no',
  'currency',
  'invoice_date',
  'invoiced_at',
  'order_date',
  'accounting_total',
  'total_amount',
  'subtotal',
]
const receiptFields = [
  'order_id',
  'status',
  'before.customerId',
  'result.si_no',
  'result.invoice_id',
  'result.uc_no',
]
const notFound = () => Object.assign(Error('Original unavailable.'), { status: 404 })

// A historical receipt proves the issued invoice number, but the order's lines
// describe only its current SI. Never reconstruct a previous SI from those lines.
function candidates(record, customerId) {
  const { id, order, receipts } = record
  const current = customerAppInvoiceNo(order, customerId)
  if (!current) return []
  const rows = []
  for (const op of receipts) {
    const no = text(op.result?.si_no)
    if (
      op.status !== 'linked' ||
      op.order_id !== id ||
      op.before?.customerId !== customerId ||
      !/^SI\d{6,}$/i.test(no) ||
      !op.result.invoice_id
    )
      continue
    rows.push({ no, receipt: op, original: no === current && op.id === order.invoice_allocation_id })
  }
  if (!receipts.length && !order.invoice_allocation_id) rows.push({ no: current, original: true })
  return rows
}

export async function customerOcRows(records, customerId, ledger) {
  const entries = records.flatMap((record) =>
    candidates(record, customerId).map((entry) => ({ ...entry, record })),
  )
  const numbers = [...new Set(entries.map((e) => e.no))]
  const facts = await ledger(numbers)
  const byNo = new Map()
  for (const fact of facts) byNo.set(fact.si_no, byNo.has(fact.si_no) ? null : fact)
  const seen = new Set(),
    ambiguous = new Set()
  for (const { no } of entries) {
    if (seen.has(no)) ambiguous.add(no)
    seen.add(no)
  }
  return entries.flatMap(({ no, receipt, original, record: { id, order } }) => {
    const fact = byNo.get(no)
    if (
      ambiguous.has(no) ||
      (byNo.has(no) &&
        (!fact ||
          fact.status !== 'issued' ||
          fact.order_id !== id ||
          (fact.uc_registry?.customer_id && fact.uc_registry.customer_id !== customerId))) ||
      (receipt && (!fact || String(fact.id) !== String(receipt.result.invoice_id)))
    )
      return []
    return [
      {
        id,
        no,
        original,
        date: ocDateOnly(
          fact?.invoice_date ||
            fact?.invoiced_at ||
            (original && (order.invoice_date || order.invoiced_at || order.order_date)),
        ),
        uc: text(fact?.uc_no || receipt?.result?.uc_no || (original && orderUc(order))),
        currency: text(fact?.currency || (original && order.currency)),
        amount: amount(
          fact?.accounting_total ??
            fact?.total ??
            (original ? (order.accounting_total ?? order.total_amount ?? order.subtotal) : null),
        ),
      },
    ]
  })
}

export function customerOcDocument(order, lines, no, customerId) {
  if (!no || customerAppInvoiceNo(order, customerId) !== no) throw notFound()
  const normalized = lines
    .map((l) => ({ id: l.id, ...normLine(l) }))
    .sort((a, b) => (a.line_no ?? Infinity) - (b.line_no ?? Infinity) || a.id.localeCompare(b.id))
  return {
    header: {
      no,
      uc: text(orderUc(order)),
      date: ocDateOnly(order.invoice_date || order.invoiced_at || order.order_date),
      currency: text(order.currency) || 'USD',
      customer_po: text(order.customer_po),
      deposit_paid: amount(order.deposit_paid),
      accounting_total: amount(order.accounting_total),
    },
    lines: orderInvoiceLines(normalized),
    totals: computeOrderTotals(order, normalized),
  }
}

const recordsOf = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }))
export function customerOcSource(db, ledger) {
  const orders = db.collection('orders')
  return {
    async history(customerId) {
      const snap = await orders
        .where('customer_id', '==', customerId)
        .select(...summaryFields)
        .get()
      const owned = snap.docs.filter((d) => customerAppInvoiceNo(d.data(), customerId))
      const records = []
      for (let i = 0; i < owned.length; i += 20) {
        records.push(
          ...(await Promise.all(
            owned.slice(i, i + 20).map(async (d) => ({
              id: d.id,
              order: d.data(),
              receipts: recordsOf(
                await d.ref
                  .collection('invoice_allocations')
                  .select(...receiptFields)
                  .get(),
              ),
            })),
          )),
        )
      }
      return customerOcRows(records, customerId, ledger)
    },
    async detail(customerId, id, no) {
      const ref = orders.doc(id)
      return db.runTransaction(
        async (tx) => {
          const order = (await tx.get(ref)).data()
          if (!no || customerAppInvoiceNo(order, customerId) !== no) throw notFound()
          const receipts = recordsOf(
            await tx.get(ref.collection('invoice_allocations').select(...receiptFields)),
          )
          const records = [{ id, order, receipts }]
          const rows = await customerOcRows(records, customerId, ledger)
          if (!rows.some((r) => r.no === no && r.original)) throw notFound()
          const snap = await tx.get(
            ref
              .collection('lines')
              .select(
                'line_no',
                'item_code',
                'description',
                'tier_remarks',
                'qty_ordered',
                'unit',
                'unit_price',
              ),
          )
          return customerOcDocument(order, recordsOf(snap), no, customerId)
        },
        { readOnly: true },
      )
    },
  }
}
