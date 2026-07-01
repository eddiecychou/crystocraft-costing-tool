import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { getComponent, saveComponent, deleteComponent, loadComponentQuotes, setPreferredQuote } from '../criticalComponents'
import { RANGE_PLATINGS } from '../constants'
import { useComponentCategories } from '../componentCategories'
import { Star, FileText } from 'lucide-react'

const blank = {
  code: '', name: '', category: '', plating_code: '', stock_qty: '', lead_time_weeks: '',
  supplierId: '', supplierName: '', notes: '', images: [],
}

// Stable id for new docs so image storage paths exist before first save.
const newId = () => 'rc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export default function RangeComponentForm() {
  const { id: routeId } = useParams()
  const isNew = !routeId || routeId === 'new'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const back = searchParams.get('back') || ''
  const backQ = back ? `?back=${encodeURIComponent(back)}` : ''

  const [docId] = useState(() => (isNew ? newId() : routeId))
  const [form, setForm] = useState(blank)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [quotes, setQuotes] = useState([])
  const { categories: catOptions } = useComponentCategories()

  const refreshQuotes = () => { if (!isNew) loadComponentQuotes(routeId).then(setQuotes) }
  useEffect(() => { refreshQuotes() }, [routeId, isNew])

  async function preferQuote(qid) {
    await setPreferredQuote(routeId, qid)
    refreshQuotes()
  }

  useEffect(() => {
    if (isNew) return
    getComponent(routeId).then(c => {
      if (c) setForm({
        code: c.code, name: c.name, category: c.category || '', plating_code: c.plating_code || '',
        stock_qty: c.stock_qty ?? '', lead_time_weeks: c.lead_time_weeks ?? '',
        supplierId: c.supplierId || '', supplierName: c.supplierName || '',
        notes: c.notes || '', images: c.images || [],
      })
      setLoading(false)
    })
  }, [routeId, isNew])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))
  const setNum = key => e => setForm(f => ({ ...f, [key]: e.target.value.replace(/[^\d.]/g, '') }))

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
      const savedId = await saveComponent(isNew ? docId : routeId, form)
      navigate(isNew ? `/components/critical/${savedId}` : '/components')
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
                {/* Keep the saved value visible even if it was later renamed/removed. */}
                {(form.category && !catOptions.includes(form.category) ? [form.category, ...catOptions] : catOptions)
                  .map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Name / description</label>
            <input className="input" value={form.name} onChange={set('name')}
                   placeholder="Owl body / 18-note music-box movement" />
          </div>

          <div>
            <label className="label">Plating <span className="text-ink-60 font-normal">(Gold/Chrome parts have distinct codes; blank = shared across all platings)</span></label>
            <select className="input" value={form.plating_code} onChange={set('plating_code')}>
              <option value="">Shared — all platings</option>
              {RANGE_PLATINGS.map(p => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
            </select>
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
            <label className="label">Notes <span className="text-ink-60 font-normal">(spec, dimensions, remarks)</span></label>
            <textarea className="input min-h-[80px]" value={form.notes} onChange={set('notes')} />
          </div>
        </div>

        {/* Supplier quotes — image + OCR, like corp gift. Cost comes from the
            preferred quote and feeds figurine costing. */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base">Supplier quotes <span className="text-ink-60 font-normal text-sm">(drives figurine cost)</span></h2>
            {!isNew && <Link to={`/components/critical/${routeId}/quotes/new${backQ}`} className="btn-secondary text-sm">+ Add quote</Link>}
          </div>
          <p className="text-xs text-ink-60 mb-3">Upload supplier screenshots / PDFs; AI extracts the price. Star one as preferred — its cost is used in costing.</p>

          {isNew ? (
            <p className="text-sm text-ink-50">Save the component first, then add supplier quotes with images.</p>
          ) : quotes.length === 0 ? (
            <p className="text-sm text-ink-50">No quotes yet — <Link to={`/components/critical/${routeId}/quotes/new${backQ}`} className="text-brand-600 hover:underline">add the first supplier quote</Link>.</p>
          ) : (
            <div className="divide-y divide-ivory-dark">
              {quotes.map(q => (
                <div key={q.id} className="py-2.5 flex items-center gap-3">
                  <button type="button" onClick={() => preferQuote(q.id)} title={q.is_preferred ? 'Preferred' : 'Mark preferred'}
                          className={q.is_preferred ? 'text-amber-500' : 'text-ink-30 hover:text-amber-400'}>
                    <Star size={16} fill={q.is_preferred ? 'currentColor' : 'none'} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">
                      {q.supplier_name || 'Unnamed supplier'}
                      {q.is_preferred && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">preferred</span>}
                    </p>
                    <p className="text-xs text-ink-50">
                      {q.unit_cost != null ? `${q.unit_cost} ${q.unit_cost_currency}` : 'no price'}
                      {q.moq ? ` · MOQ ${Number(q.moq).toLocaleString()}` : ''}
                      {q.volume_tiers?.length ? ` · ${q.volume_tiers.length} tier${q.volume_tiers.length > 1 ? 's' : ''}` : ''}
                      {q.attachments?.length ? ` · ${q.attachments.length} file${q.attachments.length > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                  {q.attachments?.length > 0 && (q.attachments[0].file_type === 'image'
                    ? <img src={q.attachments[0].file_url} alt="" className="w-9 h-9 object-cover rounded border border-ivory-dark shrink-0" />
                    : <FileText size={16} className="text-red-400 shrink-0" />)}
                  <Link to={`/components/critical/${routeId}/quotes/${q.id}${backQ}`} className="text-xs text-brand-600 hover:underline shrink-0">Edit</Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Images */}
        <div className="card p-5">
          <h2 className="text-base mb-3">Images</h2>
          <p className="text-xs text-ink-60 mb-3">Click a tile to upload. Hover an image and tap × to remove.</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {form.images.map(url => (
              <div key={url} className="relative aspect-square bg-white border border-ivory-dark overflow-hidden rounded">
                <img src={url} alt="" className="w-full h-full object-contain p-1" />
                <button type="button" onClick={() => removeImage(url)}
                        className="absolute -top-1.5 -right-1.5 bg-white border border-ivory-dark text-red-600 rounded-full w-5 h-5 text-xs leading-none shadow-sm hover:bg-red-50"
                        title="Remove image">×</button>
              </div>
            ))}
            <label className="aspect-square border border-dashed border-ivory-dark rounded flex flex-col items-center justify-center cursor-pointer text-ink-50 hover:border-brand-400 hover:text-brand-600 transition-colors"
                   title="Click to upload images">
              <span className="text-2xl leading-none">＋</span>
              <span className="text-[10px] mt-0.5">{uploading ? 'Uploading…' : 'Upload'}</span>
              <input type="file" accept="image/*" multiple className="hidden"
                     onChange={e => handleUpload(e.target.files)} />
            </label>
          </div>
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
