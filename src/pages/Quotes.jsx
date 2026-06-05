import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

function quoteDate(q) {
  if (q.quote_date) return new Date(q.quote_date)
  if (q.createdAt?.toDate) return q.createdAt.toDate()
  return new Date(0)
}

function formatDate(q) {
  return quoteDate(q).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Quotes() {
  const [quotes, setQuotes]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'client_quotes'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Sort by quote_date (newest first), fall back to createdAt
      all.sort((a, b) => quoteDate(b) - quoteDate(a))
      setQuotes(all)
      setLoading(false)
    })
  }, [])

  const filtered = quotes.filter(q => {
    const term = search.toLowerCase()
    const matchSearch = !term ||
      q.client_name?.toLowerCase().includes(term) ||
      q.contact_name?.toLowerCase().includes(term) ||
      q.contact_email?.toLowerCase().includes(term)
    const matchStatus = !statusFilter || (q.status || 'draft') === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Quotes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {quotes.length} quotes</p>
        </div>
        <Link to="/quotes/new" className="btn-primary">+ New Quote</Link>
      </div>

      {/* Search & filter bar */}
      <div className="flex gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="Search by client, contact…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-4">📋</p>
          <p>{quotes.length === 0 ? 'No quotes yet — create your first client quote.' : 'No quotes match your search.'}</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(q => (
            <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{q.client_name}</p>
                {q.contact_name && <p className="text-xs text-gray-500 mt-0.5">{q.contact_name}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {formatDate(q)}
                  {q.item_count ? ` · ${q.item_count} item${q.item_count > 1 ? 's' : ''}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${STATUS_STYLES[q.status] || STATUS_STYLES.draft}`}>{q.status || 'draft'}</span>
                <span className="text-xs text-gray-400">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
