import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders } from '../shipping'
import { Receipt, AlertTriangle, FileText } from 'lucide-react'

// Sales Invoices. An invoice is not a separate record here — it is an order
// that has been given an invoice number, which mirrors how CuiLing actually
// works in JES: "Load Document" builds the SI from the sales order rather than
// re-keying it. Keeping one record avoids the header/total drift that two
// records invite, and the PBIS export reads the same figures the customer sees.
//
// The list is deliberately split into invoiced and awaiting-invoice, because
// "which shipped orders have not been invoiced yet" is the question this page
// exists to answer.

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtValue = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

// Shipped or delivered but with no invoice number — the orders that owe an
// invoice. Draft and in-progress orders are not late, they are just early.
const AWAITING = new Set(['shipped', 'delivered'])

export default function SalesInvoices() {
  const navigate = useNavigate()
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')

  const { invoiced, awaiting } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (o) =>
      !q || `${o.customer_name} ${o.erp_si_no} ${o.erp_so_no} ${o.uc_no}`.toLowerCase().includes(q)
    const all = orders.filter(match)
    return {
      invoiced: all
        .filter((o) => o.erp_si_no)
        .sort((a, b) => (b.invoiced_at || b.order_date || '').localeCompare(a.invoiced_at || a.order_date || '')),
      awaiting: all
        .filter((o) => !o.erp_si_no && AWAITING.has(o.status))
        .sort((a, b) => (a.order_date || '').localeCompare(b.order_date || '')),   // oldest first — most overdue
    }
  }, [orders, search])

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Sales Invoices</h1>
      </div>

      <div className="p-4 md:p-6">
        {loading && <LoadingBar />}

        <input type="text" placeholder="Search by customer, invoice no, SO no, UC#…"
          className="input w-full mb-4" value={search} onChange={(e) => setSearch(e.target.value)} />

        {awaiting.length > 0 && (
          <div className="card mb-5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
              <AlertTriangle size={14} className="text-amber-600" />
              <p className="text-sm font-medium text-amber-800">
                {awaiting.length} order{awaiting.length === 1 ? '' : 's'} shipped without an invoice
              </p>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {awaiting.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/shipments/${o.id}`)}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(o.order_date)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-mono text-xs">{o.erp_so_no || '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{o.customer_name || 'Unnamed customer'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{o.currency}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-gray-800">
                      {fmtValue(o.total_amount ?? o.subtotal)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-amber-700">needs invoice →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-sm text-gray-500 mb-3">{invoiced.length} invoice{invoiced.length === 1 ? '' : 's'}</p>

        {invoiced.length === 0 && !loading ? (
          <div className="text-center py-16 text-gray-400">
            <Receipt size={28} className="mx-auto mb-3 opacity-40" />
            No invoices yet. Open an order and allocate an invoice number to raise one.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Invoice No</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">SO No</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">UC#</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cur</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Total</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoiced.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs font-medium text-gray-900 cursor-pointer"
                        onClick={() => navigate(`/shipments/${o.id}`)}>{o.erp_si_no}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 cursor-pointer"
                        onClick={() => navigate(`/shipments/${o.id}`)}>{fmtDate(o.invoiced_at || o.order_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">{o.erp_so_no || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">{o.uc_no || '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer"
                        onClick={() => navigate(`/shipments/${o.id}`)}>{o.customer_name || 'Unnamed customer'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{o.currency}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">
                      {fmtValue(o.total_amount ?? o.subtotal)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <Link to={`/shipments/${o.id}/invoice`} target="_blank" rel="noreferrer"
                            className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                        <FileText size={12} /> Print
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
