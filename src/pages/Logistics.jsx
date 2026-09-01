import { useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useVendors, FREIGHT_MODES, modeLabel, strengthOf } from '../logistics'
import { MapPin, MessageCircle, Star, Truck } from 'lucide-react'

// Phase 13.0 — Logistics vendor knowledge base. Structures the tribal WeChat /
// staff-desktop knowledge of our 50–100 forwarders into a filterable list.
export default function Logistics() {
  const { vendors, loading } = useVendors()
  const [search, setSearch]   = useState('')
  const [mode, setMode]       = useState('')

  const filtered = vendors.filter(v => {
    const hay = `${v.name} ${v.name_cn} ${v.coverage.map(c => c.region).join(' ')}`.toLowerCase()
    const matchSearch = !search || hay.includes(search.toLowerCase())
    const matchMode = !mode || v.modes.includes(mode)
    return matchSearch && matchMode
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink">Logistics Vendors</h1>
          <p className="text-sm text-ink-60 mt-0.5">{filtered.length} of {vendors.length} forwarders</p>
        </div>
        <Link to="/logistics/new" className="btn-primary text-sm whitespace-nowrap">+ New Vendor</Link>
      </div>

      <input
        type="text"
        placeholder="Search by name or coverage…"
        className="input w-full mb-3"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setMode('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!mode ? 'bg-brand-600 text-white' : 'bg-ivory-dark text-ink-70 hover:bg-warm-grey'}`}
        >
          All modes
        </button>
        {FREIGHT_MODES.map(m => {
          const count = vendors.filter(v => v.modes.includes(m.value)).length
          if (!count) return null
          return (
            <button
              key={m.value}
              onClick={() => setMode(mode === m.value ? '' : m.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${mode === m.value ? 'bg-brand-600 text-white' : 'bg-ivory-dark text-ink-70 hover:bg-warm-grey'}`}
            >
              {m.label} <span className="opacity-60 ml-0.5">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-ink-60">
          {vendors.length === 0 ? 'No logistics vendors yet — add your first forwarder.' : 'No vendors match your filter.'}
        </div>
      ) : (
        <div className="card divide-y divide-warm-grey">
          {filtered.map(v => (
            <Link
              key={v.id}
              to={`/logistics/${v.id}`}
              className="block px-4 py-3.5 hover:bg-ivory transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-ink text-sm">{v.name}</p>
                    {v.name_cn && <span className="text-xs text-ink-60">{v.name_cn}</span>}
                    {v.reliability_rating != null && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                        <Star size={12} className="fill-amber-400 stroke-amber-500" />{v.reliability_rating}
                      </span>
                    )}
                  </div>

                  {v.modes.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {v.modes.map(m => (
                        <span key={m} className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-ivory-dark text-ink-70">
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
                          <span key={i} className={`inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border ${s.style}`}>
                            <MapPin size={11} />{c.region}
                          </span>
                        )
                      })}
                      {v.coverage.length > 6 && <span className="text-2xs text-ink-60 self-center">+{v.coverage.length - 6}</span>}
                    </div>
                  )}

                  {v.contacts[0] && (v.contacts[0].wechat || v.contacts[0].name) && (
                    <div className="flex gap-3 mt-1.5 text-xs text-ink-60 flex-wrap">
                      {v.contacts[0].name && <span>{v.contacts[0].name}</span>}
                      {v.contacts[0].wechat && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />{v.contacts[0].wechat}</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs text-ink-60 ml-3">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
