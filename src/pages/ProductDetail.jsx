import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import ImageGallery from '../components/ImageGallery'
import { IMAGE_TYPES } from '../constants'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct]       = useState(null)
  const [components, setComponents] = useState([])
  const [images, setImages]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'products', id)).then(snap => {
      if (snap.exists()) setProduct({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'products', id, 'components'), orderBy('sort_order'))
    return onSnapshot(q, snap => setComponents(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id])

  useEffect(() => {
    const q = query(collection(db, 'products', id, 'images'), orderBy('sort_order'))
    return onSnapshot(q, snap => setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id])

  async function handleHeroChange(url) {
    await updateDoc(doc(db, 'products', id), { heroImage: url })
    setProduct(p => ({ ...p, heroImage: url }))
  }

  async function handleDelete() {
    await deleteDoc(doc(db, 'products', id))
    navigate('/products')
  }

  if (loading) return <LoadingBar />
  if (!product) return <div className="p-6 text-gray-500">Product not found.</div>

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link to="/products" className="text-sm text-brand-600 hover:underline">← Products</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{product.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`badge-${product.status}`}>{product.status}</span>
            <span className="text-sm text-gray-500">{product.category}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/products/${id}/edit`} className="btn-secondary">Edit</Link>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details */}
        <div className="lg:col-span-2 space-y-4">
          {product.description && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Description</h2>
              <p className="text-sm text-gray-600">{product.description}</p>
            </div>
          )}

          {product.assembly_notes && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Assembly Notes</h2>
              <p className="text-sm text-gray-600">{product.assembly_notes}</p>
            </div>
          )}

          {/* Components / BOM */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Bill of Materials</h2>
              <Link to={`/products/${id}/components/new`} className="btn-secondary text-xs py-1 px-3">+ Add Component</Link>
            </div>
            {components.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No components yet — add the parts that make up this product.</p>
            ) : (
              <div className="space-y-2">
                {components.map(c => (
                  <Link
                    key={c.id}
                    to={`/products/${id}/components/${c.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-brand-200 hover:bg-brand-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{c.name}</p>
                      {c.spec && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.spec}</p>}
                    </div>
                    <span className="text-xs text-gray-400">→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Pricing Tiers placeholder */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Pricing Tiers</h2>
              <Link to={`/products/${id}/pricing`} className="btn-secondary text-xs py-1 px-3">Manage Pricing</Link>
            </div>
            <p className="text-sm text-gray-400 text-center py-2">Set up components and suppliers first, then add pricing tiers.</p>
          </div>
        </div>

        {/* Right: images */}
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Images
              <span className="text-xs text-gray-400 font-normal ml-2">hover image to set hero ⭐ or delete ✕</span>
            </h2>
            <ImageGallery
              images={images}
              firestorePath={`products/${id}/images`}
              storagePath={`products/${id}/images`}
              typeOptions={IMAGE_TYPES}
              onHeroChange={handleHeroChange}
            />
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${product.name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
