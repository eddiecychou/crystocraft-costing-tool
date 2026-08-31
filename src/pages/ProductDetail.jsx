import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, orderBy, query, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import ImageGallery from '../components/ImageGallery'
import { IMAGE_TYPES, productStatusOf } from '../constants'
import { Star, X } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'
import { useRole } from '../access'

export default function ProductDetail() {
  const { id } = useParams()
  const role = useRole()
  // Branded-for image tagging reads the customers collection — admin AND sales
  // (V8.13) may, production may not (rules deny it). The name `isAdmin` is kept
  // for the existing customers-fetch guard below; it means "may read customers".
  const isAdmin = role === 'admin' || role === 'sales'
  // The Pricing Tiers editor is cost-derived (components + supplier quotes +
  // markup formula) — admin only. Sales sees prices when quoting, not here.
  const canManagePricing = role === 'admin'
  const navigate = useNavigate()
  const [product, setProduct]       = useState(null)
  const [components, setComponents] = useState([])
  const [images, setImages]         = useState([])
  const [customers, setCustomers]   = useState([])   // for "branded for" tagging on images
  const [loading, setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [duplicating, setDuplicating]     = useState(false)

  // Copy-existing picker state
  const [showPicker, setShowPicker]       = useState(false)
  const [allComponents, setAllComponents] = useState([])
  const [pickerSearch, setPickerSearch]   = useState('')
  const [copying, setCopying]             = useState(false)
  const remember = useScrollMemory(`product-${id}`, !loading)

  useEffect(() => {
    getDoc(doc(db, 'products', id)).then(snap => {
      if (snap.exists()) setProduct({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
  }, [id])

  // BOM/components are supply-side (admin + production only in firestore.rules).
  // Sales edits the catalogue's customer-facing fields + pricing but not the
  // bill of materials — so don't subscribe (the read would permission-deny)
  // and the Components card + Duplicate are hidden below.
  const isSupplySide = role === 'admin' || role === 'production'
  useEffect(() => {
    if (!isSupplySide) return
    const q = query(collection(db, 'products', id, 'components'), orderBy('sort_order'))
    return onSnapshot(q, snap => setComponents(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id, isSupplySide])

  useEffect(() => {
    const q = query(collection(db, 'products', id, 'images'), orderBy('sort_order'))
    return onSnapshot(q, snap => setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [id])

  // Lightweight customer list for "branded for" image tagging — id + name
  // only. Admin-only: the customers collection is owner-gated, and a
  // production login would just hit permission-denied here.
  useEffect(() => {
    if (!isAdmin) return
    getDocs(query(collection(db, 'customers'), orderBy('company_name')))
      .then(snap => setCustomers(snap.docs.map(d => ({ id: d.id, company_name: d.data().company_name || '' }))))
      .catch(() => setCustomers([]))
  }, [isAdmin])

  // heroImage is a plain cached URL on the product doc — unlike the gallery
  // (loaded live from products/{id}/images, which the Firestore rule already
  // screens per-viewer), this field bypasses that protection entirely: any
  // approved customer can read it straight off the product document, sensitive
  // or not. Mirroring the chosen image's own branded_for_customer_id here lets
  // the storefront (CorporateShop.jsx / CorporateDetail.jsx) hide it for a
  // sensitive viewer without needing its own extra read. Stale if someone
  // later changes the ALREADY-hero image's own tag without re-picking it —
  // known gap, not yet closed.
  async function handleHeroChange(url) {
    const chosen = images.find(im => im.file_url === url)
    const heroImage_branded_for_customer_id = chosen?.branded_for_customer_id || null
    await updateDoc(doc(db, 'products', id), { heroImage: url, heroImage_branded_for_customer_id })
    setProduct(p => ({ ...p, heroImage: url, heroImage_branded_for_customer_id }))
  }

  async function toggleField(field, value) {
    await updateDoc(doc(db, 'products', id), { [field]: value })
    setProduct(p => ({ ...p, [field]: value }))
  }

  async function handleDelete() {
    await deleteDoc(doc(db, 'products', id))
    navigate('/products')
  }

  async function handleDuplicate() {
    setDuplicating(true)
    try {
      // Create new product with "(Copy)" suffix, reset timestamps
      const { id: _id, ...productData } = product
      const newRef = await addDoc(collection(db, 'products'), {
        ...productData,
        name: `${product.name} (Copy)`,
        status: 'concept',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Copy components + their images subcollections in parallel
      const compSnap = await getDocs(query(collection(db, 'products', id, 'components'), orderBy('sort_order')))
      await Promise.all(compSnap.docs.map(async compDoc => {
        const { id: _cid, ...compData } = { id: compDoc.id, ...compDoc.data() }
        const newCompRef = await addDoc(collection(db, 'products', newRef.id, 'components'), compData)
        const compImgSnap = await getDocs(
          query(collection(db, 'products', id, 'components', compDoc.id, 'images'), orderBy('sort_order'))
        )
        if (!compImgSnap.empty) {
          await Promise.all(compImgSnap.docs.map(imgDoc => {
            const { storage_path: _sp, ...imgData } = imgDoc.data()
            return addDoc(collection(db, 'products', newRef.id, 'components', newCompRef.id, 'images'), imgData)
          }))
        }
      }))

      // Copy product images (reuse same Storage URLs)
      const imgSnap = await getDocs(query(collection(db, 'products', id, 'images'), orderBy('sort_order')))
      await Promise.all(imgSnap.docs.map(imgDoc => {
        const { storage_path: _sp, ...imgData } = imgDoc.data()
        return addDoc(collection(db, 'products', newRef.id, 'images'), imgData)
      }))

      navigate(`/products/${newRef.id}`)
    } finally {
      setDuplicating(false)
    }
  }

  async function openPicker() {
    setPickerSearch('')
    setShowPicker(true)
    if (allComponents.length > 0) return
    // Fetch all products, then their components — avoids collectionGroup index requirement
    const productsSnap = await getDocs(query(collection(db, 'products'), orderBy('name')))
    const items = []
    await Promise.all(productsSnap.docs.map(async pDoc => {
      const compSnap = await getDocs(collection(db, 'products', pDoc.id, 'components'))
      compSnap.docs.forEach(d => {
        items.push({ id: d.id, ...d.data(), _productId: pDoc.id, _productName: pDoc.data().name || pDoc.id })
      })
    }))
    setAllComponents(items)
  }

  async function handleCopyComponent(comp) {
    setCopying(true)
    try {
      const existing = components.map(c => c.sort_order ?? 0)
      const nextOrder = existing.length ? Math.max(...existing) + 1 : 0
      const newComp = {
        name: comp.name,
        spec: comp.spec || '',
        unit: comp.unit || 'pcs',
        notes: comp.notes || '',
        sort_order: nextOrder,
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'products', id, 'components'), newComp)

      // Copy images subcollection (reuse same Storage URLs)
      const imgSnap = await getDocs(
        query(collection(db, 'products', comp._productId, 'components', comp.id, 'images'), orderBy('sort_order'))
      )
      if (!imgSnap.empty) {
        await Promise.all(imgSnap.docs.map(imgDoc => {
          const { storage_path: _sp, ...imgData } = imgDoc.data()
          return addDoc(collection(db, 'products', id, 'components', ref.id, 'images'), imgData)
        }))
      }

      setShowPicker(false)
      navigate(`/products/${id}/components/${ref.id}`)
    } finally {
      setCopying(false)
    }
  }

  if (loading) return <LoadingBar />
  if (!product) return <div className="p-6 text-gray-500">Product not found.</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link to="/products" className="text-sm text-brand-600 hover:underline">← Products</Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mt-1 gap-2">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">{product.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`badge-${productStatusOf(product.status).value}`}>{productStatusOf(product.status).label}</span>
              <span className="text-sm text-gray-500">{product.category}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!product.is_new}
                       onChange={e => toggleField('is_new', e.target.checked)} />
                <span className="text-xs text-gray-600">New arrival</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={product.active !== false}
                       onChange={e => toggleField('active', e.target.checked)} />
                <span className="text-xs text-gray-600">Visible in catalogue</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link to={`/products/${id}/edit`} onClick={remember} className="btn-secondary text-sm">Edit</Link>
            {/* Duplicate copies the BOM/components too — supply-side, so it's
                hidden from sales (who can't read/write components). */}
            {isSupplySide && (
              <button className="btn-secondary text-sm" onClick={handleDuplicate} disabled={duplicating}>
                {duplicating ? 'Copying…' : '⧉ Duplicate'}
              </button>
            )}
            <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
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

          {/* Components / BOM — supply-side (admin + production). Hidden from
              sales, whose catalogue access is the customer-facing fields +
              pricing, not the bill of materials. */}
          {isSupplySide && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Bill of Materials</h2>
              <div className="flex gap-2">
                <button onClick={openPicker} className="btn-secondary text-xs py-1 px-3">+ Copy Existing</button>
                <Link to={`/products/${id}/components/new`} onClick={remember} className="btn-primary text-xs py-1 px-3">+ New</Link>
              </div>
            </div>
            {components.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No components yet — add the parts that make up this product.</p>
            ) : (
              <div className="space-y-2">
                {components.map(c => (
                  <Link
                    key={c.id}
                    to={`/products/${id}/components/${c.id}`}
                    onClick={remember}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-brand-200 hover:bg-brand-50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800">{c.name}</p>
                        {(Number(c.qty_per_product) || 1) > 1 && (
                          <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">×{c.qty_per_product}</span>
                        )}
                      </div>
                      {c.spec && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.spec}</p>}
                    </div>
                    <span className="text-xs text-gray-400">→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Pricing Tiers placeholder — admin only; pricing is margin data
              and the /products/:id/pricing route is admin-gated. */}
          {canManagePricing && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">Pricing Tiers</h2>
                <Link to={`/products/${id}/pricing`} onClick={remember} className="btn-secondary text-xs py-1 px-3">Manage Pricing</Link>
              </div>
              <p className="text-sm text-gray-400 text-center py-2">Set up components and suppliers first, then add pricing tiers.</p>
            </div>
          )}
        </div>

        {/* Right: images */}
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Images
              <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-normal ml-2">hover image to set hero <Star size={12} /> or delete <X size={12} /> · add a caption below each</span>
            </h2>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              <span className="font-medium text-gray-600">Visibility</span> controls where each image may appear:
              <span className="inline-block mx-1 px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-medium">Internal</span> admin only,
              <span className="inline-block mx-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium">Storefront</span> shown to logged-in customers,
              <span className="inline-block mx-1 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-medium">Public</span> also allowed in blog posts.
              New uploads start <span className="font-medium">Internal</span> — set client-logo images carefully before sharing.
              If a storefront photo shows a specific client's branding, tag it
              <span className="inline-block mx-1 px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-medium">Branded for</span>
              that customer — anyone flagged "sensitive" (Customers → edit) will never see it, automatically.
            </p>
            <ImageGallery
              images={images}
              firestorePath={`products/${id}/images`}
              storagePath={`products/${id}/images`}
              typeOptions={IMAGE_TYPES}
              captionable
              showVisibility
              brandedForCustomers={customers}
              onHeroChange={handleHeroChange}
              downloadPrefix={product?.name}
              enhanceable
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

      {/* Copy-existing component picker modal */}
      {showPicker && (
        <ComponentPicker
          allComponents={allComponents}
          currentProductId={id}
          search={pickerSearch}
          onSearchChange={setPickerSearch}
          onSelect={handleCopyComponent}
          onClose={() => setShowPicker(false)}
          copying={copying}
        />
      )}
    </div>
  )
}

function ComponentPicker({ allComponents, currentProductId, search, onSearchChange, onSelect, onClose, copying }) {
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allComponents
      .filter(c => c._productId !== currentProductId)
      .filter(c =>
        !q ||
        c.name?.toLowerCase().includes(q) ||
        c._productName?.toLowerCase().includes(q) ||
        c.spec?.toLowerCase().includes(q)
      )
  }, [allComponents, currentProductId, search])

  // Group by product
  const grouped = useMemo(() => {
    const map = {}
    for (const c of filtered) {
      if (!map[c._productName]) map[c._productName] = []
      map[c._productName].push(c)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Copy Existing Component</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <input
            autoFocus
            type="text"
            placeholder="Search by name, product, or spec…"
            className="input"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {allComponents.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">Loading components…</p>
          ) : grouped.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">No matching components found.</p>
          ) : (
            grouped.map(([productName, comps]) => (
              <div key={productName}>
                <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                  {productName}
                </p>
                {comps.map(c => (
                  <button
                    key={c.id}
                    disabled={copying}
                    onClick={() => onSelect(c)}
                    className="w-full text-left px-4 py-3 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <p className="text-sm font-medium text-gray-800">{c.name}</p>
                    {c.spec && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.spec}</p>}
                    {(c.unit || c.qty_per_product) && (
                      <span className="text-xs text-gray-400">
                        {c.qty_per_product ? `${c.qty_per_product} ${c.unit || 'pcs'}` : `Unit: ${c.unit}`}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Click a component to copy it into this product. You can edit it after copying.
        </div>
      </div>
    </div>
  )
}
