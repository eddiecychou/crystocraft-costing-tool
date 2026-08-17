import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useOrders, getOrderLines, orderUc, ORDER_CURRENCIES } from '../shipping'
import { useCustomers, customerName } from '../domain/customer'
import { SR_STATUSES, SR_DISPOSITIONS, SR_REASONS } from '../constants'
import { UC_SOURCES } from '../ucRegistry'
import { emptyLine, lineAmount, srTotals, cleanLines, validateSalesReturn } from '../salesReturns'
import { allocateSrNo } from '../srNumber'
import { fmtMoney } from '../currency'
import { Trash2, Plus } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

const blankHeader = {
  sr_no: '', status: 'draft', record_date: today(), accounting_date: '',
  customer_id: '', customer_name: '', channel: '',
  order_id: '', original_si_no: '', original_uc_no: '', marketplace_ref: '',
  currency: 'USD', disposition: '', reason: '', remarks: '',
}

// Sales Return editor — Phase B of the Sales Return / Credit Note work. Records
// what came back and its physical disposition; deliberately does NOT post a
// stock movement (see SR_DISPOSITIONS in constants.js) and does NOT allocate a
// Credit Note (Phase C — pending Cindy's numbering/UC-policy decisions).
export default function SalesReturnForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { orders } = useOrders()
  const { customers } = useCustomers()

  const [header, setHeader] = useState(blankHeader)
  const [lines, setLines] = useState([emptyLine()])
  const [fetching, setFetching] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [allocating, setAllocating] = useState(false)
  const [srError, setSrError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'sales_returns', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setHeader({ ...blankHeader, ...d, sr_no: d.sr_no || '' })
        setLines((d.lines?.length ? d.lines : [{}]).map(l => ({ ...emptyLine(), ...l })))
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [id, isEdit])

  // Existing returns against the SAME order, for the over-quantity check below
  // — excludes this SR itself when editing, and any already cancelled.
  const [orderLines, setOrderLines] = useState([])
  const [returnedElsewhere, setReturnedElsewhere] = useState({})
  useEffect(() => {
    if (!header.order_id) { setOrderLines([]); setReturnedElsewhere({}); return }
    let alive = true
    Promise.all([
      getOrderLines(header.order_id),
      getDocs(query(collection(db, 'sales_returns'), where('order_id', '==', header.order_id))),
    ]).then(([ls, snap]) => {
      if (!alive) return
      setOrderLines(ls)
      const byCode = {}
      snap.docs.forEach(d => {
        if (d.id === id) return
        const data = d.data()
        if (data.status === 'cancelled') return
        for (const l of data.lines || []) {
          byCode[l.item_code] = (byCode[l.item_code] || 0) + (Number(l.qty_returned) || 0)
        }
      })
      setReturnedElsewhere(byCode)
    })
    return () => { alive = false }
  }, [header.order_id, id])

  const orderedQtyByCode = useMemo(() => {
    const m = {}
    for (const l of orderLines) m[l.item_code] = (m[l.item_code] || 0) + (Number(l.qty_ordered) || 0)
    return m
  }, [orderLines])

  // Invoiced orders only — an un-invoiced order has nothing to return against.
  const invoicedOrders = useMemo(() => orders.filter(o => o.erp_si_no), [orders])

  async function doAllocate() {
    setAllocating(true); setSrError('')
    try {
      const no = await allocateSrNo()
      setHeader(h => ({ ...h, sr_no: no }))
    } catch (e) {
      setSrError(e.message || 'Could not allocate an SR number.')
    } finally {
      setAllocating(false)
    }
  }

  // Denormalise the picked order's own references onto the return — a return
  // must survive the source order being edited later, same reasoning as the
  // PO's supplier snapshot.
  function pickOrder(orderId) {
    const o = orders.find(x => x.id === orderId)
    setHeader(h => ({
      ...h, order_id: orderId,
      customer_id: o?.customer_id || h.customer_id,
      customer_name: o?.customer_name || h.customer_name,
      currency: o?.currency || h.currency,
      original_si_no: o?.erp_si_no || h.original_si_no,
      original_uc_no: orderUc(o) || h.original_uc_no,
    }))
  }

  const set = field => e => setHeader(h => ({ ...h, [field]: e.target.value }))
  const updateLine = (uid, patch) => setLines(ls => ls.map(l => l._uid === uid ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, emptyLine()])
  const removeLine = uid => setLines(ls => ls.length > 1 ? ls.filter(l => l._uid !== uid) : ls)

  const totals = srTotals(lines)

  async function handleSave(e, nextStatus) {
    e.preventDefault()
    setError('')
    const v = validateSalesReturn(header, lines)
    if (!v.ok) { setError(v.errors.map(x => x.message).join(' · ')); return }

    setSaving(true)
    try {
      const clean = cleanLines(lines)
      const payload = {
        sr_no: header.sr_no.trim(),
        status: nextStatus || header.status,
        record_date: header.record_date || '',
        accounting_date: header.accounting_date || '',
        customer_id: header.customer_id || '',
        customer_name: header.customer_name.trim(),
        channel: header.channel,
        order_id: header.order_id || '',
        original_si_no: header.original_si_no.trim(),
        original_uc_no: header.original_uc_no.trim(),
        marketplace_ref: header.marketplace_ref.trim(),
        currency: header.currency,
        disposition: header.disposition,
        reason: header.reason,
        remarks: header.remarks.trim(),
        lines: clean,
        subtotal: srTotals(clean).subtotal,
        updatedAt: serverTimestamp(),
      }
      if (isEdit) {
        await updateDoc(doc(db, 'sales_returns', id), payload)
        navigate(`/sales-returns/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'sales_returns'), { ...payload, createdAt: serverTimestamp() })
        navigate(`/sales-returns/${ref.id}`)
      }
    } catch (err) {
      setError(err.message || 'Could not save this return.')
    } finally {
      setSaving(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-6">
        <Link to="/sales-returns" className="text-sm text-brand-600 hover:underline">← Sales Returns</Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Sales Return' : 'New Sales Return'}</h1>
          {isEdit && (() => {
            const meta = SR_STATUSES.find(s => s.value === header.status) || SR_STATUSES[0]
            return <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          })()}
        </div>
      </div>

      <form onSubmit={e => handleSave(e)} className="space-y-5">
        {/* ── Header ── */}
        <div className="card p-4 md:p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label flex items-center justify-between gap-2">
                <span>SR Number</span>
                {!header.sr_no && (
                  <button type="button" onClick={doAllocate} disabled={allocating}
                          className="text-[11px] text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case"
                          title="Allocate the next SR number in the app's own series.">
                    {allocating ? 'Allocating…' : 'Allocate'}
                  </button>
                )}
              </label>
              <input className="input font-mono" value={header.sr_no} onChange={set('sr_no')} placeholder="e.g. SR260001" />
              {srError && <p className="text-xs text-red-600 mt-1">{srError}</p>}
            </div>
            <div>
              <label className="label">Record Date</label>
              <input type="date" className="input" value={header.record_date} onChange={set('record_date')} />
            </div>
            <div>
              <label className="label" title="The finance date, if different from Record Date. Blank falls back to it.">Accounting Date</label>
              <input type="date" className="input" value={header.accounting_date} onChange={set('accounting_date')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Original Order <span className="text-gray-400 font-normal">(optional)</span></label>
              <select className="input" value={header.order_id} onChange={e => pickOrder(e.target.value)}>
                <option value="">— none / not in the app —</option>
                {invoicedOrders.map(o => (
                  <option key={o.id} value={o.id}>{o.erp_si_no} · {o.customer_name || 'Unnamed'}{orderUc(o) ? ` · ${orderUc(o)}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Channel</label>
              <select className="input" value={header.channel} onChange={set('channel')}>
                <option value="">— select —</option>
                {UC_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Customer Name</label>
              <input className="input" list="sr-customers" value={header.customer_name}
                     onChange={e => {
                       const value = e.target.value
                       const match = customers.find(c => customerName(c) === value)
                       setHeader(h => ({ ...h, customer_name: value, customer_id: match ? match.id : '' }))
                     }}
                     placeholder="Typed, or picked from Customers" />
              <datalist id="sr-customers">
                {customers.map(c => <option key={c.id} value={customerName(c)} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Marketplace Reference <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className="input" value={header.marketplace_ref} onChange={set('marketplace_ref')} placeholder="e.g. Amazon order / settlement id" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Original Invoice No.</label>
              <input className="input font-mono" value={header.original_si_no} onChange={set('original_si_no')} placeholder="e.g. SI260090" />
            </div>
            <div>
              <label className="label">Original UC#</label>
              <input className="input font-mono" value={header.original_uc_no} onChange={set('original_uc_no')} placeholder="e.g. UC4791/25" />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={header.currency} onChange={set('currency')}>
                {ORDER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Disposition *</label>
              <select className="input" value={header.disposition} onChange={set('disposition')}>
                <option value="">— select —</option>
                {SR_DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {header.disposition && (
                <p className="text-xs text-gray-400 mt-1">{SR_DISPOSITIONS.find(d => d.value === header.disposition)?.hint}</p>
              )}
            </div>
            <div>
              <label className="label">Reason</label>
              <select className="input" value={header.reason} onChange={set('reason')}>
                <option value="">— select —</option>
                {SR_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Line items ── */}
        <div className="card p-4 md:p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Returned Lines</h2>
          <div className="hidden sm:grid grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
            <span>Item Code</span><span>Description</span><span className="text-right">Qty Returned</span>
            <span>Unit</span><span className="text-right">Unit Price</span><span className="text-right">Amount</span><span />
          </div>
          <div className="space-y-2">
            {lines.map(ln => {
              const ordered = orderedQtyByCode[ln.item_code]
              const elsewhere = returnedElsewhere[ln.item_code] || 0
              const thisQty = Number(ln.qty_returned) || 0
              // Excessive-quantity check: only meaningful once linked to an
              // order whose lines we can actually compare against.
              const overQty = header.order_id && ln.item_code && ordered != null && (elsewhere + thisQty) > ordered
              return (
                <div key={ln._uid}>
                  <div className="grid grid-cols-2 sm:grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 items-center">
                    <input className="input text-sm font-mono" value={ln.item_code}
                           onChange={e => updateLine(ln._uid, { item_code: e.target.value })} placeholder="Item code" />
                    <input className="input text-sm" value={ln.description}
                           onChange={e => updateLine(ln._uid, { description: e.target.value })} placeholder="Description" />
                    <input className="input text-sm text-right tabular-nums" inputMode="decimal" value={ln.qty_returned}
                           onChange={e => updateLine(ln._uid, { qty_returned: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                    <input className="input text-sm" value={ln.unit}
                           onChange={e => updateLine(ln._uid, { unit: e.target.value })} placeholder="pcs" />
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
                  {overQty && (
                    <p className="text-xs text-amber-600 mt-0.5 pl-1">
                      {elsewhere + thisQty} returned vs {ordered} ordered for {ln.item_code} — check against other returns on this order.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <button type="button" onClick={addLine} className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800">
            <Plus size={14} /> Add line
          </button>

          <div className="mt-5 pt-4 border-t border-gray-100 flex justify-end">
            <div className="w-full sm:w-64 space-y-1.5 text-sm">
              {totals.totalQty > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Total Qty</span><span className="tabular-nums font-medium">{totals.totalQty}</span></div>
              )}
              <div className="flex justify-between text-base font-semibold pt-1 border-t border-gray-100">
                <span>Subtotal</span>
                <span className="tabular-nums">{fmtMoney(totals.subtotal, header.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Remarks ── */}
        <div className="card p-4 md:p-6">
          <label className="label">Remarks</label>
          <textarea className="input" rows={2} value={header.remarks} onChange={set('remarks')}
                     placeholder="Any additional context for this return" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Draft'}
          </button>
          {header.status !== 'approved' && (
            <button type="button" className="btn-secondary" disabled={saving} onClick={e => handleSave(e, 'approved')}
                    title="Marks this return approved. Does not post any stock movement — disposition is a record, not a ledger entry (see the note above).">
              Save &amp; Approve
            </button>
          )}
          {isEdit && header.status !== 'cancelled' && (
            <button type="button" className="text-sm text-red-500 hover:text-red-700 ml-auto"
                    disabled={saving} onClick={e => handleSave(e, 'cancelled')}>
              Cancel this return
            </button>
          )}
          <Link to="/sales-returns" className="btn-secondary">Back</Link>
        </div>
      </form>
    </div>
  )
}
