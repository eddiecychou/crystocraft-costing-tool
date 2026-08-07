import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { myInvoiceLines } from '../customerOrderHistoryApi'
import { X, Receipt } from 'lucide-react'

const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtQty = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—') }
const fmtMoney = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' }

// Read-only invoice detail for a customer's OWN invoice — either the app's
// own orders/{id}/lines (already readable client-side, see firestore.rules'
// orders/{orderId} customer-scoped branch) or a JES invoice's lines (fetched
// via the customer-scoped /api/customer-order-history 'lines' action, which
// re-verifies ownership server-side). No source badge shown here — a
// customer doesn't need to know which system it lives in, same as the list
// this opens from (OrderHistoryPage.jsx).
export default function InvoiceDetailModal({ row, onClose }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const load = row.src === 'app'
      ? getDocs(collection(db, 'orders', row.id, 'lines')).then(snap =>
          snap.docs.map(d => ({
            item_code: d.data().item_code, description: d.data().description,
            qty: d.data().qty_ordered, unit_price: d.data().unit_price,
            amount: (Number(d.data().qty_ordered) || 0) * (Number(d.data().unit_price) || 0),
          }))
        )
      : myInvoiceLines(row.no)
    load.then(r => { if (alive) setLines(r) }).catch(() => { if (alive) setLines([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [row.src, row.id, row.no])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lineSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ivory-dark">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-brand-500" />
            <div>
              <p className="text-sm font-medium text-ink">{row.no}</p>
              <p className="text-xs text-ink-50">{fmtDate(row.date)}{row.currency ? ` · ${row.currency}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-30 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-ink-40 text-center py-8">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-ink-40 text-center py-8">No line detail available.</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-ivory last:border-0">
                  <div className="min-w-0">
                    <p className="text-ink truncate">{l.description || l.item_code || '—'}</p>
                    {l.item_code && l.description && <p className="text-xs text-ink-40 font-mono">{l.item_code}</p>}
                  </div>
                  <div className="text-right shrink-0 text-ink-70">
                    <span className="text-ink-40">{fmtQty(l.qty)} × {fmtMoney(l.unit_price)}</span>
                    <span className="ml-3 tabular-nums">{fmtMoney(l.amount)}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 text-sm font-medium text-ink">
                <span>Total</span>
                <span className="tabular-nums">{fmtMoney(row.amount ?? lineSum)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
