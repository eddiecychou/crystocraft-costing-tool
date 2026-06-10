import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import SupplierCatalogs from '../components/SupplierCatalogs'
import SupplierAddQuoteModal from '../components/SupplierAddQuoteModal'
import { SUPPLIER_CATEGORIES } from '../constants'

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && typeof val === 'string') return [val]
  return []
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 break-all">{value}</span>
    </div>
  )
}

function MultiRow({ label, values, render }) {
  const arr = toArray(values)
  if (!arr.length) return null
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <div className="space-y-0.5">
        {arr.map((v, i) => <div key={i} className="text-sm text-gray-800 break-all">{render ? render(v) : v}</div>)}
      </div>
    </div>
  )
}

export default function SupplierDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [supplier, setSupplier]         = useState(null)
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [quotes, setQuotes]             = useState([])
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [showAddQuote, setShowAddQuote] = useState(false)
  const [indexError, setIndexError]     = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'suppliers', id)).then(snap => {
      if (snap.exists()) setSupplier({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  async function loadQuotes() {
    setQuotesLoading(true)
    setIndexError(false)
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'supplier_quotes'), where('supplier_id', '==', id))
      )
      // Parse productId + componentId from doc path: products/{pId}/components/{cId}/supplier_quotes/{qId}
      const raw = snap.docs.map(d => {
        const parts = d.ref.path.split('/')
        return { id: d.id, productId: parts[1], componentId: parts[3], ...d.data() }
      })
      // Fetch product + component names for each unique combo
      const productIds   = [...new Set(raw.map(r => r.productId))]
      const productNames = {}
      await Promise.all(productIds.map(pid =>
        getDoc(doc(db, 'products', pid)).then(s => { productNames[pid] = s.data()?.name || pid })
      ))
      const compKeys = [...new Set(raw.map(r => `${r.productId}::${r.componentId}`))]
      const compNames = {}
      await Promise.all(compKeys.map(key => {
        const [pid, cid] = key.split('::')
        return getDoc(doc(db, 'products', pid, 'components', cid))
          .then(s => { compNames[key] = s.data()?.name || cid })
      }))
      setQuotes(raw.map(r => ({
        ...r,
        _productName:   productNames[r.productId] || '',
        _componentName: compNames[`${r.productId}::${r.componentId}`] || '',
      })).sort((a, b) => a._productName.localeCompare(b._productName)))
    } catch (err) {
      console.error('Supplier quotes query error:', err.code, err.message)
      setIndexError(true)
    } finally {
      setQuotesLoading(false)
    }
  }

  useEffect(() => { loadQuotes() }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'suppliers', id))
    navigate('/suppliers')
  }

  if (loading) return <LoadingBar />
  if (!supplier) return <div className="p-6 text-gray-500">Supplier not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">← Suppliers</Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
            {supplier.erp_code && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{supplier.erp_code}</span>
            )}
          </div>
          {supplier.name_cn && <p className="text-gray-500 text-sm mt-0.5">{supplier.name_cn}</p>}
          {supplier.category && (() => {
            const cat = SUPPLIER_CATEGORIES.find(c => c.value === supplier.category)
            return cat ? (
              <span className="inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 font-medium">
                {cat.emoji} {supplier.category}
              </span>
            ) : null
          })()}
        </div>
        <div className="flex gap-2">
          <Link to={`/suppliers/${id}/edit`} className="btn-secondary">Edit</Link>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      <div className="card p-5 space-y-0">
        <InfoRow label="Contact Person" value={supplier.contact_person} />
        <InfoRow label="Country" value={supplier.country} />
        <InfoRow label="City / Region" value={supplier.city} />
        <InfoRow label="Address" value={supplier.address} />
        <MultiRow label="Phone" values={supplier.phones ?? supplier.phone}
          render={v => <a href={`tel:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        <InfoRow label="WeChat ID" value={supplier.wechat_id} />
        <InfoRow label="WhatsApp" value={supplier.whatsapp} />
        <MultiRow label="Email" values={supplier.emails ?? supplier.email}
          render={v => <a href={`mailto:${v}`} className="text-brand-600 hover:underline">{v}</a>} />
        {supplier.notes && (
          <div className="pt-3 mt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}
      </div>

      {/* Supplier Quotes */}
      <div className="card mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Component Quotes {!quotesLoading && <span className="text-gray-400 font-normal">({quotes.length})</span>}
          </h2>
          <button onClick={() => setShowAddQuote(true)} className="btn-primary text-xs py-1.5 px-3">
            + Add Quote
          </button>
        </div>

        {indexError && (
          <div className="p-4 text-sm text-amber-700 bg-amber-50 border-b border-amber-100">
            ⚠️ A Firestore index is needed for this query. Check the browser console for a link to create it — takes about 1 minute.
          </div>
        )}

        {quotesLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading quotes…</p>
        ) : quotes.length === 0 && !indexError ? (
          <p className="text-sm text-gray-400 text-center py-8">No component quotes linked to this supplier yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {quotes.map(q => {
              const isOrphaned = !q._productName || q._productName === q.productId
              const productLabel = isOrphaned ? (q.supplier_name || 'Unknown Product') : q._productName
              const componentLabel = (!q._componentName || q._componentName === q.componentId) ? '—' : q._componentName
              const rowClass = 'flex items-start justify-between px-5 py-3.5 gap-3 transition-colors'
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{productLabel}</p>
                      {q.is_preferred && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-medium shrink-0">⭐ Preferred</span>
                      )}
                      {isOrphaned && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 shrink-0">Product deleted</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Component: {componentLabel}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                      {q.unit_cost != null && (
                        <span className="font-medium text-gray-700">{q.unit_cost} {q.unit_cost_currency}</span>
                      )}
                      {q.moq && <span>MOQ {q.moq.toLocaleString()}</span>}
                      {q.production_lead_time_days && <span>Prod {q.production_lead_time_days}d</span>}
                      {q.sampling_lead_time_days && <span>Sample {q.sampling_lead_time_days}d</span>}
                    </div>
                    {q.notes && <p className="text-xs text-gray-400 mt-0.5 italic truncate">{q.notes}</p>}
                  </div>
                  {!isOrphaned && <span className="text-xs text-gray-400 shrink-0 mt-1">Edit →</span>}
                </>
              )
              return isOrphaned
                ? <div key={q.id} className={`${rowClass} opacity-50 cursor-default`}>{inner}</div>
                : <Link key={q.id} to={`/products/${q.productId}/components/${q.componentId}/quotes/${q.id}`} className={`${rowClass} hover:bg-gray-50`}>{inner}</Link>
            })}
          </div>
        )}
      </div>

      <SupplierCatalogs supplierId={id} />

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${supplier.name}"? This will not affect existing quotes that reference this supplier.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showAddQuote && (
        <SupplierAddQuoteModal
          supplier={supplier}
          onClose={() => setShowAddQuote(false)}
          onSaved={() => { setShowAddQuote(false); loadQuotes() }}
        />
      )}
    </div>
  )
}
