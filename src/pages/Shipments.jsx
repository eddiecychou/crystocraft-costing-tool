import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, orderStatusOf, getOrder, getOrderLines, createOrderWithLines } from '../shipping'
import { allocateOrderUc } from '../ucRegistry'
import { MapPin, FileInput, ClipboardCheck, Copy } from 'lucide-react'

// Phase 12.0 — Shipment list. Each row is an order (commercial anchor); status
// badge shows where it is in the pack/ship pipeline.
export default function Shipments() {
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [dupError, setDupError] = useState('')

  // "Duplicate" — matches how CuiLing actually works in JES: copy a repeat
  // customer's previous order rather than re-entering their details, then edit
  // the product codes. The one thing this deliberately does NOT copy is the
  // UC# — a carried-over UC is the exact, repeatable slip that workflow
  // produces there (confirmed against the registry: UC4657 duplicated onto
  // SI240240, which then had no registry row of its own). A fresh UC is
  // allocated instead. Everything else — customer, currency, incoterm,
  // destination, lines — copies through, same as her habit.
  async function handleDuplicate(o) {
    if (duplicatingId) return
    setDuplicatingId(o.id); setDupError('')
    try {
      const [src, lines] = await Promise.all([getOrder(o.id), getOrderLines(o.id)])
      if (!src) throw new Error('Order not found.')
      const uc = await allocateOrderUc({ customer_name: src.customer_name, currency: src.currency })
      const newOrderData = {
        source: 'duplicated',
        customer_id: src.customer_id, customer_name: src.customer_name,
        currency: src.currency, incoterm: src.incoterm,
        destination: src.destination, notes: src.notes,
        uc_no: uc.full,
        // JES references and totals belong to the source document, not the
        // copy — order_date resets too, since a duplicate is naturally today's.
        erp_pi_no: '', erp_so_no: '', order_date: '', status: 'draft',
        subtotal: null, discount_pct: null, discount_amount: null, total_amount: null,
      }
      const newLines = lines.map((l, i) => ({ ...l, line_no: i + 1 }))
      const { id: newId, commit } = createOrderWithLines(newOrderData, newLines)
      await commit
      navigate(`/shipments/${newId}`)
    } catch (err) {
      setDupError(err.message || 'Could not duplicate this order.')
      setDuplicatingId(null)
    }
  }

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
      {dupError && <p className="text-sm text-red-600 mb-3">{dupError}</p>}

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
              <div key={o.id} className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
                <Link to={`/shipments/${o.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{o.customer_name || 'Unnamed customer'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                    {o.source === 'imported_pi' && o.erp_pi_no && <span className="text-xs text-gray-400">PI {o.erp_pi_no}</span>}
                    {o.uc_no && <span className="text-xs text-gray-400">{o.uc_no}</span>}
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
                </Link>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button type="button" onClick={() => handleDuplicate(o)} disabled={duplicatingId === o.id}
                          title="Duplicate this order — allocates a fresh UC#"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors">
                    <Copy size={15} className={duplicatingId === o.id ? 'animate-pulse' : ''} />
                  </button>
                  <Link to={`/shipments/${o.id}`} className="text-xs text-gray-400 px-1">→</Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
