import { useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, orderStatusOf } from '../shipping'
import { useVendors, FREIGHT_MODES, modeLabel, strengthOf } from '../logistics'
import { MapPin, FileInput, ClipboardCheck, MessageCircle, Star, Truck } from 'lucide-react'
import ComponentRequirements from './ComponentRequirements'

const TABS = [
  { v: 'shipments', label: 'Shipments' },
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
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')

  const filtered = orders.filter(o => {
    if (!search) return true
    const hay = `${o.customer_name} ${o.erp_pi_no} ${o.erp_so_no} ${o.destination?.country} ${o.destination?.city}`.toLowerCase()
    return hay.includes(search.toLowerCase())
  })

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

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {orders.length === 0
            ? <><Link to="/shipments/new" className="text-brand-600 hover:underline">Import a proforma invoice</Link> to get started.</>
            : 'No shipments match your search.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(o => {
            const st = orderStatusOf(o.status)
            const needsReconcile = (o._raw?.lines_unreconciled ?? 0) > 0
            return (
              <Link key={o.id} to={`/shipments/${o.id}`}
                className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{o.customer_name || 'Unnamed customer'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                    {o.erp_pi_no && <span className="text-xs text-gray-400">PI {o.erp_pi_no}</span>}
                    {o.erp_so_no && <span className="text-xs text-gray-400">SO {o.erp_so_no}</span>}
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
