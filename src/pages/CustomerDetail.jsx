import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [customer, setCustomer]   = useState(null)
  const [quotes, setQuotes]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'customers', id)),
      getDocs(query(collection(db, 'client_quotes'), where('customer_id', '==', id), orderBy('createdAt', 'desc'))),
    ]).then(([cSnap, qSnap]) => {
      if (cSnap.exists()) setCustomer({ id: cSnap.id, ...cSnap.data() })
      setQuotes(qSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'customers', id))
    navigate('/customers')
  }

  if (loading) return <LoadingBar />
  if (!customer) return <div className="p-4 text-gray-500">Customer not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>

      {/* Header */}
      <div className="mb-6 mt-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">{customer.company_name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {[customer.industry, customer.region].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link to={`/customers/${id}/edit`} className="btn-secondary text-sm">Edit</Link>
            <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        </div>
      </div>

      {/* Contact info */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Contact Details</h2>
        <dl className="space-y-2">
          {customer.contact_name && <Row label="Contact" value={customer.contact_name} />}
          {customer.contact_email && (
            <Row label="Email" value={<a href={`mailto:${customer.contact_email}`} className="text-brand-600 hover:underline">{customer.contact_email}</a>} />
          )}
          {customer.contact_phone && (
            <Row label="Phone" value={<a href={`tel:${customer.contact_phone}`} className="text-brand-600 hover:underline">{customer.contact_phone}</a>} />
          )}
          {customer.wechat_id && <Row label="WeChat" value={customer.wechat_id} />}
          {customer.address && <Row label="Address" value={customer.address} />}
        </dl>
      </div>

      {/* Notes */}
      {customer.notes && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Notes</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
        </div>
      )}

      {/* Quote history */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Quotes ({quotes.length})</h2>
          <Link
            to={`/quotes/new?customer_id=${id}`}
            className="btn-primary text-xs py-1.5 px-3"
          >
            + New Quote
          </Link>
        </div>
        {quotes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No quotes yet for this customer.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {quotes.map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {q.item_count ? `${q.item_count} item${q.item_count > 1 ? 's' : ''}` : 'No items'}
                    {q.quote_currency ? ` · ${q.quote_currency}` : ''}
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

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${customer.company_name}? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-20 text-gray-400 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{value}</dd>
    </div>
  )
}
