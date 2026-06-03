import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'

const REGIONS = ['All', 'Hong Kong', 'China', 'International']

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterRegion, setFilterRegion] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'customers'), orderBy('company_name'))
    return onSnapshot(q, snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = customers.filter(c => {
    const matchSearch = !search ||
      c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.industry?.toLowerCase().includes(search.toLowerCase())
    const matchRegion = !filterRegion || c.region === filterRegion
    return matchSearch && matchRegion
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers.length} clients</p>
        </div>
        <Link to="/customers/new" className="btn-primary text-sm">+ New</Link>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        <input
          type="text"
          placeholder="Search name, contact, industry…"
          className="input flex-1 min-w-0"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={filterRegion} onChange={e => setFilterRegion(e.target.value)}>
          <option value="">All regions</option>
          {REGIONS.filter(r => r !== 'All').map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-4">🏢</p>
          <p>{customers.length === 0 ? 'No customers yet — add your first client.' : 'No results found.'}</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(c => (
            <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{c.company_name}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {[c.contact_name, c.industry, c.region].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-xs text-gray-400 ml-3 shrink-0">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
