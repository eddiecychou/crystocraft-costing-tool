import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, serverTimestamp, orderBy, query } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { CURRENCIES } from '../constants'

export default function SupplierQuoteForm() {
  const { productId, componentId, quoteId } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(quoteId)
  const fileIdRef = useRef(0)

  const [suppliers, setSuppliers] = useState([])
  const [showCopyPicker, setShowCopyPicker] = useState(false)
  const [allPreviousQuotes, setAllPreviousQuotes] = useState([])
  const [pickerLoaded, setPickerLoaded] = useState(false)

  const [form, setForm] = useState({
    supplier_id: '',
    supplier_name: '',
    unit_cost: '',
    unit_cost_currency: 'RMB',
    moq: '',
    tooling_sample_cost: '',
    tooling_sample_cost_currency: 'RMB',
    tooling_lead_time_days: '',
    sampling_lead_time_days: '',
    production_lead_time_days: '',
    is_preferred: false,
    notes: '',
  })
  const [files, setFiles]         = useState([])
  const [existingAttachments, setExistingAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [fetching, setFetching]   = useState(true)
  const [productName, setProductName]     = useState('')
  const [componentName, setComponentName] = useState('')
  const [extractError, setExtractError]   = useState('')

  useEffect(() => {
    const loads = [
      getDocs(query(collection(db, 'suppliers'), orderBy('name'))).then(snap =>
        setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      ),
      getDoc(doc(db, 'products', productId)).then(s => setProductName(s.data()?.name || '')),
      getDoc(doc(db, 'products', productId, 'components', componentId)).then(s => setComponentName(s.data()?.name || '')),
    ]

    if (isEdit) {
      loads.push(
        getDoc(doc(db, 'products', productId, 'components', componentId, 'supplier_quotes', quoteId)).then(snap => {
          if (snap.exists()) {
            const d = snap.data()
            setForm(f => ({
              ...f,
              supplier_id: d.supplier_id || '',
              supplier_name: d.supplier_name || '',
              unit_cost: d.unit_cost ?? '',
              unit_cost_currency: d.unit_cost_currency || 'RMB',
              moq: d.moq ?? '',
              tooling_sample_cost: d.tooling_sample_cost ?? '',
              tooling_sample_cost_currency: d.tooling_sample_cost_currency || 'RMB',
              tooling_lead_time_days: d.tooling_lead_time_days ?? '',
              sampling_lead_time_days: d.sampling_lead_time_days ?? '',
              production_lead_time_days: d.production_lead_time_days ?? '',
              is_preferred: d.is_preferred || false,
              notes: d.notes || '',
            }))
            setExistingAttachments(d.attachments || [])
          }
        })
      )
    }

    Promise.all(loads).then(() => setFetching(false))
  }, [productId, componentId, quoteId, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }
  function setCheck(field) { return e => setForm(f => ({ ...f, [field]: e.target.checked })) }

  function handleFileChange(e) {
    const newFiles = Array.from(e.target.files).map(file => ({
      _id: ++fileIdRef.current,
      file,
      isPdf: file.type === 'application/pdf',
      preview: file.type === 'application/pdf' ? null : URL.createObjectURL(file),
    }))
    setFiles(prev => [...prev, ...newFiles])
    e.target.value = ''

    if (newFiles.length === 1 && files.length === 0) {
      extractFromFile(newFiles[0].file)
    }
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f._id !== id))
  }

  async function extractFromFile(file) {
    setExtracting(true)
    setExtractError('')
    try {
      let base64, mimeType
      if (file.type === 'application/pdf') {
        base64 = await toBase64(file)
        mimeType = 'application/pdf'
      } else {
        const preprocessed = await preprocessForGemini(file)
        base64 = await toBase64(preprocessed)
        mimeType = 'image/png'
      }

      const res = await fetch('/api/process-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setExtractError('Could not extract data from image — please fill in manually.')
    } finally {
      setExtracting(false)
    }
  }

  async function handleExtractAll() {
    if (files.length === 0) return
    await extractFromFile(files[0].file)
  }

  async function openCopyPicker() {
    setShowCopyPicker(true)
    if (pickerLoaded) return
    // Fetch all products → all components → all supplier quotes
    const productsSnap = await getDocs(query(collection(db, 'products'), orderBy('name')))
    const all = []
    await Promise.all(productsSnap.docs.map(async pDoc => {
      const compsSnap = await getDocs(collection(db, 'products', pDoc.id, 'components'))
      await Promise.all(compsSnap.docs.map(async cDoc => {
        const qSnap = await getDocs(query(
          collection(db, 'products', pDoc.id, 'components', cDoc.id, 'supplier_quotes'),
          orderBy('createdAt', 'desc')
        ))
        qSnap.docs.forEach(qDoc => {
          all.push({
            id: qDoc.id,
            ...qDoc.data(),
            _productName: pDoc.data().name || '',
            _componentName: cDoc.data().name || '',
          })
        })
      }))
    }))
    setAllPreviousQuotes(all)
    setPickerLoaded(true)
  }

  function applyQuote(q) {
    setForm(f => ({
      ...f,
      supplier_id: q.supplier_id || '',
      supplier_name: q.supplier_name || '',
      unit_cost: q.unit_cost ?? '',
      unit_cost_currency: q.unit_cost_currency || 'RMB',
      moq: q.moq ?? '',
      tooling_sample_cost: q.tooling_sample_cost ?? '',
      tooling_sample_cost_currency: q.tooling_sample_cost_currency || 'RMB',
      tooling_lead_time_days: q.tooling_lead_time_days ?? '',
      sampling_lead_time_days: q.sampling_lead_time_days ?? '',
      production_lead_time_days: q.production_lead_time_days ?? '',
      is_preferred: false,
      notes: '',
    }))
    setShowCopyPicker(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setUploading(true)

    try {
      const path = `products/${productId}/components/${componentId}/quotes`
      const uploadedAttachments = await Promise.all(
        files.map(async ({ file }) => {
          const isPdf = file.type === 'application/pdf'
          const fileRef = storageRef(storage, `${path}/${Date.now()}_${file.name}`)
          if (isPdf) {
            await uploadBytes(fileRef, file, { contentType: 'application/pdf' })
          } else {
            const colourJpeg = await resizeToJpeg(file)
            await uploadBytes(fileRef, colourJpeg, { contentType: 'image/jpeg' })
          }
          const url = await getDownloadURL(fileRef)
          return { file_url: url, file_name: file.name, file_type: isPdf ? 'pdf' : 'image', ai_extracted: extracting, uploaded_at: new Date().toISOString() }
        })
      )
      setUploading(false)

      const selectedSupplier = suppliers.find(s => s.id === form.supplier_id)
      const payload = {
        ...form,
        supplier_name: selectedSupplier
          ? (selectedSupplier.name_cn ? `${selectedSupplier.name} (${selectedSupplier.name_cn})` : selectedSupplier.name)
          : form.supplier_name,
        unit_cost: form.unit_cost === '' ? null : Number(form.unit_cost),
        moq: form.moq === '' ? null : Number(form.moq),
        tooling_sample_cost: form.tooling_sample_cost === '' ? null : Number(form.tooling_sample_cost),
        tooling_lead_time_days: form.tooling_lead_time_days === '' ? null : Number(form.tooling_lead_time_days),
        sampling_lead_time_days: form.sampling_lead_time_days === '' ? null : Number(form.sampling_lead_time_days),
        production_lead_time_days: form.production_lead_time_days === '' ? null : Number(form.production_lead_time_days),
        attachments: [...existingAttachments, ...uploadedAttachments],
      }

      const basePath = collection(db, 'products', productId, 'components', componentId, 'supplier_quotes')

      // If marking as preferred, clear is_preferred on all other quotes for this component first
      if (payload.is_preferred) {
        const existing = await getDocs(basePath)
        await Promise.all(
          existing.docs
            .filter(d => d.id !== quoteId)
            .map(d => updateDoc(d.ref, { is_preferred: false }))
        )
      }

      if (isEdit) {
        await updateDoc(doc(db, 'products', productId, 'components', componentId, 'supplier_quotes', quoteId), payload)
      } else {
        await addDoc(basePath, { ...payload, createdAt: serverTimestamp() })
      }

      navigate(`/products/${productId}/components/${componentId}`)
    } finally {
      setLoading(false)
      setUploading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <div className="text-sm text-gray-500 mb-1">
          <Link to={`/products/${productId}`} className="hover:text-brand-600">{productName}</Link>
          {' / '}
          <Link to={`/products/${productId}/components/${componentId}`} className="hover:text-brand-600">{componentName}</Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Supplier Quote' : 'Add Supplier Quote'}</h1>
      </div>

      {/* Copy from previous quote */}
      {!isEdit && (
        <div className="flex justify-end mb-3">
          <button type="button" onClick={openCopyPicker} className="btn-secondary text-sm">
            ⎘ Copy from Previous Quote
          </button>
        </div>
      )}

      {/* Image Upload */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quote Images / Screenshots</h2>
        <p className="text-xs text-gray-500 mb-3">Upload WeChat or WhatsApp screenshots — AI will try to extract the pricing data automatically.</p>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
          <span className="text-2xl mb-1">📎</span>
          <span className="text-sm text-gray-600">Click to upload images or PDFs</span>
          <span className="text-xs text-gray-400 mt-0.5">JPG, PNG, WebP, HEIC, PDF</span>
          <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleFileChange} />
        </label>

        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            {files.map(f => (
              <div key={f._id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                {f.isPdf
                  ? <div className="w-12 h-12 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0"><span className="text-xl">📄</span></div>
                  : <img src={f.preview} alt="" className="w-12 h-12 object-cover rounded shrink-0" />}
                <span className="text-xs text-gray-600 flex-1 truncate">{f.file.name}</span>
                <button type="button" onClick={() => removeFile(f._id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
            {files.length > 1 && (
              <button type="button" className="btn-secondary w-full justify-center text-xs" onClick={handleExtractAll} disabled={extracting}>
                {extracting ? 'Extracting…' : `Extract Data from First Image`}
              </button>
            )}
          </div>
        )}

        {extracting && (
          <div className="mt-2 h-1 bg-brand-100 rounded overflow-hidden">
            <div className="h-full bg-brand-500 animate-pulse w-full" />
          </div>
        )}
        {extractError && <p className="text-xs text-red-500 mt-2">{extractError}</p>}
        {existingAttachments.length > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {existingAttachments.map((a, i) => (
              a.file_type === 'pdf'
                ? <a key={i} href={a.file_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-red-100 bg-red-50 text-xs text-red-700 hover:bg-red-100">
                    <span>📄</span><span className="truncate max-w-32">{a.file_name}</span>
                  </a>
                : <a key={i} href={a.file_url} target="_blank" rel="noreferrer">
                    <img src={a.file_url} alt="" className="w-12 h-12 object-cover rounded border" />
                  </a>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Supplier */}
        <div>
          <label className="label">Supplier *</label>
          <select
            className="input"
            value={form.supplier_id}
            required
            onChange={e => {
              const s = suppliers.find(s => s.id === e.target.value)
              setForm(f => ({
                ...f,
                supplier_id: e.target.value,
                supplier_name: s ? (s.name_cn ? `${s.name} (${s.name_cn})` : s.name) : '',
              }))
            }}
          >
            <option value="">Select supplier…</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.name_cn ? ` — ${s.name_cn}` : ''}{s.contact_person ? ` · ${s.contact_person}` : ''}
              </option>
            ))}
          </select>
          <Link to="/suppliers/new" className="text-xs text-brand-600 hover:underline mt-1 inline-block" target="_blank">
            + Add new supplier
          </Link>
        </div>

        {/* Unit Cost */}
        <div>
          <label className="label">Unit Cost *</label>
          <div className="flex gap-2">
            <input className="input flex-1" type="number" step="0.01" min="0" value={form.unit_cost} onChange={set('unit_cost')} required placeholder="0.00" />
            <select className="input w-28" value={form.unit_cost_currency} onChange={set('unit_cost_currency')}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* MOQ */}
        <div>
          <label className="label">MOQ (Minimum Order Quantity)</label>
          <input className="input" type="number" min="0" value={form.moq} onChange={set('moq')} placeholder="e.g. 200" />
        </div>

        {/* Tooling / Sample Cost */}
        <div>
          <label className="label">Tooling / Sample Cost</label>
          <div className="flex gap-2">
            <input className="input flex-1" type="number" step="0.01" min="0" value={form.tooling_sample_cost} onChange={set('tooling_sample_cost')} placeholder="0.00" />
            <select className="input w-28" value={form.tooling_sample_cost_currency} onChange={set('tooling_sample_cost_currency')}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Lead Times */}
        <div>
          <label className="label">Lead Times (days)</label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Sampling</p>
              <input className="input" type="number" min="0" value={form.sampling_lead_time_days} onChange={set('sampling_lead_time_days')} placeholder="e.g. 12" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Tooling</p>
              <input className="input" type="number" min="0" value={form.tooling_lead_time_days} onChange={set('tooling_lead_time_days')} placeholder="e.g. 15" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Production</p>
              <input className="input" type="number" min="0" value={form.production_lead_time_days} onChange={set('production_lead_time_days')} placeholder="e.g. 30" />
            </div>
          </div>
        </div>

        {/* Preferred */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="preferred" className="w-4 h-4 accent-brand-600" checked={form.is_preferred} onChange={setCheck('is_preferred')} />
          <label htmlFor="preferred" className="text-sm text-gray-700">Mark as preferred supplier for this component</label>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Any conditions, remarks, or context from the quote…" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {uploading ? 'Uploading images…' : loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Quote'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>

      {/* Copy from previous quote modal */}
      {showCopyPicker && (
        <CopyQuotePicker
          quotes={allPreviousQuotes}
          loaded={pickerLoaded}
          onSelect={applyQuote}
          onClose={() => setShowCopyPicker(false)}
        />
      )}
    </div>
  )
}

function CopyQuotePicker({ quotes, loaded, onSelect, onClose }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return quotes
    return quotes.filter(sq =>
      sq.supplier_name?.toLowerCase().includes(q) ||
      sq._componentName?.toLowerCase().includes(q) ||
      sq._productName?.toLowerCase().includes(q)
    )
  }, [quotes, search])

  // Group by supplier name
  const grouped = useMemo(() => {
    const map = {}
    for (const q of filtered) {
      const key = q.supplier_name || 'Unknown Supplier'
      if (!map[key]) map[key] = []
      map[key].push(q)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Copy from Previous Quote</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <input
            autoFocus
            type="text"
            placeholder="Search by supplier, component, or product…"
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {!loaded ? (
            <p className="text-center text-sm text-gray-400 py-10">Loading all quotes…</p>
          ) : grouped.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">No quotes found.</p>
          ) : grouped.map(([supplierName, qs]) => (
            <div key={supplierName}>
              <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                {supplierName}
              </p>
              {qs.map(q => (
                <button
                  key={q.id}
                  onClick={() => onSelect(q)}
                  className="w-full text-left px-4 py-3 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-gray-400">{q._productName} › {q._componentName}</p>
                      <p className="text-sm font-medium text-gray-800 mt-0.5">
                        {q.unit_cost != null ? `${q.unit_cost} ${q.unit_cost_currency}` : '—'}
                        {q.moq ? ` · MOQ ${q.moq.toLocaleString()}` : ''}
                      </p>
                      {(q.sampling_lead_time_days || q.production_lead_time_days) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {q.sampling_lead_time_days ? `Sample ${q.sampling_lead_time_days}d` : ''}
                          {q.sampling_lead_time_days && q.production_lead_time_days ? ' · ' : ''}
                          {q.production_lead_time_days ? `Prod ${q.production_lead_time_days}d` : ''}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-brand-600 font-medium shrink-0">Use →</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Click a quote to pre-fill the form. You can adjust before saving.
        </div>
      </div>
    </div>
  )
}

// ── Image utilities ─────────────────────────────────────────────────────────

async function resizeToJpeg(file, maxPx = 2400, quality = 0.93) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

async function preprocessForGemini(file, maxPx = 2400) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data

  // Greyscale
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = grey
  }

  // Auto-levels: clip 1% outliers and stretch to 0-255
  const greys = []
  for (let i = 0; i < data.length; i += 4) greys.push(data[i])
  greys.sort((a, b) => a - b)
  const lo = greys[Math.floor(greys.length * 0.01)]
  const hi = greys[Math.floor(greys.length * 0.99)]
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
