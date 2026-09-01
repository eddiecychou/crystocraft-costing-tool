import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, serverTimestamp, orderBy, query } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, authHeader } from '../firebase'
import { CURRENCIES } from '../constants'
import { FolderOpen, Paperclip, FileText, X, Copy, ChevronUp, ChevronDown } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'

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
  const [volumeTiers, setVolumeTiers] = useState([]) // [{ min_qty, unit_cost }]
  const [files, setFiles]         = useState([])
  const [existingAttachments, setExistingAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [loading, setLoading]         = useState(false)
  const [fetching, setFetching]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
            setVolumeTiers(d.volume_tiers || [])
          }
        })
      )
    }

    Promise.all(loads).then(() => setFetching(false))
  }, [productId, componentId, quoteId, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }
  function setCheck(field) { return e => setForm(f => ({ ...f, [field]: e.target.checked })) }

  function addFiles(rawFiles) {
    const newFiles = rawFiles.map(file => ({
      _id: ++fileIdRef.current,
      file,
      isPdf: file.type === 'application/pdf',
      preview: file.type === 'application/pdf' ? null : URL.createObjectURL(file),
    }))
    setFiles(prev => {
      if (newFiles.length === 1 && prev.length === 0) {
        extractFromFile(newFiles[0].file)
      }
      return [...prev, ...newFiles]
    })
  }

  function handleFileChange(e) {
    addFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const raw = Array.from(e.dataTransfer.files).filter(
      f => f.type.startsWith('image/') || f.type === 'application/pdf'
    )
    if (raw.length) addFiles(raw)
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
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
    setVolumeTiers(q.volume_tiers || [])
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
        volume_tiers: volumeTiers
          .filter(t => t.min_qty !== '' && t.unit_cost !== '')
          .map(t => ({ min_qty: Number(t.min_qty), unit_cost: Number(t.unit_cost) }))
          .sort((a, b) => a.min_qty - b.min_qty),
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

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <div className="text-sm text-ink-60 mb-1">
          <Link to={`/products/${productId}`} className="hover:text-brand-600">{productName}</Link>
          {' / '}
          <Link to={`/products/${productId}/components/${componentId}`} className="hover:text-brand-600">{componentName}</Link>
        </div>
        <h1 className="text-2xl text-ink">{isEdit ? 'Edit Supplier Quote' : 'Add Supplier Quote'}</h1>
      </div>

      {/* Copy from previous quote */}
      {!isEdit && (
        <div className="flex justify-end mb-3">
          <button type="button" onClick={openCopyPicker} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Copy size={14} />Copy from Previous Quote
          </button>
        </div>
      )}

      {/* Image Upload */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm text-ink-80 mb-3">Quote Images / Screenshots</h2>
        <p className="text-xs text-ink-60 mb-3">Upload WeChat or WhatsApp screenshots — AI will try to extract the pricing data automatically.</p>

        <label
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-none p-6 cursor-pointer transition-colors
 ${dragOver ? 'border-brand-400 bg-brand-50 scale-[1.01]' : 'border-warm-grey hover:border-brand-400 hover:bg-brand-50'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="text-ink-60 mb-1">{dragOver ? <FolderOpen size={22} /> : <Paperclip size={22} />}</span>
          <span className="text-sm text-ink-70">{dragOver ? 'Drop to upload' : 'Click to upload or drag & drop'}</span>
          <span className="text-xs text-ink-60 mt-0.5">JPG, PNG, WebP, HEIC, PDF</span>
          <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleFileChange} />
        </label>

        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            {files.map(f => (
              <div key={f._id} className="flex items-center gap-3 p-2 bg-ivory rounded-none">
                {f.isPdf
                  ? <div className="w-12 h-12 rounded-none bg-red-50 border border-red-100 flex items-center justify-center shrink-0"><FileText size={20} className="text-red-400" /></div>
                  : <img src={f.preview} alt="" className="w-12 h-12 object-cover rounded-none shrink-0" />}
                <span className="text-xs text-ink-70 flex-1 truncate">{f.file.name}</span>
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
          <div className="mt-2 h-1 bg-brand-100 rounded-none overflow-hidden">
            <div className="h-full bg-brand-500 animate-pulse w-full" />
          </div>
        )}
        {extractError && <p className="text-xs text-red-500 mt-2">{extractError}</p>}
        {existingAttachments.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-ink-60 mb-1.5">Saved attachments:</p>
            <div className="flex gap-2 flex-wrap">
              {existingAttachments.map((a, i) => (
                <div key={i} className="relative group/att">
                  {a.file_type === 'pdf'
                    ? <a href={a.file_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1 rounded-none border border-red-100 bg-red-50 text-xs text-red-700 hover:bg-red-100">
                          <FileText size={14} /><span className="truncate max-w-32">{a.file_name}</span>
                        </a>
                    : <a href={a.file_url} target="_blank" rel="noreferrer">
                          <img src={a.file_url} alt="" className="w-12 h-12 object-cover rounded-none border" />
                        </a>
                  }
                  <button
                    type="button"
                    onClick={() => setExistingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full leading-none flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity"
                    title="Remove attachment"
                  ><X size={10} /></button>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-60 mt-1">Hover to remove · changes save when you click Save Changes</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Supplier — searchable combobox */}
        <div>
          <label className="label">Supplier *</label>
          <SupplierCombobox
            suppliers={suppliers}
            value={form.supplier_id}
            onChange={s => setForm(f => ({
              ...f,
              supplier_id: s ? s.id : '',
              supplier_name: s ? (s.name_cn ? `${s.name} (${s.name_cn})` : s.name) : '',
            }))}
          />
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

        {/* Volume Price Tiers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Volume Price Tiers <span className="text-ink-60 font-normal text-xs">(optional — different unit costs at higher quantities)</span></label>
            <button type="button" onClick={() => setVolumeTiers(t => [...t, { min_qty: '', unit_cost: '' }])}
              className="text-xs text-brand-600 hover:text-brand-800 font-medium">+ Add Tier</button>
          </div>
          {volumeTiers.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-ink-60 px-1">
                <span>Min Qty</span><span>Unit Cost ({form.unit_cost_currency})</span><span></span>
              </div>
              {volumeTiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <input className="input py-1.5 text-sm" type="number" min="1" placeholder="e.g. 500"
                    value={t.min_qty} onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, min_qty: e.target.value } : r))} />
                  <input className="input py-1.5 text-sm" type="number" step="0.01" min="0" placeholder="0.00"
                    value={t.unit_cost} onChange={e => setVolumeTiers(prev => prev.map((r, j) => j === i ? { ...r, unit_cost: e.target.value } : r))} />
                  <button type="button" onClick={() => setVolumeTiers(t => t.filter((_, j) => j !== i))}
                    className="text-red-300 hover:text-red-500 text-lg leading-none px-1">×</button>
                </div>
              ))}
              <p className="text-xs text-ink-60">Currency same as unit cost above. Pricing tiers will auto-select the best price for each order quantity.</p>
            </div>
          )}
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
              <p className="text-xs text-ink-60 mb-1">Sampling</p>
              <input className="input" type="number" min="0" value={form.sampling_lead_time_days} onChange={set('sampling_lead_time_days')} placeholder="e.g. 12" />
            </div>
            <div>
              <p className="text-xs text-ink-60 mb-1">Tooling</p>
              <input className="input" type="number" min="0" value={form.tooling_lead_time_days} onChange={set('tooling_lead_time_days')} placeholder="e.g. 15" />
            </div>
            <div>
              <p className="text-xs text-ink-60 mb-1">Production</p>
              <input className="input" type="number" min="0" value={form.production_lead_time_days} onChange={set('production_lead_time_days')} placeholder="e.g. 30" />
            </div>
          </div>
        </div>

        {/* Preferred */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="preferred" className="w-4 h-4 accent-brand-600" checked={form.is_preferred} onChange={setCheck('is_preferred')} />
          <label htmlFor="preferred" className="text-sm text-ink-80">Mark as preferred supplier for this component</label>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Any conditions, remarks, or context from the quote…" />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={loading}>
              {uploading ? 'Uploading images…' : loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Quote'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          </div>
          {isEdit && (
            <button
              type="button"
              className="btn-danger text-sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete Quote
            </button>
          )}
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Quote"
          message="Delete this supplier quote? This cannot be undone."
          onConfirm={async () => {
            await deleteDoc(doc(db, 'products', productId, 'components', componentId, 'supplier_quotes', quoteId))
            navigate(`/products/${productId}/components/${componentId}`)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

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

// ── Searchable supplier combobox ─────────────────────────────────────────────
function SupplierCombobox({ suppliers, value, onChange }) {
  const selected = suppliers.find(s => s.id === value) || null
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const containerRef          = useRef(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return suppliers
    const q = query.toLowerCase()
    return suppliers.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.name_cn?.toLowerCase().includes(q) ||
      s.contact_person?.toLowerCase().includes(q)
    )
  }, [suppliers, query])

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectSupplier(s) {
    onChange(s)
    setQuery('')
    setOpen(false)
  }

  function displayName(s) {
    if (!s) return ''
    return s.name_cn ? `${s.name} (${s.name_cn})` : s.name
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Input */}
      <div
        className="input flex items-center gap-2 cursor-text"
        onClick={() => { setOpen(true); setQuery('') }}
      >
        {open ? (
          <input
            autoFocus
            className="flex-1 outline-none text-sm bg-transparent"
            placeholder="Search supplier…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); selectSupplier(filtered[0]) }
            }}
          />
        ) : (
          <span className={`flex-1 text-sm truncate ${selected ? 'text-ink' : 'text-ink-60'}`}>
            {selected ? displayName(selected) : 'Select supplier…'}
          </span>
        )}
        <span className="text-ink-60 shrink-0">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </div>

      {/* Hidden required-field anchor */}
      <input
        tabIndex={-1}
        required
        value={value}
        onChange={() => {}}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-warm-grey rounded-none shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-4">No suppliers found</p>
          ) : filtered.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectSupplier(s)}
              className={`w-full text-left px-4 py-2.5 hover:bg-brand-50 transition-colors border-b border-warm-grey last:border-0 ${s.id === value ? 'bg-brand-50' : ''}`}
            >
              <p className="text-sm font-medium text-ink">{s.name}{s.name_cn ? <span className="text-ink-60 font-normal"> · {s.name_cn}</span> : ''}</p>
              {s.contact_person && <p className="text-xs text-ink-60">{s.contact_person}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Builds a stable key from the meaningful cost fields so copied/identical
// quotes collapse into a single row in the picker. Defensive: never throws —
// a malformed quote just falls back to its own id (so it shows as its own row)
// rather than breaking the whole list.
function quoteSignature(q) {
  try {
    const tiers = (Array.isArray(q.volume_tiers) ? q.volume_tiers : [])
      .map(t => `${t?.min_qty}:${t?.unit_cost}`)
      .sort()
      .join('|')
    return [
      q.supplier_id || q.supplier_name || '',
      q.unit_cost ?? '',
      q.unit_cost_currency || '',
      q.moq ?? '',
      q.tooling_sample_cost ?? '',
      q.tooling_sample_cost_currency || '',
      q.tooling_lead_time_days ?? '',
      q.sampling_lead_time_days ?? '',
      q.production_lead_time_days ?? '',
      tiers,
    ].join('§')
  } catch {
    return `__raw_${q.id}`
  }
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

  // Group by supplier name, then collapse identical quotes (same cost signature).
  // Many quotes are copied from one another, so without this the list shows
  // the same price repeated once per component it was applied to.
  const grouped = useMemo(() => {
    const map = {}
    for (const q of filtered) {
      const supplierKey = q.supplier_name || 'Unknown Supplier'
      if (!map[supplierKey]) map[supplierKey] = new Map()
      const sig = quoteSignature(q)
      const bucket = map[supplierKey]
      const existing = bucket.get(sig)
      if (!existing) {
        bucket.set(sig, { ...q, _useCount: 1 })
      } else {
        existing._useCount += 1
        // Keep the most recent doc as the representative
        if ((q.createdAt?.seconds || 0) > (existing.createdAt?.seconds || 0)) {
          const count = existing._useCount
          bucket.set(sig, { ...q, _useCount: count })
        }
      }
    }
    return Object.entries(map)
      .map(([supplierName, bucket]) => [supplierName, [...bucket.values()]])
      .sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey">
          <h2 className=" text-ink">Copy from Previous Quote</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">×</button>
        </div>

        <div className="px-4 py-3 border-b border-warm-grey">
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
            <p className="text-center text-sm text-ink-60 py-10">Loading all quotes…</p>
          ) : grouped.length === 0 ? (
            <p className="text-center text-sm text-ink-60 py-10">No quotes found.</p>
          ) : grouped.map(([supplierName, qs]) => (
            <div key={supplierName}>
              <p className="px-4 py-2 text-xs font-semibold text-ink-60 uppercase tracking-wide bg-ivory sticky top-0">
                {supplierName}
              </p>
              {qs.map(q => (
                <button
                  key={q.id}
                  onClick={() => onSelect(q)}
                  className="w-full text-left px-4 py-3 hover:bg-brand-50 transition-colors border-b border-warm-grey last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-ink-60">
                          {q._useCount > 1 ? q._componentName : `${q._productName} › ${q._componentName}`}
                        </p>
                        {q._useCount > 1 && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-ivory-dark text-ink-60 font-medium shrink-0">
                            used in {q._useCount}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-ink mt-0.5">
                        {q.unit_cost != null ? `${q.unit_cost} ${q.unit_cost_currency}` : '—'}
                        {q.moq ? ` · MOQ ${q.moq.toLocaleString()}` : ''}
                      </p>
                      {(q.sampling_lead_time_days || q.production_lead_time_days) && (
                        <p className="text-xs text-ink-60 mt-0.5">
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

        <div className="px-5 py-3 border-t border-warm-grey text-xs text-ink-60">
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
