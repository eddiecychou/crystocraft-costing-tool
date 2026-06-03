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

export default function Quotes() {
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'client_quotes'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  return (
    <div className="p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Quotes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{quotes.length} quotes</p>
        </div>
        <Link to="/quotes/new" className="btn-primary">+ New Quote</Link>
      </div>

      {quotes.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-4">📋</p>
          <p>No quotes yet — create your first client quote.</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {quotes.map(q => (
            <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{q.client_name}</p>
                {q.contact_name && <p className="text-xs text-gray-500 mt-0.5">{q.contact_name}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
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
