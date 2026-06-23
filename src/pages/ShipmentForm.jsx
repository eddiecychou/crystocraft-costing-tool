import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import {
  INCOTERMS, ORDER_STATUSES, LINE_TYPES, lineTypeOf, isPackable,
  getOrder, getOrderLines, createOrderWithLines, updateOrder, saveOrderLines, deleteOrder,
  loadRangeProductsLite, autoMatchLines, matchRangeProduct,
} from '../shipping'
import { CURRENCIES } from '../constants'
import { FileInput, FolderOpen, FileText, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'

const blankHeader = {
  customer_id: '', customer_name: '', erp_pi_no: '', erp_so_no: '', order_date: '',
  currency: 'USD', incoterm: 'FOB', status: 'draft',
  destination: { country: '', city: '', address: '', port: '' }, notes: '',
}

export default function ShipmentForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [header, setHeader]   = useState(() => {
    const preCustomerId = searchParams.get('customer_id')
    return preCustomerId ? { ...blankHeader, customer_id: preCustomerId } : blankHeader
  })
  const [lines, setLines]     = useState([])
  const [customers, setCustomers] = useState([])
  const [rangeProducts, setRangeProducts] = useState([])
  const [sourceFile, setSourceFile] = useState(null)   // { url, name } existing
  const [pendingFile, setPendingFile] = useState(null) // File to upload on create

  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const preCustomerId = searchParams.get('customer_id')
    const loads = [
      getDocs(query(collection(db, 'customers'), orderBy('name'))).then(s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() }))
        setCustomers(list)
        // Resolve customer name when pre-filled from URL
        if (preCustomerId && !isEdit) {
          const c = list.find(x => x.id === preCustomerId)
          if (c) setHeader(h => ({ ...h, customer_name: c.name_cn ? `${c.name} (${c.name_cn})` : c.name }))
        }
      }),
      loadRangeProductsLite().then(setRangeProducts),
    ]
    if (isEdit) {
      loads.push((async () => {
        const o = await getOrder(id)
        if (o) {
          setHeader({
            customer_id: o.customer_id, customer_name: o.customer_name,
            erp_pi_no: o.erp_pi_no, erp_so_no: o.erp_so_no || '',
            order_date: o.order_date || '',
            currency: o.currency, incoterm: o.incoterm, status: o.status,
            destination: { ...blankHeader.destination, ...o.destination }, notes: o.notes,
          })
          setSourceFile(o.source_file || null)
          setLines(await getOrderLines(id))
        }
      })())
    }
    Promise.all(loads).finally(() => setFetching(false))
  }, [id, isEdit])

  const setH = field => e => setHeader(h => ({ ...h, [field]: e.target.value }))
  const setDest = field => e => setHeader(h => ({ ...h, destination: { ...h.destination, [field]: e.target.value } }))

  function onCustomer(e) {
    const c = customers.find(x => x.id === e.target.value)
    setHeader(h => ({
      ...h, customer_id: e.target.value,
      customer_name: c ? (c.name_cn ? `${c.name} (${c.name_cn})` : c.name) : h.customer_name,
      incoterm: c?.default_incoterm && INCOTERMS.includes(c.default_incoterm) ? c.default_incoterm : h.incoterm,
      destination: c ? {
        country: c.country || h.destination.country,
        city: c.city || h.destination.city,
        address: c.address || h.destination.address,
        port: h.destination.port,
      } : h.destination,
    }))
  }

  // ── PI extraction ──────────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/') || x.type === 'application/pdf')
    if (f) importFile(f)
  }

  async function importFile(file) {
    setPendingFile(file)
    setExtracting(true); setExtractError('')
    try {
      let base64, mimeType
      if (file.type === 'application/pdf') { base64 = await toBase64(file); mimeType = 'application/pdf' }
      else { base64 = await toBase64(await preprocessForGemini(file)); mimeType = 'image/png' }
      const res = await fetch('/api/extract-pi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()

      setHeader(h => ({
        ...h,
        erp_pi_no: data.pi_no || h.erp_pi_no,
        erp_so_no: data.so_no || h.erp_so_no,
        customer_name: h.customer_id ? h.customer_name : (data.customer_name || h.customer_name),
        order_date: data.order_date || h.order_date,
        currency: ['USD', 'EUR', 'RMB', 'HKD'].includes(data.currency) ? data.currency : h.currency,
        incoterm: INCOTERMS.includes(data.incoterm) ? data.incoterm : h.incoterm,
      }))
      const matched = autoMatchLines(data.lines || [], rangeProducts)
      setLines(matched)
      if (!matched.length) setExtractError('No line items found — check the file or add lines manually.')
    } catch {
      setExtractError('Could not read this PI — fill in the header and add lines manually.')
    } finally {
      setExtracting(false)
    }
  }

  // ── Line editing / reconciliation ────────────────────────────────────────────
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))

  function classify(i, type) {
    const l = lines[i]
    // Switching to figurine re-runs the match; other types clear the product ref.
    if (type === 'range') {
      const p = l.item_code ? matchRangeProduct(l.item_code, rangeProducts) : null
      setLine(i, {
        line_type: 'range', packable: true,
        matched_product_ref: p ? { collection: 'range_products', id: p.id, name: p.name } : null,
        match_status: p ? 'manual' : 'unmatched',
      })
    } else {
      setLine(i, { line_type: type, packable: isPackable(type), matched_product_ref: null, match_status: 'manual' })
    }
  }

  function addBlankLine() {
    setLines(ls => [...ls, {
      line_no: ls.length + 1, item_code: '', description: '', qty_ordered: '',
      unit: 'pcs', unit_price: '', line_type: null, packable: true, match_status: 'manual',
    }])
  }
  const removeLine = i => setLines(ls => ls.filter((_, j) => j !== i))

  const unclassified = lines.filter(l => !l.line_type).length

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      // Upload PI under a stable import path first, then anchor it on the order.
      let sf = null
      if (pendingFile) {
        const r = storageRef(storage, `orders/imports/${Date.now()}_${pendingFile.name}`)
        await uploadBytes(r, pendingFile, { contentType: pendingFile.type || 'application/octet-stream' })
        sf = { url: await getDownloadURL(r), name: pendingFile.name }
      }
      const orderId = await createOrderWithLines(
        { ...header, source: 'imported_pi', source_file: sf },
        lines,
      )
      navigate(`/shipments/${orderId}`)
    } catch (err) {
      setExtractError(err.message || 'Could not create shipment.')
      setSaving(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setExtractError('')
    try {
      await updateOrder(id, {
        customer_id: header.customer_id, customer_name: header.customer_name,
        erp_pi_no: header.erp_pi_no, erp_so_no: header.erp_so_no,
        order_date: header.order_date || null,
        currency: header.currency, incoterm: header.incoterm, status: header.status,
        destination: header.destination, notes: header.notes,
      })
      await saveOrderLines(id, lines)
      navigate('/shipments')
    } catch (err) {
      setExtractError(err.message || 'Could not save shipment.')
    } finally {
      setSaving(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-6">
        <Link to="/shipments" className="text-sm text-brand-600 hover:underline">← Shipments</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Shipment' : 'Import Proforma Invoice'}</h1>
        {!isEdit && <p className="text-sm text-gray-500 mt-1">Upload a figurine PI — AI reads the header + line items, then you classify each line.</p>}
      </div>

      <form onSubmit={isEdit ? handleSave : handleCreate} className="space-y-5">
        {/* PI upload (import only) */}
        {!isEdit && (
          <div className="card p-4">
            <label
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
                ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50'}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
              <span className="text-gray-500 mb-1">{dragOver ? <FolderOpen size={22} /> : <FileInput size={22} />}</span>
              <span className="text-sm text-gray-600">{dragOver ? 'Drop to import' : 'Click to upload or drag & drop a PI (PDF or image)'}</span>
              <span className="text-xs text-gray-400 mt-0.5">PDF, JPG, PNG</span>
              <input type="file" accept="image/*,.pdf" className="hidden"
                     onChange={e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = '' }} />
            </label>
            {pendingFile && (
              <div className="flex items-center gap-2 mt-3 text-xs text-gray-600">
                <FileText size={14} className="text-red-400" /> {pendingFile.name}
              </div>
            )}
            {extracting && <div className="mt-2 h-1 bg-brand-100 rounded overflow-hidden"><div className="h-full bg-brand-500 animate-pulse w-full" /></div>}
            {extractError && <p className="text-xs text-amber-600 mt-2">{extractError}</p>}
          </div>
        )}

        {/* Header */}
        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Customer</label>
              <select className="input" value={header.customer_id} onChange={onCustomer}>
                <option value="">{header.customer_name || '— select customer —'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.name_cn ? ` (${c.name_cn})` : ''}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">PI Number</label>
                <input className="input" value={header.erp_pi_no} onChange={setH('erp_pi_no')} placeholder="e.g. PI-2025-0481" />
              </div>
              <div>
                <label className="label">SO / Doc No</label>
                <input className="input" value={header.erp_so_no} onChange={setH('erp_so_no')} placeholder="e.g. SO260017" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="label">Order Date</label>
              <input className="input" type="date" value={header.order_date} onChange={setH('order_date')} />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={header.currency} onChange={setH('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="label">Incoterm</label>
              <select className="input" value={header.incoterm} onChange={setH('incoterm')}>{INCOTERMS.map(t => <option key={t}>{t}</option>)}</select>
            </div>
            {isEdit && (
              <div>
                <label className="label">Status</label>
                <select className="input" value={header.status} onChange={setH('status')}>{ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Dest. Country</label><input className="input" value={header.destination.country} onChange={setDest('country')} placeholder="Germany" /></div>
            <div><label className="label">Dest. City</label><input className="input" value={header.destination.city} onChange={setDest('city')} placeholder="Hamburg" /></div>
            <div><label className="label">Port (optional)</label><input className="input" value={header.destination.port} onChange={setDest('port')} placeholder="Hamburg" /></div>
          </div>
          {sourceFile && (
            <a href={sourceFile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
              <FileText size={13} /> {sourceFile.name || 'View source PI'}
            </a>
          )}
        </div>

        {/* Reconciliation */}
        {(lines.length > 0 || isEdit) && (
          <div className="card p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Line items &amp; reconciliation</h2>
              <button type="button" onClick={addBlankLine} className="text-xs text-brand-600 hover:text-brand-800">+ Add line</button>
            </div>

            {unclassified > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} />
                {unclassified} line{unclassified > 1 ? 's' : ''} still need a type. Classify every line before packing.
              </div>
            )}

            <div className="space-y-2">
              {lines.map((l, i) => {
                const t = l.line_type ? lineTypeOf(l.line_type) : null
                return (
                  <div key={i} className={`rounded-lg border p-3 ${l.line_type ? 'border-gray-200' : 'border-amber-200 bg-amber-50/40'}`}>
                    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-start">
                      <div className="text-xs text-gray-400 pt-2 w-6">{l.line_no ?? i + 1}</div>
                      <div className="min-w-0 space-y-2">
                        <div className="grid grid-cols-[140px_1fr] gap-2">
                          <input className="input py-1.5 text-sm font-mono" value={l.item_code} onChange={e => setLine(i, { item_code: e.target.value })} placeholder="Item code" />
                          <input className="input py-1.5 text-sm" value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Description" />
                        </div>
                        <div className="flex gap-2 items-center">
                          <input className="input py-1.5 text-sm w-24" type="number" value={l.qty_ordered ?? ''} onChange={e => setLine(i, { qty_ordered: e.target.value })} placeholder="Qty" />
                          <input className="input py-1.5 text-sm w-20" value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} placeholder="pcs" />
                          <input className="input py-1.5 text-sm w-28" type="number" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(i, { unit_price: e.target.value })} placeholder="Unit price" />
                          {l.matched_product_ref && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 truncate">
                              <CheckCircle2 size={13} /> {l.matched_product_ref.name || 'matched'}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {LINE_TYPES.map(lt => (
                            <button key={lt.value} type="button" onClick={() => classify(i, lt.value)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                l.line_type === lt.value ? lt.style + ' border-current' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}>
                              {lt.label}
                            </button>
                          ))}
                          {t && !t.packable && <span className="text-[11px] text-gray-400 self-center ml-1">excluded from packing</span>}
                        </div>
                      </div>
                      <button type="button" onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 pt-2"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="btn-primary" disabled={saving || (!isEdit && lines.length === 0)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Shipment'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate('/shipments')}>Cancel</button>
          {isEdit && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700">
              <Trash2 size={15} /> Delete shipment
            </button>
          )}
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog title="Delete shipment" message="Delete this shipment and all its lines? This cannot be undone."
          onConfirm={async () => { await deleteOrder(id); navigate('/shipments') }}
          onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  )
}

// ── Image utilities (mirror RangeQuoteForm) ──────────────────────────────────
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
