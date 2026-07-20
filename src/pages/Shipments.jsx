import { useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, orderStatusOf } from '../shipping'
import { MapPin, FileInput, ClipboardCheck } from 'lucide-react'

// Phase 12.0 — Shipment list. Each row is an order (commercial anchor); status
// badge shows where it is in the pack/ship pipeline.
export default function Shipments() {
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')

  const filtered = orders.filter(o => {
    if (!search) return true
    const hay = `${o.customer_name} ${o.erp_pi_no} ${o.destination?.country} ${o.destination?.city}`.toLowerCase()
    return hay.includes(search.toLowerCase())
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Shipments</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {orders.length} orders</p>
        </div>
        <Link to="/shipments/new" className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-1.5">
          <FileInput size={15} /> Import PI
        </Link>
      </div>

      <input
        type="text"
        placeholder="Search by customer, PI no, destination…"
        className="input w-full mb-4"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {orders.length === 0
            ? <>No shipments yet — <Link to="/shipments/new" className="text-brand-600 hover:underline">import a proforma invoice</Link> to start.</>
            : 'No shipments match your search.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(o => {
            const st = orderStatusOf(o.status)
            const needsReconcile = (o._raw?.lines_unreconciled ?? 0) > 0
            return (
              <Link key={o.id} to={`/shipments/${o.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{o.customer_name || 'Unnamed customer'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                    {o.source === 'imported_pi' && o.erp_pi_no && <span className="text-xs text-gray-400">PI {o.erp_pi_no}</span>}
                    {needsReconcile && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <ClipboardCheck size={12} /> needs reconcile
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    <span className="font-medium text-gray-500">{o.incoterm}</span>
                    {(o.destination?.country || o.destination?.city) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} />{[o.destination.city, o.destination.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-400 ml-3">→</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
