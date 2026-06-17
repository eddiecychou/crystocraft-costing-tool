import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { getComponent, saveComponent, deleteComponent } from '../criticalComponents'
import { RANGE_COMPONENT_CATEGORIES } from '../constants'

const blank = {
  code: '', name: '', category: '', stock_qty: '', lead_time_weeks: '',
  supplierId: '', supplierName: '', notes: '', images: [],
}

// Stable id for new docs so image storage paths exist before first save.
const newId = () => 'rc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export default function RangeComponentForm() {
  const { id: routeId } = useParams()
  const isNew = !routeId || routeId === 'new'
  const navigate = useNavigate()

  const [docId] = useState(() => (isNew ? newId() : routeId))
  const [form, setForm] = useState(blank)
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'suppliers'), orderBy('name'))
    return onSnapshot(q, snap => setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    if (isNew) return
    getComponent(routeId).then(c => {
      if (c) setForm({
        code: c.code, name: c.name, category: c.category || '',
        stock_qty: c.stock_qty ?? '', lead_time_weeks: c.lead_time_weeks ?? '',
        supplierId: c.supplierId || '', supplierName: c.supplierName || '',
        notes: c.notes || '', images: c.images || [],
      })
      setLoading(false)
    })
  }, [routeId, isNew])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))
  const setNum = key => e => setForm(f => ({ ...f, [key]: e.target.value.replace(/[^\d.]/g, '') }))

  const onSupplier = e => {
    const sid = e.target.value
    const s = suppliers.find(x => x.id === sid)
    setForm(f => ({ ...f, supplierId: sid, supplierName: s ? (s.name || '') : '' }))
  }

  async function handleUpload(files) {
    if (!files || !files.length) return
    setUploading(true); setError('')
    try {
      const urls = []
      for (const file of files) {
        const safe = file.name.replace(/[^\w.\-]/g, '_')
        const path = `range_components/${docId}/${Date.now()}-${safe}`
        await uploadBytes(storageRef(storage, path), file)
        urls.push(await getDownloadURL(storageRef(storage, path)))
      }
      setForm(f => ({ ...f, images: [...f.images, ...urls] }))
    } catch (err) { setError(err.message || 'Upload failed.') }
    finally { setUploading(false) }
  }

  const removeImage = url => setForm(f => ({ ...f, images: f.images.filter(u => u !== url) }))

  async function handleSave(e) {
    e.preventDefault()
    if (!form.code.trim()) { setError('Item code is required.'); return }
    setSaving(true); setError('')
    try {
      await saveComponent(isNew ? docId : routeId, form)
      navigate('/components')
    } catch (err) { setError(err.message || 'Save failed.'); setSaving(false) }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete component ${form.code}? This cannot be undone.`)) return
    setSaving(true)
    try { await deleteComponent(routeId); navigate('/components') }
    catch (err) { setError(err.message || 'Delete failed.'); setSaving(false) }
  }

  if (loading) return <div className="p-6 text-sm text-ink-60">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <Link to="/components" className="text-xs text-brand-600 hover:underline">← Components</Link>
      <h1 className="text-xl font-semibold mt-1 mb-4">
        {isNew ? 'New Component' : form.code || 'Component'}
      </h1>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Item code <span className="text-red-400">*</span> <span className="text-ink-60 font-normal">(ERP)</span></label>
              <input className="input font-mono uppercase" value={form.code}
                     onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                     placeholder="U0002-BODY" autoFocus={isNew} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={set('category')}>
                <option value="">— none —</option>
                {RANGE_COMPONENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Name / description</label>
            <input className="input" value={form.name} onChange={set('name')}
                   placeholder="Owl body / 18-note music-box movement" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Stock on hand <span className="text-ink-60 font-normal">(raw parts)</span></label>
              <input className="input" inputMode="numeric" value={form.stock_qty}
                     onChange={setNum('stock_qty')} placeholder="0" />
            </div>
            <div>
              <label className="label">Lead time <span className="text-ink-60 font-normal">(weeks)</span></label>
              <input className="input" inputMode="numeric" value={form.lead_time_weeks}
                     onChange={setNum('lead_time_weeks')} placeholder="e.g. 8" />
            </div>
          </div>

          <div>
            <label className="label">Supplier</label>
            <select className="input" value={form.supplierId} onChange={onSupplier}>
              <option value="">— none —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Notes <span className="text-ink-60 font-normal">(spec, dimensions, remarks)</span></label>
            <textarea className="input min-h-[80px]" value={form.notes} onChange={set('notes')} />
          </div>
        </div>

        {/* Images */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base">Images</h2>
            <label className="text-xs text-brand-600 cursor-pointer hover:underline">
              {uploading ? 'Uploading…' : '+ Add images'}
              <input type="file" accept="image/*" multiple className="hidden"
                     onChange={e => handleUpload(e.target.files)} />
            </label>
          </div>
          {form.images.length === 0 ? (
            <p className="text-xs text-ink-60">No images yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {form.images.map(url => (
                <div key={url} className="relative group aspect-square bg-white border border-ivory-dark overflow-hidden rounded">
                  <img src={url} alt="" className="w-full h-full object-contain p-1" />
                  <button type="button" onClick={() => removeImage(url)}
                          className="absolute top-1 right-1 bg-white/90 text-red-500 rounded-full w-5 h-5 text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || uploading} className="btn-primary">
            {saving ? 'Saving…' : 'Save Component'}
          </button>
          <Link to="/components" className="btn-secondary">Cancel</Link>
          {!isNew && (
            <button type="button" onClick={handleDelete} disabled={saving}
                    className="ml-auto text-sm text-red-500 hover:text-red-700">Delete</button>
          )}
        </div>
      </form>
    </div>
  )
}
