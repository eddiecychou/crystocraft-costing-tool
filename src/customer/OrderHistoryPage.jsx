import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { myOrderHistory } from '../customerOrderHistoryApi'
import { ClipboardList, Receipt } from 'lucide-react'

const STATUS_STYLE = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  shipped: 'bg-amber-100 text-amber-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// "My Orders" — owner, 2026-08-07: "let customers be able to see their order
// history on portal." Two sources, shown as separate sections rather than
// merged into one list (their shapes and what they mean genuinely differ):
//  - Orders: this app's own orders/ collection (customer_id-scoped Firestore
//    rule — see firestore.rules), the live/current production pipeline.
//  - ERP history: legacy JES sales invoices + orders ("PI"), fetched via the
//    customer-scoped /api/customer-order-history edge function (never the
//    admin-only /api/erp — see that function's header comment for why).
//    Some accounts' ERP code is a shared JES "bucket" code (not unique to
//    them); `shared: true` from that endpoint means history genuinely can't
//    be attributed to just this customer, so it's explained, not just empty.
export default function OrderHistoryPage({ profile }) {
  const customerId = profile?.customer_id || null
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [erpRows, setErpRows] = useState([])
  const [erpShared, setErpShared] = useState(false)
  const [erpLoading, setErpLoading] = useState(true)

  useEffect(() => {
    if (!customerId) { setOrders([]); setOrdersLoading(false); return }
    let alive = true
    setOrdersLoading(true)
    getDocs(query(collection(db, 'orders'), where('customer_id', '==', customerId)))
      .then(snap => {
        if (!alive) return
        setOrders(
          snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))
        )
      })
      .catch(() => { if (alive) setOrders([]) })
      .finally(() => { if (alive) setOrdersLoading(false) })
    return () => { alive = false }
  }, [customerId])

  useEffect(() => {
    let alive = true
    setErpLoading(true)
    myOrderHistory()
      .then(({ rows, shared }) => { if (alive) { setErpRows(rows); setErpShared(shared) } })
      .finally(() => { if (alive) setErpLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={20} className="text-brand-500" />
        <h1 className="text-lg font-semibold text-ink">My Orders</h1>
      </div>
      <p className="text-sm text-ink-60 mb-5">Your order and invoice history with Crystocraft.</p>

      <div className="mb-8">
        <h2 className="text-sm font-semibold text-ink-70 mb-3">Orders</h2>
        {ordersLoading ? (
          <p className="text-sm text-ink-40 py-6 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-ivory-dark p-6 text-center text-sm text-ink-60">
            No orders yet.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-ivory-dark divide-y divide-ivory-dark">
            {orders.map(o => {
              const piNo = o.uc_no || o.erp_pi_no || o.erp_so_no || '—'
              return (
                <div key={o.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{piNo}</p>
                    <p className="text-xs text-ink-50 mt-0.5">{fmtDate(o.order_date)}{o.currency ? ` · ${o.currency}` : ''}</p>
                  </div>
                  <span className={`badge shrink-0 ${STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status || 'draft'}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-ink-70 mb-3">Invoice history</h2>
        {erpLoading ? (
          <p className="text-sm text-ink-40 py-6 text-center">Loading…</p>
        ) : erpShared ? (
          <div className="bg-white rounded-xl border border-ivory-dark p-6 text-center text-sm text-ink-60">
            Your invoice history isn't linked to an individual account yet — contact us if you'd like a copy of a past invoice.
          </div>
        ) : erpRows.length === 0 ? (
          <div className="bg-white rounded-xl border border-ivory-dark p-6 text-center text-sm text-ink-60">
            No invoice history on file yet.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-ivory-dark divide-y divide-ivory-dark">
            {erpRows.map((r, i) => (
              <div key={`${r.kind}-${r.code}-${i}`} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Receipt size={14} className="text-ink-30 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-ivory text-ink-50 mr-1.5">{r.kind}</span>
                      {r.code}
                    </p>
                    <p className="text-xs text-ink-50 mt-0.5">{fmtDate(r.date)}{r.currency ? ` · ${r.currency}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {r.amount != null && <span className="text-sm text-ink-70 tabular-nums">{Number(r.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                  <span className="badge bg-gray-100 text-gray-600">{r.status || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
