import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { getComponent, saveComponent, deleteComponent } from '../criticalComponents'
import { RANGE_COMPONENT_CATEGORIES, CURRENCIES } from '../constants'

const blank = {
  code: '', name: '', category: '', stock_qty: '', lead_time_weeks: '',
  supplierId: '', supplierName: '', notes: '', images: [],
  unit_cost: '', unit_cost_currency: 'RMB', volume_tiers: [],
  tooling_sample_cost: '', tooling_sample_cost_currency: 'RMB',
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
        unit_cost: c.unit_cost ?? '', unit_cost_currency: c.unit_cost_currency || 'RMB',
        volume_tiers: Array.isArray(c.volume_tiers)
          ? c.volume_tiers.map(t => ({ min_qty: t.min_qty ?? '', unit_cost: t.unit_cost ?? '' })) : [],
        tooling_sample_cost: c.tooling_sample_cost ?? '',
        tooling_sample_cost_currency: c.tooling_sample_cost_currency || c.unit_cost_currency || 'RMB',
      })
      setLoading(false)
    })
  }, [routeId, isNew])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))
  const setNum = key => e => setForm(f => ({ ...f, [key]: e.target.value.replace(/[^\d.]/g, '') }))

  const setTier = (i, key) => e => setForm(f => ({
    ...f, volume_tiers: f.volume_tiers.map((t, j) =>
      j === i ? { ...t, [key]: e.target.value.replace(/[^\d.]/g, '') } : t),
  }))
  const addTier = () => setForm(f => ({ ...f, volume_tiers: [...f.volume_tiers, { min_qty: '', unit_cost: '' }] }))
  const removeTier = i => setForm(f => ({ ...f, volume_tiers: f.volume_tiers.filter((_, j) => j !== i) }))

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

        {/* Cost — used by Range Costing */}
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-base">Cost <span className="text-ink-60 font-normal text-sm">(for figurine costing)</span></h2>
            <p className="text-xs text-ink-60 mt-0.5">The supplier cost of one part. Leave blank if this part isn't costed yet.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Unit cost</label>
              <input className="input" inputMode="decimal" value={form.unit_cost}
                     onChange={setNum('unit_cost')} placeholder="e.g. 3.20" />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.unit_cost_currency} onChange={set('unit_cost_currency')}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Volume tiers — optional cheaper price at higher order quantities */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Volume tiers <span className="text-ink-60 font-normal">(optional)</span></label>
              <button type="button" onClick={addTier} className="text-xs text-brand-600 hover:underline">+ Add tier</button>
            </div>
            <p className="text-xs text-ink-60 mb-2">Cheaper unit cost at or above an order quantity. Currency follows the unit cost above.</p>
            {form.volume_tiers.length === 0 ? (
              <p className="text-xs text-ink-50">No volume tiers — the unit cost above applies at every quantity.</p>
            ) : (
              <div className="space-y-2">
                {form.volume_tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-ink-50 w-10">≥ qty</span>
                    <input className="input py-1.5 text-sm w-28" inputMode="numeric" value={t.min_qty}
                           onChange={setTier(i, 'min_qty')} placeholder="e.g. 500" />
                    <span className="text-xs text-ink-50">→ unit cost</span>
                    <input className="input py-1.5 text-sm w-28" inputMode="decimal" value={t.unit_cost}
                           onChange={setTier(i, 'unit_cost')} placeholder="e.g. 2.90" />
                    <button type="button" onClick={() => removeTier(i)}
                            className="text-red-300 hover:text-red-500 text-sm ml-auto" title="Remove tier">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-ivory-dark pt-4">
            <div>
              <label className="label">Tooling / mould <span className="text-ink-60 font-normal">(one-time)</span></label>
              <input className="input" inputMode="decimal" value={form.tooling_sample_cost}
                     onChange={setNum('tooling_sample_cost')} placeholder="optional" />
            </div>
            <div>
              <label className="label">Tooling currency</label>
              <select className="input" value={form.tooling_sample_cost_currency} onChange={set('tooling_sample_cost_currency')}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
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
