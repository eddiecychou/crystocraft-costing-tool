import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents } from '../criticalComponents'
import { CURRENCIES, PO_PAYMENT_TERMS, PO_UNITS } from '../constants'
import { fmtMoney } from '../currency'
import { emptyLine, lineAmount, poTotals, cleanLines, linkedComponentIds } from '../purchaseOrders'
import ComponentLinkPicker from '../components/ComponentLinkPicker'
import { Trash2, Plus, FileInput, FolderOpen, FileText, Link2, X } from 'lucide-react'

const PO_TERM_VALUES = PO_PAYMENT_TERMS.map(t => t.value)

// Base64-encode a file (or blob) for the Gemini extraction endpoint.
async function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const today = () => new Date().toISOString().slice(0, 10)

// Snapshot the supplier fields we print, so the PO is stable if the supplier is
// later edited or deleted.
function snapshotSupplier(s) {
  if (!s) return {}
  return {
    supplier_id: s.id,
    supplier_name: s.name || '',
    supplier_name_cn: s.name_cn || '',
    supplier_erp_code: s.erp_code || '',
    supplier_address: s.address || '',
    supplier_contact: s.contact_person || '',
  }
}

export default function PurchaseOrderForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fromId = params.get('from')   // duplicate/reorder source
  const { components } = useComponents()

  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState({
    pu_number: '', supplier_id: '', issued_date: today(), est_ship_date: '',
    currency: 'RMB', payment_terms: '', payment_terms_custom: '', deposit_pct: '',
    ship_to: '', status: 'draft', remarks: '',
  })
  const [lines, setLines] = useState([emptyLine()])
  const [supplierSnap, setSupplierSnap] = useState({})
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEdit || Boolean(fromId))
  const [dupFromPU, setDupFromPU] = useState('')   // source PU no. when duplicating
  const [error, setError] = useState('')

  // PDF/image extraction state
  const [pendingFile, setPendingFile] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [linkingUid, setLinkingUid] = useState(null)   // line _uid whose picker is open

  // Load supplier list for the picker.
  useEffect(() => {
    getDocs(query(collection(db, 'suppliers'), orderBy('name'))).then(snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
  }, [])

  // Load existing PO for editing.
  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'purchase_orders', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm(f => ({ ...f,
          pu_number: d.pu_number || '', supplier_id: d.supplier_id || '',
          issued_date: d.issued_date || '', est_ship_date: d.est_ship_date || '',
          currency: d.currency || 'RMB', payment_terms: d.payment_terms || '',
          payment_terms_custom: d.payment_terms_custom || '', deposit_pct: d.deposit_pct ?? '',
          ship_to: d.ship_to || '', status: d.status || 'draft', remarks: d.remarks || '',
        }))
        setLines((d.lines?.length ? d.lines : [{}]).map(ln => ({ ...emptyLine(), ...ln })))
        setSupplierSnap(snapshotSupplier({ id: d.supplier_id, name: d.supplier_name, name_cn: d.supplier_name_cn, erp_code: d.supplier_erp_code, address: d.supplier_address, contact_person: d.supplier_contact }))
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [id, isEdit])

  // Duplicate / reorder from ?from=<id> — copies supplier, lines, currency and
  // terms, but resets the PU number (ERP assigns a new one), dates, status, and
  // PO-specific remarks so it starts as a clean draft.
  useEffect(() => {
    if (isEdit || !fromId) return
    getDoc(doc(db, 'purchase_orders', fromId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setDupFromPU(d.pu_number || '')
        setForm(f => ({ ...f,
          pu_number: '', supplier_id: d.supplier_id || '',
          issued_date: today(), est_ship_date: '',
          currency: d.currency || 'RMB', payment_terms: d.payment_terms || '',
          payment_terms_custom: d.payment_terms_custom || '', deposit_pct: d.deposit_pct ?? '',
          ship_to: d.ship_to || '', status: 'draft', remarks: '',
        }))
        setLines((d.lines?.length ? d.lines : [{}]).map(ln => ({ ...emptyLine(), ...ln })))
        setSupplierSnap(snapshotSupplier({ id: d.supplier_id, name: d.supplier_name, name_cn: d.supplier_name_cn, erp_code: d.supplier_erp_code, address: d.supplier_address, contact_person: d.supplier_contact }))
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [fromId, isEdit])

  // Preselect supplier from ?supplier=<id> (new PO from a supplier page).
  useEffect(() => {
    const sid = params.get('supplier')
    if (!sid || isEdit || !suppliers.length || form.supplier_id) return
    pickSupplier(sid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers])

  function pickSupplier(sid) {
    const s = suppliers.find(x => x.id === sid)
    setForm(f => ({
      ...f,
      supplier_id: sid,
      // Only auto-fill currency/terms when the supplier has a default AND the
      // user hasn't already picked (don't clobber an in-progress edit).
      currency: s?.default_currency || f.currency,
      payment_terms: s?.default_payment_terms || f.payment_terms,
    }))
    setSupplierSnap(snapshotSupplier(s))
  }

  // ── Parse an old PO from a PDF/image via Gemini vision ──────────────────────
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/') || x.type === 'application/pdf')
    if (f) importFile(f)
  }

  async function importFile(file) {
    setPendingFile(file)
    setExtracting(true); setExtractError('')
    try {
      const base64 = await toBase64(file)
      const mimeType = file.type === 'application/pdf' ? 'application/pdf' : (file.type || 'image/png')
      const res = await fetch('/api/extract-po', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()

      // Match the extracted supplier: ERP code first, then fuzzy name (EN or CN).
      let match = null
      const code = (data.supplier_code || '').trim().toLowerCase()
      if (code) match = suppliers.find(s => (s.erp_code || '').trim().toLowerCase() === code)
      if (!match && data.supplier_name) {
        const lower = data.supplier_name.toLowerCase()
        match = suppliers.find(s => {
          const n = (s.name || '').toLowerCase()
          return n && (lower.includes(n) || n.includes(lower))
        })
      }
      if (!match && data.supplier_name_cn) {
        match = suppliers.find(s => (s.name_cn || '') && (s.name_cn.includes(data.supplier_name_cn) || data.supplier_name_cn.includes(s.name_cn)))
      }
      if (match) setSupplierSnap(snapshotSupplier(match))

      const cur = CURRENCIES.includes(data.currency) ? data.currency : null
      const terms = PO_TERM_VALUES.includes(data.payment_terms) ? data.payment_terms : null

      setForm(f => ({
        ...f,
        pu_number: data.pu_number || f.pu_number,
        supplier_id: match ? match.id : f.supplier_id,
        issued_date: data.issued_date || f.issued_date,
        est_ship_date: data.est_ship_date || f.est_ship_date,
        currency: cur || match?.default_currency || f.currency,
        payment_terms: terms || match?.default_payment_terms || f.payment_terms,
        deposit_pct: data.deposit_pct != null ? String(data.deposit_pct) : f.deposit_pct,
      }))

      const mapped = (data.lines || []).map(ln => ({
        ...emptyLine(),
        code: ln.item_code || '',
        description: ln.description || '',
        qty: ln.qty != null ? String(ln.qty) : '',
        unit: PO_UNITS.includes(ln.unit) ? ln.unit : 'pcs',
        unit_price: ln.unit_price != null ? String(ln.unit_price) : '',
      }))
      if (mapped.length) setLines(mapped)

      // Surface anything the operator still needs to resolve.
      const notes = []
      if (!mapped.length) notes.push('No line items found — add them manually.')
      if (!match && (data.supplier_name || data.supplier_code)) {
        notes.push(`Supplier “${data.supplier_name || data.supplier_code}” not matched — pick it above or add it first.`)
      }
      setExtractError(notes.join(' '))
    } catch {
      setExtractError('Could not read this PO — fill the header and add lines manually.')
    } finally {
      setExtracting(false)
    }
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }
  const updateLine = (uid, patch) => setLines(ls => ls.map(l => l._uid === uid ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, emptyLine()])
  const removeLine = uid => setLines(ls => ls.length > 1 ? ls.filter(l => l._uid !== uid) : ls)

  // When a line's code matches a known component, offer to fill the description.
  const compByCode = useMemo(() => {
    const m = new Map()
    components.forEach(c => { if (c.code) m.set(c.code.toUpperCase(), c) })
    return m
  }, [components])

  function onCodeChange(uid, code) {
    const match = compByCode.get(code.trim().toUpperCase())
    const line = lines.find(l => l._uid === uid)
    // Autofill description only if it's currently empty (never overwrite typing).
    const patch = { code }
    if (match && !line.description) patch.description = match.name || ''
    // Auto-link a figurine component when the code matches — free linkage for
    // coded/shared parts (boxes, stones). Never clobber a manual link.
    if (match && !line.linked) patch.linked = { type: 'range', component_id: match.id, label: match.code }
    updateLine(uid, patch)
  }

  const totals = poTotals({ lines, deposit_pct: form.deposit_pct })

  async function handleSubmit(e, nextStatus) {
    e.preventDefault()
    setError('')
    // PU number is optional at any status — "Issued" here means sent to the
    // supplier, which can happen before the order is keyed into the ERP at
    // month-end. The PU number gets typed in later, whenever it's assigned.
    if (!form.supplier_id) { setError('Select a supplier.'); return }
    const clean = cleanLines(lines)
    if (!clean.length) { setError('Add at least one line item.'); return }

    setLoading(true)
    try {
      const t = poTotals({ lines, deposit_pct: form.deposit_pct })
      const payload = {
        pu_number: form.pu_number.trim(),
        ...supplierSnap,
        issued_date: form.issued_date || '',
        est_ship_date: form.est_ship_date || '',
        currency: form.currency,
        payment_terms: form.payment_terms,
        payment_terms_custom: form.payment_terms_custom.trim(),
        deposit_pct: form.deposit_pct === '' ? null : Number(form.deposit_pct),
        ship_to: form.ship_to.trim(),
        status: nextStatus || form.status,
        remarks: form.remarks.trim(),
        lines: clean,
        linked_component_ids: linkedComponentIds(clean),
        subtotal: t.subtotal,
        total: t.balance,      // amount actually payable after any deposit split
        updatedAt: serverTimestamp(),
      }
      if (isEdit) {
        await updateDoc(doc(db, 'purchase_orders', id), payload)
        navigate(`/purchase-orders/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'purchase_orders'), { ...payload, createdAt: serverTimestamp() })
        navigate(`/purchase-orders/${ref.id}`)
      }
    } catch (err) {
      setError(err.message || 'Failed to save.')
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-6">
        <Link to="/purchase-orders" className="text-sm text-brand-600 hover:underline">← Purchase Orders</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}</h1>
        {dupFromPU && !isEdit && (
          <p className="text-sm text-gray-500 mt-1">Reordered from <span className="font-mono text-gray-700">{dupFromPU}</span> — enter the new PU number from the ERP.</p>
        )}
      </div>

      <form onSubmit={e => handleSubmit(e)} className="space-y-5">
        {/* ── Parse an old PO (import only) ── */}
        {!isEdit && (
          <div className="card p-4">
            <label
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
                ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50'}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
              <span className="text-gray-500 mb-1">{dragOver ? <FolderOpen size={22} /> : <FileInput size={22} />}</span>
              <span className="text-sm text-gray-600">{dragOver ? 'Drop to import' : 'Upload an old PO to auto-fill (PDF or image)'}</span>
              <span className="text-xs text-gray-400 mt-0.5">Reads the ERP PU sheet — you still type/confirm the PU number. PDF, JPG, PNG</span>
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

        {/* ── Header ── */}
        <div className="card p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">PU Number <span className="text-gray-400 font-normal">(from ERP — leave blank until assigned, add it later)</span></label>
              <input className="input font-mono" value={form.pu_number} onChange={set('pu_number')}
                     placeholder="e.g. PU260014 — or leave blank for now" />
            </div>
            <div>
              <label className="label">Supplier *</label>
              <select className="input" value={form.supplier_id} onChange={e => pickSupplier(e.target.value)}>
                <option value="">— select supplier —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.erp_code ? `[${s.erp_code}] ` : ''}{s.name}{s.name_cn ? ` · ${s.name_cn}` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="label">Issued Date</label>
              <input type="date" className="input" value={form.issued_date} onChange={set('issued_date')} />
            </div>
            <div>
              <label className="label">Est. Ship Date</label>
              <input type="date" className="input" value={form.est_ship_date} onChange={set('est_ship_date')} />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.currency} onChange={set('currency')}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Deposit %</label>
              <input className="input text-right tabular-nums" inputMode="decimal" value={form.deposit_pct}
                     onChange={e => setForm(f => ({ ...f, deposit_pct: e.target.value.replace(/[^\d.]/g, '') }))}
                     placeholder="0" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Payment Terms</label>
              <select className="input" value={form.payment_terms} onChange={set('payment_terms')}>
                <option value="">— none —</option>
                {PO_PAYMENT_TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Terms Note <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className="input" value={form.payment_terms_custom} onChange={set('payment_terms_custom')}
                     placeholder="e.g. balance on delivery" />
            </div>
          </div>

          <div>
            <label className="label">Ship To <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input" value={form.ship_to} onChange={set('ship_to')}
                   placeholder="Blank = default Crystocraft warehouse" />
          </div>
        </div>

        {/* ── Line items ── */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <span className="text-xs text-gray-400">Type a component code (autocompletes) or free text for MISC items.</span>
          </div>

          <datalist id="po-component-codes">
            {components.slice(0, 500).map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
          </datalist>

          {/* Column headers — desktop */}
          <div className="hidden sm:grid grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
            <span>Item Code</span><span>Description</span><span className="text-right">Qty</span>
            <span>Unit</span><span className="text-right">Unit Price</span><span className="text-right">Amount</span><span />
          </div>

          <div className="space-y-3">
            {lines.map(ln => (
              <div key={ln._uid} className="space-y-1">
                <div className="grid grid-cols-2 sm:grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 items-center">
                  <input className="input text-sm font-mono" list="po-component-codes" value={ln.code}
                         onChange={e => onCodeChange(ln._uid, e.target.value)} placeholder="P-… / FM-… / MISC" />
                  <input className="input text-sm" value={ln.description}
                         onChange={e => updateLine(ln._uid, { description: e.target.value })} placeholder="Description" />
                  <input className="input text-sm text-right tabular-nums" inputMode="decimal" value={ln.qty}
                         onChange={e => updateLine(ln._uid, { qty: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                  <select className="input text-sm" value={ln.unit} onChange={e => updateLine(ln._uid, { unit: e.target.value })}>
                    {PO_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <input className="input text-sm text-right tabular-nums" inputMode="decimal" value={ln.unit_price}
                         onChange={e => updateLine(ln._uid, { unit_price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0.00" />
                  <div className="text-sm text-right tabular-nums text-gray-700 px-1">
                    {lineAmount(ln) ? lineAmount(ln).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </div>
                  <button type="button" onClick={() => removeLine(ln._uid)}
                          className="text-gray-300 hover:text-red-500 justify-self-end" title="Remove line">
                    <Trash2 size={15} />
                  </button>
                </div>
                {/* Optional component link — surfaces this actual price on that component */}
                <div className="flex items-center gap-2 pl-1 text-xs">
                  {ln.linked?.component_id ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
                      <Link2 size={12} />
                      <span className="truncate max-w-[220px]">{ln.linked.label || 'Linked component'}</span>
                      <span className="text-brand-400">· {ln.linked.type === 'range' ? 'Figurine' : 'Corp'}</span>
                      <button type="button" onClick={() => updateLine(ln._uid, { linked: null })}
                              className="text-brand-400 hover:text-red-500" title="Unlink"><X size={12} /></button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setLinkingUid(ln._uid)}
                            className="inline-flex items-center gap-1 text-gray-400 hover:text-brand-600">
                      <Link2 size={12} /> Link component <span className="text-gray-300">(optional)</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addLine} className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800">
            <Plus size={14} /> Add line
          </button>

          {/* Totals */}
          <div className="mt-5 pt-4 border-t border-gray-100 flex justify-end">
            <div className="w-full sm:w-72 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="tabular-nums font-medium">{fmtMoney(totals.subtotal, form.currency)}</span></div>
              {totals.deposit > 0 && (
                <div className="flex justify-between text-gray-500"><span>Deposit ({form.deposit_pct}%)</span><span className="tabular-nums">− {fmtMoney(totals.deposit, form.currency)}</span></div>
              )}
              <div className="flex justify-between text-base font-semibold pt-1 border-t border-gray-100">
                <span>{totals.deposit > 0 ? 'Balance' : 'Total'}</span>
                <span className="tabular-nums">{fmtMoney(totals.balance, form.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Remarks ── */}
        <div className="card p-6">
          <label className="label">Remarks</label>
          <textarea className="input" rows={2} value={form.remarks} onChange={set('remarks')}
                    placeholder="Deposit paid, delivery notes, etc." />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Draft'}
          </button>
          {form.status !== 'issued' && (
            <button type="button" className="btn-secondary" disabled={loading}
                    onClick={e => handleSubmit(e, 'issued')}>
              Save &amp; mark Issued
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>

      {linkingUid && (
        <ComponentLinkPicker
          onClose={() => setLinkingUid(null)}
          onPick={picked => { updateLine(linkingUid, { linked: picked }); setLinkingUid(null) }}
        />
      )}
    </div>
  )
}
