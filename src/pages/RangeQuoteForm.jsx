import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, authHeader } from '../firebase'
import { CURRENCIES } from '../constants'
import { getComponent, saveComponentQuote, deleteComponentQuote } from '../criticalComponents'
import { FolderOpen, Paperclip, FileText, X } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'

const blank = {
  supplier_id: '', supplier_name: '', unit_cost: '', unit_cost_currency: 'RMB',
  moq: '', tooling_sample_cost: '', tooling_sample_cost_currency: 'RMB',
  sampling_lead_time_days: '', tooling_lead_time_days: '', production_lead_time_days: '',
  is_preferred: false, notes: '',
}

export default function RangeQuoteForm() {
  const { id: componentId, quoteId } = useParams()
  const isEdit = Boolean(quoteId)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const backUrl = searchParams.get('back') || `/components/critical/${componentId}`
  const fileIdRef = useRef(0)

  const [component, setComponent] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(blank)
  const [volumeTiers, setVolumeTiers] = useState([])
  const [files, setFiles] = useState([])
  const [existingAttachments, setExistingAttachments] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [fetching, setFetching] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const loads = [
      getDocs(query(collection(db, 'suppliers'), orderBy('name'))).then(snap =>
        setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      getComponent(componentId).then(setComponent),
    ]
    if (isEdit) {
      loads.push(getDoc(doc(db, 'range_components', componentId, 'supplier_quotes', quoteId)).then(snap => {
        if (snap.exists()) {
          const d = snap.data()
          setForm({
            supplier_id: d.supplier_id || '', supplier_name: d.supplier_name || '',
            unit_cost: d.unit_cost ?? '', unit_cost_currency: d.unit_cost_currency || 'RMB',
            moq: d.moq ?? '', tooling_sample_cost: d.tooling_sample_cost ?? '',
            tooling_sample_cost_currency: d.tooling_sample_cost_currency || 'RMB',
            sampling_lead_time_days: d.sampling_lead_time_days ?? '',
            tooling_lead_time_days: d.tooling_lead_time_days ?? '',
            production_lead_time_days: d.production_lead_time_days ?? '',
            is_preferred: d.is_preferred || false, notes: d.notes || '',
          })
          setVolumeTiers(d.volume_tiers || [])
          setExistingAttachments(d.attachments || [])
        }
      }))
    }
    Promise.all(loads).finally(() => setFetching(false))
  }, [componentId, quoteId, isEdit])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  function onSupplier(e) {
    const s = suppliers.find(x => x.id === e.target.value)
    setForm(f => ({ ...f, supplier_id: e.target.value, supplier_name: s ? (s.name_cn ? `${s.name} (${s.name_cn})` : s.name) : '' }))
  }

  function addFiles(raw) {
    const next = raw.map(file => ({
      _id: ++fileIdRef.current, file,
      isPdf: file.type === 'application/pdf',
      preview: file.type === 'application/pdf' ? null : URL.createObjectURL(file),
    }))
    setFiles(prev => {
      if (next.length === 1 && prev.length === 0) extractFromFile(next[0].file)
      return [...prev, ...next]
    })
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const raw = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (raw.length) addFiles(raw)
  }

  async function extractFromFile(file) {
    setExtracting(true); setExtractError('')
    try {
      let base64, mimeType
      if (file.type === 'application/pdf') { base64 = await toBase64(file); mimeType = 'application/pdf' }
      else { base64 = await toBase64(await preprocessForGemini(file)); mimeType = 'image/png' }
      const res = await fetch('/api/process-quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()
      setForm(f => ({
        ...f,
        supplier_name: data.supplier_name || f.supplier_name,
        unit_cost: data.unit_cost ?? f.unit_cost,
        unit_cost_currency: data.unit_cost_currency || f.unit_cost_currency,
        moq: data.moq ?? f.moq,
        tooling_sample_cost: data.tooling_sample_cost ?? f.tooling_sample_cost,
        tooling_sample_cost_currency: data.tooling_sample_cost_currency || f.tooling_sample_cost_currency,
        sampling_lead_time_days: data.sampling_lead_time_days ?? f.sampling_lead_time_days,
        production_lead_time_days: data.production_lead_time_days ?? f.production_lead_time_days,
      }))
    } catch {
      setExtractError('Could not extract data from this file — please fill in manually.')
    } finally { setExtracting(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const path = `range_components/${componentId}/quotes`
      const uploaded = await Promise.all(files.map(async ({ file }) => {
        const isPdf = file.type === 'application/pdf'
        const fileRef = storageRef(storage, `${path}/${Date.now()}_${file.name}`)
        if (isPdf) await uploadBytes(fileRef, file, { contentType: 'application/pdf' })
        else await uploadBytes(fileRef, await resizeToJpeg(file), { contentType: 'image/jpeg' })
        const url = await getDownloadURL(fileRef)
        return { file_url: url, file_name: file.name, file_type: isPdf ? 'pdf' : 'image', uploaded_at: new Date().toISOString() }
      }))
      await saveComponentQuote(componentId, isEdit ? quoteId : null, {
        ...form,
        volume_tiers: volumeTiers,
        attachments: [...existingAttachments, ...uploaded],
      })
      navigate(backUrl)
    } catch (err) {
      setExtractError(err.message || 'Save failed.')
      setSaving(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <div className="text-sm text-ink-50 mb-1">
          <Link to="/components" className="hover:text-brand-600">Components</Link>
          {' / '}
          <Link to={`/components/critical/${componentId}`} className="hover:text-brand-600">{component?.code || component?.name || 'Component'}</Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Supplier Quote' : 'Add Supplier Quote'}</h1>
      </div>

      {/* Image upload + OCR */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quote Images / Screenshots</h2>
        <p className="text-xs text-gray-500 mb-3">Upload WeChat / WhatsApp screenshots or a PDF — AI will try to extract the pricing automatically.</p>
        <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
            ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
          <span className="text-gray-500 mb-1">{dragOver ? <FolderOpen size={22} /> : <Paperclip size={22} />}</span>
          <span className="text-sm text-gray-600">{dragOver ? 'Drop to upload' : 'Click to upload or drag & drop'}</span>
          <span className="text-xs text-gray-400 mt-0.5">JPG, PNG, WebP, HEIC, PDF</span>
          <input type="file" accept="image/*,.pdf" multiple className="hidden"
                 onChange={e => { addFiles(Array.from(e.target.files)); e.target.value = '' }} />
        </label>

        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            {files.map(f => (
              <div key={f._id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                {f.isPdf
                  ? <div className="w-12 h-12 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0"><FileText size={20} className="text-red-400" /></div>
                  : <img src={f.preview} alt="" className="w-12 h-12 object-cover rounded shrink-0" />}
                <span className="text-xs text-gray-600 flex-1 truncate">{f.file.name}</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter(x => x._id !== f._id))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
            {files.length > 1 && (
              <button type="button" className="btn-secondary w-full justify-center text-xs" onClick={() => extractFromFile(files[0].file)} disabled={extracting}>
                {extracting ? 'Extracting…' : 'Extract data from first image'}
              </button>
            )}
          </div>
        )}
        {extracting && <div className="mt-2 h-1 bg-brand-100 rounded overflow-hidden"><div className="h-full bg-brand-500 animate-pulse w-full" /></div>}
        {extractError && <p className="text-xs text-red-500 mt-2">{extractError}</p>}

        {existingAttachments.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-gray-400 mb-1.5">Saved attachments:</p>
            <div className="flex gap-2 flex-wrap">
              {existingAttachments.map((a, i) => (
                <div key={i} className="relative group/att">
                  {a.file_type === 'pdf'
                    ? <a href={a.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 rounded border border-red-100 bg-red-50 text-xs text-red-700 hover:bg-red-100"><FileText size={14} /><span className="truncate max-w-32">{a.file_name}</span></a>
                    : <a href={a.file_url} target="_blank" rel="noreferrer"><img src={a.file_url} alt="" className="w-12 h-12 object-cover rounded border" /></a>}
                  <button type="button" onClick={() => setExistingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full leading-none flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity" title="Remove"><X size={10} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Supplier</label>
          <select className="input" value={form.supplier_id} onChange={onSupplier}>
            <option value="">{form.supplier_name || '— select supplier —'}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.name_cn ? ` (${s.name_cn})` : ''}</option>)}
          </select>
          <Link to="/suppliers/new" target="_blank" className="text-xs text-brand-600 hover:underline mt-1 inline-block">+ Add new supplier</Link>
        </div>

        <div>
          <label className="label">Unit Cost *</label>
          <div className="flex gap-2">
            <input className="input flex-1" type="number" step="0.01" min="0" value={form.unit_cost} onChange={set('unit_cost')} required placeholder="0.00" />
            <select className="input w-28" value={form.unit_cost_currency} onChange={set('unit_cost_currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Volume Price Tiers <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
            <button type="button" onClick={() => setVolumeTiers(t => [...t, { min_qty: '', unit_cost: '' }])} className="text-xs text-brand-600 hover:text-brand-800 font-medium">+ Add Tier</button>
          </div>
          {volumeTiers.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-gray-400 px-1"><span>Min Qty</span><span>Unit Cost ({form.unit_cost_currency})</span><span></span></div>
              {volumeTiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <input className="input py-1.5 text-sm" type="number" min="1" placeholder="e.g. 500" value={t.min_qty}
                         onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, min_qty: e.target.value } : r))} />
                  <input className="input py-1.5 text-sm" type="number" step="0.01" min="0" placeholder="0.00" value={t.unit_cost}
                         onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, unit_cost: e.target.value } : r))} />
                  <button type="button" onClick={() => setVolumeTiers(t => t.filter((_, j) => j !== i))} className="text-red-300 hover:text-red-500 text-lg leading-none px-1">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">MOQ (Minimum Order Quantity)</label>
          <input className="input" type="number" min="0" value={form.moq} onChange={set('moq')} placeholder="e.g. 500" />
        </div>

        <div>
          <label className="label">Tooling / Sample Cost</label>
          <div className="flex gap-2">
            <input className="input flex-1" type="number" step="0.01" min="0" value={form.tooling_sample_cost} onChange={set('tooling_sample_cost')} placeholder="0.00" />
            <select className="input w-28" value={form.tooling_sample_cost_currency} onChange={set('tooling_sample_cost_currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
          </div>
        </div>

        <div>
          <label className="label">Lead Times (days)</label>
          <div className="grid grid-cols-3 gap-3">
            <div><p className="text-xs text-gray-500 mb-1">Sampling</p><input className="input" type="number" min="0" value={form.sampling_lead_time_days} onChange={set('sampling_lead_time_days')} placeholder="12" /></div>
            <div><p className="text-xs text-gray-500 mb-1">Tooling</p><input className="input" type="number" min="0" value={form.tooling_lead_time_days} onChange={set('tooling_lead_time_days')} placeholder="15" /></div>
            <div><p className="text-xs text-gray-500 mb-1">Production</p><input className="input" type="number" min="0" value={form.production_lead_time_days} onChange={set('production_lead_time_days')} placeholder="30" /></div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="pref" className="w-4 h-4 accent-brand-600" checked={form.is_preferred} onChange={e => setForm(f => ({ ...f, is_preferred: e.target.checked }))} />
          <label htmlFor="pref" className="text-sm text-gray-700">Mark as preferred — this quote drives the figurine cost</label>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Conditions, remarks, context…" />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Quote'}</button>
            <button type="button" className="btn-secondary" onClick={() => navigate(backUrl)}>Cancel</button>
          </div>
          {isEdit && <button type="button" className="text-sm text-red-500 hover:text-red-700" onClick={() => setConfirmDelete(true)}>Delete Quote</button>}
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog title="Delete Quote" message="Delete this supplier quote? This cannot be undone."
          onConfirm={async () => { await deleteComponentQuote(componentId, quoteId); navigate(backUrl) }}
          onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  )
}

// ── Image utilities (mirrors SupplierQuoteForm) ──────────────────────────────
async function resizeToJpeg(file, maxPx = 2400, quality = 0.93) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

async function preprocessForGemini(file, maxPx = 2400) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = grey
  }
  const greys = []
  for (let i = 0; i < data.length; i += 4) greys.push(data[i])
  greys.sort((a, b) => a - b)
  const lo = greys[Math.floor(greys.length * 0.01)], hi = greys[Math.floor(greys.length * 0.99)]
  const range = hi - lo || 1
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(((data[i] - lo) / range) * 255)
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v))
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
