import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { RANGE_DESIGN_TYPES, RANGE_PRODUCT_TYPES } from '../constants'
import LoadingBar from '../components/LoadingBar'

const emptyFinish = () => ({
  sku: '', finish_code: '', finish_name: '', ws_price_usd: '', stock_finished: '', image: '',
})
const emptyPacking = () => ({
  carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
  cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
})
const blankForm = () => ({
  design_code: '', design_name: '', description: '', category: '',
  design_type: '', product_type: 'Figurine', format_code: '001',
  size: '', crystal_type: 'Bohemia', active: true,
  packing: emptyPacking(), gallery: [], finishes: [emptyFinish()],
})

const PACKING_FIELDS = [
  { key: 'carton_dims', label: 'Carton Size', placeholder: 'L x W x H cm' },
  { key: 'pcs_per_carton', label: 'Pcs / Carton', placeholder: '48' },
  { key: 'cbm_per_carton', label: 'CBM / Carton', placeholder: '0.0164' },
  { key: 'weight_per_carton_kg', label: 'Weight / Carton (kg)', placeholder: '13.3' },
  { key: 'weight_per_pcs_kg', label: 'Weight / Pc (kg)', placeholder: '0.131' },
  { key: 'pack_box_ref', label: 'Pack / Box Ref', placeholder: 'P-…' },
]

export default function RangeForm() {
  const { id: routeId } = useParams()
  const isNew = routeId === 'new'
  const navigate = useNavigate()

  // Stable doc id (needed for storage paths) — generated up-front for new docs
  const docIdRef = useRef(isNew ? doc(collection(db, 'range_products')).id : routeId)
  const docId = docIdRef.current

  const [form, setForm] = useState(isNew ? blankForm() : null)
  const [fetching, setFetching] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')

  useEffect(() => {
    if (isNew) return
    getDoc(doc(db, 'range_products', routeId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm({
          design_code: d.design_code || '',
          design_name: d.design_name || '',
          description: d.description || '',
          category: d.category || '',
          design_type: d.design_type || d.category || '',
          product_type: d.product_type || 'Figurine',
          format_code: d.format_code || '',
          size: d.size || '',
          crystal_type: d.crystal_type || 'Bohemia',
          active: d.active !== false,
          packing: { ...emptyPacking(), ...(d.packing || {}) },
          gallery: Array.isArray(d.gallery) ? d.gallery : [],
          finishes: (d.finishes || []).map(f => ({
            sku: f.sku || '', finish_code: f.finish_code || '', finish_name: f.finish_name || '',
            ws_price_usd: f.ws_price_usd ?? '', stock_finished: f.stock_finished ?? '', image: f.image || '',
          })),
        })
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [routeId, isNew])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))
  const setPacking = key => e => setForm(f => ({ ...f, packing: { ...f.packing, [key]: e.target.value } }))
  function setFinish(i, field) {
    return e => setForm(f => {
      const finishes = [...f.finishes]; finishes[i] = { ...finishes[i], [field]: e.target.value }
      return { ...f, finishes }
    })
  }
  const addFinish = () => setForm(f => ({ ...f, finishes: [...f.finishes, emptyFinish()] }))
  const removeFinish = i => setForm(f => ({ ...f, finishes: f.finishes.filter((_, j) => j !== i) }))

  async function uploadFile(file) {
    const safe = file.name.replace(/[^\w.\-]/g, '_')
    const path = `range_products/${docId}/${Date.now()}-${safe}`
    await uploadBytes(storageRef(storage, path), file)
    return getDownloadURL(storageRef(storage, path))
  }

  async function handleFinishUpload(i, file) {
    if (!file) return
    setUploading(`finish-${i}`); setError('')
    try {
      const url = await uploadFile(file)
      setForm(f => {
        const finishes = [...f.finishes]; finishes[i] = { ...finishes[i], image: url }
        return { ...f, finishes }
      })
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }

  async function handleGalleryUpload(files) {
    if (!files || !files.length) return
    setUploading('gallery'); setError('')
    try {
      const urls = []
      for (const file of files) urls.push(await uploadFile(file))
      setForm(f => ({ ...f, gallery: [...f.gallery, ...urls] }))
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading('') }
  }
  const addGalleryUrl = () => {
    const url = prompt('Paste image URL:')
    if (url && url.trim()) setForm(f => ({ ...f, gallery: [...f.gallery, url.trim()] }))
  }
  const removeGallery = i => setForm(f => ({ ...f, gallery: f.gallery.filter((_, j) => j !== i) }))

  const num = v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

  async function handleSave(e) {
    e.preventDefault()
    if (isNew && !form.design_code.trim()) { setError('Design code (e.g. D0500) is required.'); return }
    setSaving(true); setError('')
    const payload = {
      design_code: form.design_code.trim(),
      design_name: form.design_name.trim(),
      description: form.description.trim(),
      category: form.category.trim(),
      design_type: form.design_type.trim(),
      product_type: form.product_type.trim(),
      format_code: form.format_code.trim(),
      size: form.size.trim(),
      crystal_type: form.crystal_type.trim(),
      active: form.active,
      packing: Object.fromEntries(PACKING_FIELDS.map(pf => [pf.key, (form.packing[pf.key] ?? '').toString().trim()])),
      gallery: form.gallery,
      finishes: form.finishes.map(f => ({
        sku: f.sku.trim(), finish_code: f.finish_code.trim(), finish_name: f.finish_name.trim(),
        ws_price_usd: num(f.ws_price_usd), stock_finished: num(f.stock_finished), image: f.image.trim(),
      })),
      updatedAt: serverTimestamp(),
    }
    try {
      if (isNew) {
        await setDoc(doc(db, 'range_products', docId), { ...payload, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'range_products', docId), payload)
      }
      navigate('/range')
    } catch (err) { setError(err.message || 'Save failed.'); setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${form.design_name || form.design_code}" permanently? (Tip: untick "Visible" to just hide it.)`)) return
    setSaving(true)
    try { await deleteDoc(doc(db, 'range_products', docId)); navigate('/range') }
    catch (err) { setError(err.message || 'Delete failed.'); setSaving(false) }
  }

  if (fetching) return <LoadingBar />
  if (!form) return <div className="p-6 text-ink-60">Product not found. <Link to="/range" className="text-brand-600">Back to Figurine Gifts</Link></div>

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="eyebrow mb-1">Figurine Gifts {form.design_code && `· ${form.design_code}`}</p>
          <h1 className="text-xl md:text-2xl">{isNew ? 'New Product' : 'Edit Product'}</h1>
        </div>
        <Link to="/range" className="btn-secondary text-sm">← Back</Link>
      </div>

      {error && <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">{error}</div>}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Core fields */}
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Design Code</label>
              <input className="input font-mono" value={form.design_code} onChange={set('design_code')}
                     placeholder="D0500" disabled={!isNew} required />
              {!isNew && <p className="text-[11px] text-ink-60 mt-1">Code can't be changed</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="label">Design Name</label>
              <input className="input" value={form.design_name} onChange={set('design_name')} required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Design Type</label>
              <input className="input" list="design-types" value={form.design_type}
                     onChange={set('design_type')} placeholder="Butterfly, Bird…" />
              <datalist id="design-types">
                {RANGE_DESIGN_TYPES.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Product Type</label>
              <input className="input" list="product-types" value={form.product_type}
                     onChange={set('product_type')} placeholder="Figurine, Music Box…" />
              <datalist id="product-types">
                {RANGE_PRODUCT_TYPES.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Size</label>
              <input className="input" value={form.size} onChange={set('size')} placeholder="7.5 x 5.5 cm" />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={form.description} onChange={set('description')} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-80 cursor-pointer select-none">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Visible in catalogue (untick to hide without deleting)
          </label>
        </div>

        {/* Gallery */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Images</h2>
            <div className="flex gap-2">
              <button type="button" onClick={addGalleryUrl} className="btn-secondary text-xs">+ URL</button>
              <label className="btn-secondary text-xs cursor-pointer">
                {uploading === 'gallery' ? 'Uploading…' : '+ Upload'}
                <input type="file" accept="image/*" multiple className="hidden"
                       onChange={e => handleGalleryUpload(Array.from(e.target.files))} />
              </label>
            </div>
          </div>
          <p className="text-xs text-ink-60 mb-3">Extra product photos (upload files or paste links).</p>
          {form.gallery.length === 0 ? (
            <p className="text-sm text-ink-60">No extra images yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {form.gallery.map((url, i) => (
                <div key={i} className="relative group aspect-square bg-white border border-ivory-dark">
                  <img src={url} alt="" className="w-full h-full object-contain p-1" />
                  <button type="button" onClick={() => removeGallery(i)}
                          className="absolute top-1 right-1 bg-white/90 text-red-600 rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Packing */}
        <div className="card p-5">
          <h2 className="text-base mb-1">Packing</h2>
          <p className="text-xs text-ink-60 mb-3">Carton & weight info for shipping quotes.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PACKING_FIELDS.map(pf => (
              <div key={pf.key}>
                <label className="label">{pf.label}</label>
                <input className="input text-sm" value={form.packing[pf.key] ?? ''}
                       onChange={setPacking(pf.key)} placeholder={pf.placeholder} />
              </div>
            ))}
          </div>
        </div>

        {/* Finishes / SKUs */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base">Finishes & Stock</h2>
            <button type="button" onClick={addFinish} className="btn-secondary text-xs">+ Add finish</button>
          </div>
          <div className="space-y-4">
            {form.finishes.map((f, i) => (
              <div key={i} className="border border-ivory-dark p-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 flex flex-col items-center gap-1">
                    <div className="w-16 h-16 bg-white border border-ivory-dark flex items-center justify-center overflow-hidden">
                      {f.image ? <img src={f.image} alt="" className="w-full h-full object-contain p-1" /> : <span className="text-xl opacity-30">💎</span>}
                    </div>
                    <label className="text-[11px] text-brand-600 cursor-pointer hover:underline">
                      {uploading === `finish-${i}` ? '…' : 'Upload'}
                      <input type="file" accept="image/*" className="hidden"
                             onChange={e => handleFinishUpload(i, e.target.files[0])} />
                    </label>
                  </div>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="label">SKU</label>
                      <input className="input text-xs font-mono" value={f.sku} onChange={setFinish(i, 'sku')} />
                    </div>
                    <div>
                      <label className="label">Finish</label>
                      <input className="input text-xs" value={f.finish_name} onChange={setFinish(i, 'finish_name')} placeholder="Gold / Chrome" />
                    </div>
                    <div>
                      <label className="label">WS Price USD</label>
                      <input className="input text-xs" type="number" step="0.01" value={f.ws_price_usd} onChange={setFinish(i, 'ws_price_usd')} />
                    </div>
                    <div>
                      <label className="label">Stock (pcs)</label>
                      <input className="input text-xs" type="number" step="1" value={f.stock_finished} onChange={setFinish(i, 'stock_finished')} />
                    </div>
                    <div className="col-span-2 sm:col-span-4">
                      <label className="label">Image URL</label>
                      <input className="input text-xs" value={f.image} onChange={setFinish(i, 'image')} placeholder="/range-img/… or https://… or Upload above" />
                    </div>
                  </div>
                  <button type="button" onClick={() => removeFinish(i)} className="text-red-500 hover:text-red-700 text-lg leading-none px-1" title="Remove finish">×</button>
                </div>
              </div>
            ))}
            {form.finishes.length === 0 && <p className="text-sm text-ink-60">No finishes — add one.</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {!isNew
            ? <button type="button" onClick={handleDelete} disabled={saving} className="btn-danger text-sm">Delete</button>
            : <span />}
          <div className="flex gap-2">
            <Link to="/range" className="btn-secondary text-sm">Cancel</Link>
            <button type="submit" disabled={saving || uploading} className="btn-primary text-sm">
              {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
