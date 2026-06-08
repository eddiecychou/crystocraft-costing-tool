import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import UploadQuoteModal from '../components/UploadQuoteModal'

const STATUS_STYLES = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  lost:      'bg-red-100 text-red-600',
  // legacy
  won:       'bg-green-100 text-green-700',
}

function quoteDate(q) {
  if (q.quote_date) return new Date(q.quote_date)
  if (q.createdAt?.toDate) return q.createdAt.toDate()
  return new Date(0)
}

function formatDate(q) {
  return quoteDate(q).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtAmount(q) {
  if (!q.amount) return null
  return new Intl.NumberFormat('en-HK', { maximumFractionDigits: 0 }).format(q.amount)
}

export default function Quotes() {
  const navigate = useNavigate()
  const [quotes, setQuotes]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'client_quotes'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Client Quotes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {quotes.length} quotes</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={() => setShowUploadModal(true)}
            className="btn-secondary text-sm flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            📎 Upload
          </button>
          <Link to="/quotes/new" className="btn-primary text-sm whitespace-nowrap text-center">+ New Quote</Link>
        </div>
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
          <option value="confirmed">Confirmed</option>
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
            <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 text-sm truncate">{q.client_name}</p>
                  {q.quote_type === 'uploaded' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium shrink-0">📎 Uploaded</span>
                  )}
                </div>
                {q.contact_name && <p className="text-xs text-gray-500 mt-0.5">{q.contact_name}</p>}
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(q)}
                  {q.quote_type !== 'uploaded' && q.item_count ? ` · ${q.item_count} item${q.item_count > 1 ? 's' : ''}` : ''}
                  {q.quote_type === 'uploaded' && q.attachments?.length ? ` · ${q.attachments.length} file${q.attachments.length > 1 ? 's' : ''}` : ''}
                  {q.amount ? ` · ${q.quote_currency || 'HKD'} ${fmtAmount(q)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className={`badge ${STATUS_STYLES[q.status] || STATUS_STYLES.draft} capitalize`}>{q.status || 'draft'}</span>
                <span className="text-xs text-gray-400">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showUploadModal && (
        <UploadQuoteModal
          onClose={() => setShowUploadModal(false)}
          onCreated={id => navigate(`/quotes/${id}`)}
        />
      )}
    </div>
  )
}
