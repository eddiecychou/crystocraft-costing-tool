import { useEffect, useMemo, useState } from 'react'
import { Search, Database, Building2, Factory, AlertCircle } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { erpLookup } from '../erpApi'

// Column layout per entity. `key` maps to the curated view's fields.
const ENTITIES = {
  customer: {
    label: 'Customers', Icon: Building2,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
  supplier: {
    label: 'Suppliers', Icon: Factory,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
}

export default function ErpLookup() {
  const [entity, setEntity] = useState('customer')
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const cfg = ENTITIES[entity]

  // Debounced lookup on any input change.
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(async () => {
      try {
        const r = await erpLookup(entity, { q, activeOnly, limit: 50 })
        if (alive) setRows(r)
      } catch (e) {
        if (alive) { setError(e.message); setRows([]) }
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [entity, q, activeOnly])

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-teal-600" /> ERP Lookup
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Read-only search of the legacy JES ERP archive. Reflects the last data sync — not live.
        </p>
      </div>

      {/* Entity toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 mb-4">
        {Object.entries(ENTITIES).map(([key, e]) => {
          const on = entity === key
          return (
            <button
              key={key}
              onClick={() => { setEntity(key); setRows([]) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                on ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <e.Icon size={15} /> {e.label}
            </button>
          )
        })}
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${cfg.label.toLowerCase()} by code or name…`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}
                 className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
          Active only
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Results */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                {cfg.cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>
                ))}
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  {cfg.cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-top ${c.mono ? 'font-mono text-xs' : ''} ${c.grow ? '' : 'whitespace-nowrap'}`}>
                      {r[c.key] ?? <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                      r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>{r.active ? 'Active' : 'Expired'}</span>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && !error && (
                <tr><td colSpan={cfg.cols.length + 1} className="px-3 py-10 text-center text-gray-400">
                  {q ? `No ${cfg.label.toLowerCase()} match “${q}”.` : `No ${cfg.label.toLowerCase()} found.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Showing up to 50 results. Source: <span className="font-mono">JES_UnitedArt</span> → Supabase mirror.
      </p>
    </div>
  )
}
