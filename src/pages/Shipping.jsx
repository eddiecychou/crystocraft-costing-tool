import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, orderStatusOf, getOrder, getOrderLines, createOrderWithLines } from '../shipping'
import { allocateOrderUc } from '../ucRegistry'
import { useVendors, FREIGHT_MODES, modeLabel, strengthOf } from '../logistics'
import { MapPin, FileInput, ClipboardCheck, MessageCircle, Star, Truck, Copy } from 'lucide-react'
import ComponentRequirements from './ComponentRequirements'

const TABS = [
  { v: 'shipments', label: 'Orders' },
  { v: 'requirements', label: 'Requirements' },
  { v: 'logistics', label: 'Logistics' },
]

export default function Shipping() {
  const [tab, setTab] = useState('shipments')

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Production</h1>
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.v ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-60 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'shipments' && <ShipmentsList />}
      {tab === 'requirements' && <ComponentRequirements />}
      {tab === 'logistics' && <LogisticsList />}
    </div>
  )
}

function ShipmentsList() {
  const navigate = useNavigate()
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [dupError, setDupError] = useState('')

  const filtered = orders
    .filter(o => {
      if (!search) return true
      const hay = `${o.customer_name} ${o.erp_pi_no} ${o.erp_so_no} ${o.destination?.country} ${o.destination?.city}`.toLowerCase()
      return hay.includes(search.toLowerCase())
    })
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))   // newest order date first

  // "Duplicate" — matches how CuiLing actually works in JES: copy a repeat
  // customer's previous order rather than re-entering their details, then edit
  // the product codes. The one thing this deliberately does NOT copy is the
  // UC# — a carried-over UC is the exact, repeatable slip that workflow
  // produces there (confirmed against the registry: UC4657 duplicated onto
  // SI240240, which then had no registry row of its own). A fresh UC is
  // allocated instead; everything else copies through, same as her habit.
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

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{filtered.length} of {orders.length} orders</p>
        <Link to="/shipments/new" className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-1.5">
          <FileInput size={15} /> Import PI
        </Link>
      </div>

      <input type="text" placeholder="Search by customer, PI no, SO no, destination…"
        className="input w-full mb-4" value={search} onChange={e => setSearch(e.target.value)} />
      {dupError && <p className="text-sm text-red-600 mb-3">{dupError}</p>}

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {orders.length === 0
            ? <><Link to="/shipments/new" className="text-brand-600 hover:underline">Import a proforma invoice</Link> to get started.</>
            : 'No shipments match your search.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Order Date</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">PI #</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">SO #</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Currency</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Order Value</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(o => {
                const st = orderStatusOf(o.status)
                const needsReconcile = (o._raw?.lines_unreconciled ?? 0) > 0
                const value = o.total_amount ?? o.subtotal
                return (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/shipments/${o.id}`)}>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtOrderDate(o.order_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{o.erp_pi_no || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{o.erp_so_no || '—'}</td>
                    <td className="px-4 py-3 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 truncate">{o.customer_name || 'Unnamed customer'}</span>
                        {o.uc_no && <span className="text-xs text-gray-400">{o.uc_no}</span>}
                        {needsReconcile && (
                          <span title="Needs reconcile" className="inline-flex items-center text-amber-600">
                            <ClipboardCheck size={12} />
                          </span>
                        )}
                      </div>
                      {(o.destination?.country || o.destination?.city) && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <MapPin size={11} />{[o.destination.city, o.destination.country].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{o.currency}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">
                      {value != null ? fmtValue(value) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => handleDuplicate(o)} disabled={duplicatingId === o.id}
                              title="Duplicate this order — allocates a fresh UC#"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors">
                        <Copy size={14} className={duplicatingId === o.id ? 'animate-pulse' : ''} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtOrderDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtValue(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

function LogisticsList() {
  const { vendors, loading } = useVendors()
  const [search, setSearch] = useState('')
  const [mode, setMode]     = useState('')

  const filtered = vendors.filter(v => {
    const hay = `${v.name} ${v.name_cn} ${v.coverage.map(c => c.region).join(' ')}`.toLowerCase()
    return (!search || hay.includes(search.toLowerCase())) && (!mode || v.modes.includes(mode))
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{filtered.length} of {vendors.length} forwarders</p>
        <Link to="/logistics/new" className="btn-primary text-sm whitespace-nowrap">+ New Vendor</Link>
      </div>

      <input type="text" placeholder="Search by name or coverage…"
        className="input w-full mb-3" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="flex gap-2 flex-wrap mb-4">
        <button onClick={() => setMode('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!mode ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          All modes
        </button>
        {FREIGHT_MODES.map(m => {
          const count = vendors.filter(v => v.modes.includes(m.value)).length
          if (!count) return null
          return (
            <button key={m.value} onClick={() => setMode(mode === m.value ? '' : m.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${mode === m.value ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {m.label} <span className="opacity-60 ml-0.5">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {vendors.length === 0 ? 'No logistics vendors yet — add your first forwarder.' : 'No vendors match your filter.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(v => (
            <Link key={v.id} to={`/logistics/${v.id}`} className="block px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{v.name}</p>
                    {v.name_cn && <span className="text-xs text-gray-500">{v.name_cn}</span>}
                    {v.reliability_rating != null && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                        <Star size={12} className="fill-amber-400 stroke-amber-500" />{v.reliability_rating}
                      </span>
                    )}
                  </div>
                  {v.modes.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {v.modes.map(m => (
                        <span key={m} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          <Truck size={11} />{modeLabel(m)}
                        </span>
                      ))}
                    </div>
                  )}
                  {v.coverage.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {v.coverage.slice(0, 6).map((c, i) => {
                        const s = strengthOf(c.strength)
                        return (
                          <span key={i} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${s.style}`}>
                            <MapPin size={11} />{c.region}
                          </span>
                        )
                      })}
                      {v.coverage.length > 6 && <span className="text-[11px] text-gray-400 self-center">+{v.coverage.length - 6}</span>}
                    </div>
                  )}
                  {v.contacts[0] && (v.contacts[0].wechat || v.contacts[0].name) && (
                    <div className="flex gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                      {v.contacts[0].name && <span>{v.contacts[0].name}</span>}
                      {v.contacts[0].wechat && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />{v.contacts[0].wechat}</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 ml-3">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
