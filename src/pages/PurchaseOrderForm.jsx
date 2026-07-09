import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents } from '../criticalComponents'
import { CURRENCIES, PO_PAYMENT_TERMS, PO_UNITS } from '../constants'
import { fmtMoney } from '../currency'
import { emptyLine, lineAmount, poTotals, cleanLines } from '../purchaseOrders'
import { Trash2, Plus } from 'lucide-react'

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
  const [fetching, setFetching] = useState(isEdit)
  const [error, setError] = useState('')

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
    })
  }, [id, isEdit])

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
    updateLine(uid, patch)
  }

  const totals = poTotals({ lines, deposit_pct: form.deposit_pct })

  async function handleSubmit(e, nextStatus) {
    e.preventDefault()
    setError('')
    if (!form.pu_number.trim()) { setError('PU number is required (copy it from the ERP).'); return }
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
      </div>

      <form onSubmit={e => handleSubmit(e)} className="space-y-5">
        {/* ── Header ── */}
        <div className="card p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">PU Number <span className="text-gray-400 font-normal">(from ERP)</span> *</label>
              <input className="input font-mono" value={form.pu_number} onChange={set('pu_number')}
                     placeholder="e.g. PU260014" />
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

          <div className="space-y-2">
            {lines.map(ln => (
              <div key={ln._uid} className="grid grid-cols-2 sm:grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 items-center">
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
    </div>
  )
}
