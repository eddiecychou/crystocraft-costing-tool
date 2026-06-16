import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'

const RANGE_CATEGORIES = [
  'Angel', 'Bird & Animal', 'Fairy', 'Garden', 'Heart',
  'Hobby & Sport', 'Religious', 'Seasonal',
]

const emptyFinish = () => ({
  sku: '', finish_code: '', finish_name: '', ws_price_usd: '', stock_finished: '', image: '',
})

const emptyPacking = () => ({
  carton_dims: '', pcs_per_carton: '', pack_box_ref: '',
  cbm_per_carton: '', weight_per_carton_kg: '', weight_per_pcs_kg: '',
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
  const { id } = useParams()
  const navigate = useNavigate()

  const [form, setForm] = useState(null)
  const [fetching, setFetching] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'range_products', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm({
          design_code: d.design_code || '',
          design_name: d.design_name || '',
          description: d.description || '',
          category: d.category || '',
          format_code: d.format_code || '',
          size: d.size || '',
          crystal_type: d.crystal_type || 'Bohemia',
          active: d.active !== false,
          packing: { ...emptyPacking(), ...(d.packing || {}) },
          finishes: (d.finishes || []).map(f => ({
            sku: f.sku || '',
            finish_code: f.finish_code || '',
            finish_name: f.finish_name || '',
            ws_price_usd: f.ws_price_usd ?? '',
            stock_finished: f.stock_finished ?? '',
            image: f.image || '',
          })),
        })
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [id])

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }
  function setPacking(key) {
    return e => setForm(f => ({ ...f, packing: { ...f.packing, [key]: e.target.value } }))
  }
  function setFinish(i, field) {
    return e => setForm(f => {
      const finishes = [...f.finishes]
      finishes[i] = { ...finishes[i], [field]: e.target.value }
      return { ...f, finishes }
    })
  }
  function addFinish() {
    setForm(f => ({ ...f, finishes: [...f.finishes, emptyFinish()] }))
  }
  function removeFinish(i) {
    setForm(f => ({ ...f, finishes: f.finishes.filter((_, j) => j !== i) }))
  }

  function num(v) {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await updateDoc(doc(db, 'range_products', id), {
        design_name: form.design_name.trim(),
        description: form.description.trim(),
        category: form.category,
        size: form.size.trim(),
        crystal_type: form.crystal_type,
        active: form.active,
        packing: {
          carton_dims: form.packing.carton_dims.trim(),
          pcs_per_carton: form.packing.pcs_per_carton.toString().trim(),
          pack_box_ref: form.packing.pack_box_ref.trim(),
          cbm_per_carton: form.packing.cbm_per_carton.toString().trim(),
          weight_per_carton_kg: form.packing.weight_per_carton_kg.toString().trim(),
          weight_per_pcs_kg: form.packing.weight_per_pcs_kg.toString().trim(),
        },
        finishes: form.finishes.map(f => ({
          sku: f.sku.trim(),
          finish_code: f.finish_code.trim(),
          finish_name: f.finish_name.trim(),
          ws_price_usd: num(f.ws_price_usd),
          stock_finished: num(f.stock_finished),
          image: f.image.trim(),
        })),
        updatedAt: serverTimestamp(),
      })
      navigate('/range')
    } catch (err) {
      setError(err.message || 'Save failed.')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${form.design_name}" permanently? This cannot be undone. (Tip: untick "Visible" to just hide it instead.)`)) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'range_products', id))
      navigate('/range')
    } catch (err) {
      setError(err.message || 'Delete failed.')
      setSaving(false)
    }
  }

  if (fetching) return <LoadingBar />
  if (!form) return <div className="p-6 text-ink-60">Product not found. <Link to="/range" className="text-brand-600">Back to Figurine Gifts</Link></div>

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="eyebrow mb-1">Figurine Gifts · {form.design_code}</p>
          <h1 className="text-xl md:text-2xl">Edit Product</h1>
        </div>
        <Link to="/range" className="btn-secondary text-sm">← Back</Link>
      </div>

      {error && <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">{error}</div>}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Core fields */}
        <div className="card p-5 space-y-4">
          <div>
            <label className="label">Design Name</label>
            <input className="input" value={form.design_name} onChange={set('design_name')} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={set('category')}>
                <option value="">— None —</option>
                {RANGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                {form.category && !RANGE_CATEGORIES.includes(form.category) &&
                  <option value={form.category}>{form.category}</option>}
              </select>
            </div>
            <div>
              <label className="label">Size</label>
              <input className="input" value={form.size} onChange={set('size')} placeholder="e.g. 7.5 x 5.5 cm" />
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
                  <div className="w-16 h-16 shrink-0 bg-white border border-ivory-dark flex items-center justify-center overflow-hidden">
                    {f.image ? <img src={f.image} alt="" className="w-full h-full object-contain p-1" /> : <span className="text-xl opacity-30">💎</span>}
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
                      <input className="input text-xs" value={f.image} onChange={setFinish(i, 'image')} placeholder="/range-img/… or https://…" />
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
          <button type="button" onClick={handleDelete} disabled={saving} className="btn-danger text-sm">Delete</button>
          <div className="flex gap-2">
            <Link to="/range" className="btn-secondary text-sm">Cancel</Link>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
