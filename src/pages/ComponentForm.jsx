import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, serverTimestamp, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'

export default function ComponentForm() {
  const { productId, componentId } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(componentId)

  const [form, setForm] = useState({ name: '', spec: '', unit: 'pcs', qty_per_product: 1, notes: '' })
  const [sortOrder, setSortOrder] = useState(0)
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [product, setProduct]   = useState(null)
  const [productImages, setProductImages] = useState([])
  const [copyingImages, setCopyingImages] = useState(false)

  useEffect(() => {
    // Load product info (for "Use Product Info" button)
    getDoc(doc(db, 'products', productId)).then(s => {
      if (s.exists()) setProduct({ id: s.id, ...s.data() })
    })
    getDocs(query(collection(db, 'products', productId, 'images'), orderBy('sort_order')))
      .then(snap => setProductImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))

    if (!isEdit) {
      getDocs(query(collection(db, 'products', productId, 'components'), orderBy('sort_order', 'desc')))
        .then(snap => setSortOrder(snap.empty ? 0 : (snap.docs[0].data().sort_order ?? 0) + 1))
      return
    }
    getDoc(doc(db, 'products', productId, 'components', componentId)).then(snap => {
      if (snap.exists()) setForm(f => ({ ...f, ...snap.data() }))
      setFetching(false)
    })
  }, [productId, componentId, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  function applyProductInfo() {
    if (!product) return
    setForm(f => ({
      ...f,
      name: product.name || f.name,
      spec: [product.description, product.assembly_notes].filter(Boolean).join('\n\n') || f.spec,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      let newComponentId = componentId
      if (isEdit) {
        await updateDoc(doc(db, 'products', productId, 'components', componentId), {
          ...form, qty_per_product: Number(form.qty_per_product) || 1,
        })
      } else {
        const ref = await addDoc(collection(db, 'products', productId, 'components'), {
          ...form, qty_per_product: Number(form.qty_per_product) || 1, sort_order: sortOrder, createdAt: serverTimestamp(),
        })
        newComponentId = ref.id

        // Copy product images into new component if checkbox ticked
        if (copyingImages && productImages.length > 0) {
          await Promise.all(productImages.map(img => {
            const { id: _id, storage_path: _sp, ...imgData } = img
            return addDoc(
              collection(db, 'products', productId, 'components', newComponentId, 'images'),
              imgData
            )
          }))
        }
      }
      navigate(`/products/${productId}/components/${newComponentId}`)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="mb-6">
        <Link to={`/products/${productId}`} className="text-sm text-brand-600 hover:underline">← {product?.name || '…'}</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">{isEdit ? 'Edit Component' : 'New Component'}</h1>
      </div>

      {/* Use Product Info banner — only on new component */}
      {!isEdit && product && (
        <div className="mb-4 p-4 rounded-none border border-brand-200 bg-brand-50 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand-800">Single-component product?</p>
            <p className="text-xs text-brand-600 mt-0.5">Pre-fill name & spec from the product — saves re-entering the same info.</p>
          </div>
          <button
            type="button"
            onClick={applyProductInfo}
            className="btn-primary text-xs py-1.5 px-3 shrink-0"
          >
            Use Product Info
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Component Name *</label>
          <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Crystal Body, NFC Card, Packaging Box" />
        </div>

        <div>
          <label className="label">Specification</label>
          <textarea className="input" rows={3} value={form.spec} onChange={set('spec')} placeholder="Material, size, finish, colour, weight…" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Unit</label>
            <select className="input" value={form.unit} onChange={set('unit')}>
              {['pcs', 'set', 'pair', 'kg', 'g', 'm', 'box'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Qty per Product</label>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={form.qty_per_product}
              onChange={set('qty_per_product')}
            />
            <p className="text-xs text-ink-60 mt-1">How many of this component go into 1 finished product</p>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Any additional notes…" />
        </div>

        {/* Copy images option — only on new, if product has images */}
        {!isEdit && productImages.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-none bg-ivory border border-warm-grey">
            <input
              type="checkbox"
              id="copyImages"
              className="mt-0.5 w-4 h-4 accent-brand-600"
              checked={copyingImages}
              onChange={e => setCopyingImages(e.target.checked)}
            />
            <label htmlFor="copyImages" className="text-sm text-ink-80 cursor-pointer">
              Copy product images into this component
              <span className="text-xs text-ink-60 ml-1">({productImages.length} image{productImages.length > 1 ? 's' : ''})</span>
            </label>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Component'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
