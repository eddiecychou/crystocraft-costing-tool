import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import ImageGallery from '../components/ImageGallery'
import { COMPONENT_IMAGE_TYPES } from '../constants'
import useScrollMemory from '../hooks/useScrollMemory'

export default function ComponentDetail() {
  const { productId, componentId } = useParams()
  const navigate = useNavigate()

  const [product, setProduct]       = useState(null)
  const [component, setComponent]   = useState(null)
  const [quotes, setQuotes]         = useState([])
  const [images, setImages]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remember = useScrollMemory(`component-${productId}-${componentId}`, !loading)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'products', productId)),
      getDoc(doc(db, 'products', productId, 'components', componentId)),
    ]).then(([pSnap, cSnap]) => {
      if (pSnap.exists()) setProduct({ id: pSnap.id, ...pSnap.data() })
      if (cSnap.exists()) setComponent({ id: cSnap.id, ...cSnap.data() })
      setLoading(false)
    })
  }, [productId, componentId])

  useEffect(() => {
    const q = query(
      collection(db, 'products', productId, 'components', componentId, 'supplier_quotes'),
      orderBy('createdAt', 'desc')
    )
    return onSnapshot(q, snap => setQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [productId, componentId])

  useEffect(() => {
    const q = query(
      collection(db, 'products', productId, 'components', componentId, 'images'),
      orderBy('sort_order')
    )
    return onSnapshot(q, snap => setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [productId, componentId])

  async function handleDelete() {
    await deleteDoc(doc(db, 'products', productId, 'components', componentId))
    navigate(`/products/${productId}`)
  }

  if (loading) return <LoadingBar />
  if (!component) return <div className="p-6 text-gray-500">Component not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-1">
        <Link to="/products" className="hover:text-brand-600">Products</Link>
        {' / '}
        <Link to={`/products/${productId}`} className="hover:text-brand-600">{product?.name}</Link>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{component.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unit: {component.unit}
            {(Number(component.qty_per_product) || 1) > 1 && (
              <span className="ml-2 text-xs font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                ×{component.qty_per_product} per product
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/products/${productId}/components/${componentId}/edit`} onClick={remember} className="btn-secondary">Edit</Link>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Spec */}
          {component.spec && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Specification</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{component.spec}</p>
            </div>
          )}
        </div>

        {/* Component Images */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Images
            <span className="text-xs text-gray-400 font-normal ml-1">hover to delete ✕</span>
          </h2>
          <ImageGallery
            images={images}
            firestorePath={`products/${productId}/components/${componentId}/images`}
            storagePath={`products/${productId}/components/${componentId}/images`}
            typeOptions={COMPONENT_IMAGE_TYPES}
            downloadPrefix={product ? `${product.name} - ${component.name}` : component.name}
          />
        </div>
      </div>

      {/* Supplier Quotes */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Supplier Quotes</h2>
          <Link
            to={`/products/${productId}/components/${componentId}/quotes/new`}
            onClick={remember}
            className="btn-primary text-xs py-1.5 px-3"
          >
            + Add Quote
          </Link>
        </div>

        {quotes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No supplier quotes yet — add one to start tracking costs.
          </p>
        ) : (
          <div className="space-y-3">
            {quotes.map(q => (
              <QuoteCard
                key={q.id}
                quote={q}
                productId={productId}
                componentId={componentId}
                onNavigate={remember}
                onDeleted={deletedId => setQuotes(prev => prev.filter(x => x.id !== deletedId))}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete component "${component.name}"? All supplier quotes will also be deleted.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function QuoteCard({ quote: q, productId, componentId, onNavigate, onDeleted }) {
  const [confirmDel, setConfirmDel] = useState(false)

  async function handleDelete() {
    await deleteDoc(doc(db, 'products', productId, 'components', componentId, 'supplier_quotes', q.id))
    onDeleted(q.id)
  }

  return (
    <>
      <div className="relative group flex items-start justify-between p-4 rounded-lg border border-gray-100 hover:border-brand-200 hover:bg-brand-50 transition-colors">
        <Link
          to={`/products/${productId}/components/${componentId}/quotes/${q.id}`}
          onClick={onNavigate}
          className="flex-1 min-w-0 space-y-1"
        >
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm text-gray-900">{q.supplier_name}</p>
            {q.is_preferred && (
              <span className="badge bg-brand-100 text-brand-700">Preferred</span>
            )}
          </div>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">{q.unit_cost} {q.unit_cost_currency}</span>
            {q.moq ? ` · MOQ ${q.moq.toLocaleString()} pcs` : ''}
          </p>
          <div className="flex gap-4 text-xs text-gray-500">
            {q.sampling_lead_time_days ? <span>Sample: {q.sampling_lead_time_days}d</span> : null}
            {q.production_lead_time_days ? <span>Production: {q.production_lead_time_days}d</span> : null}
          </div>
        </Link>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <span className="text-xs text-gray-400">→</span>
          <button
            onClick={e => { e.preventDefault(); setConfirmDel(true) }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500 text-sm leading-none px-1"
            title="Delete quote"
          >✕</button>
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          title="Delete Quote"
          message={`Delete the quote from "${q.supplier_name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </>
  )
}
