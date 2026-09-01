import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useOrders, getOrderLines, orderUc, ORDER_CURRENCIES } from '../shipping'
import { useCustomers, customerName } from '../domain/customer'
import { CN_STATUSES, CN_DISPOSITIONS, CN_REASONS } from '../constants'
import { UC_SOURCES } from '../ucRegistry'
import {
  emptyLine, lineAmount, cnTotals, cleanLines, validateCreditNote,
  postCreditNote, voidCreditNote, listCreditNotes, overCreditWarnings,
} from '../creditNotes'
import { fmtMoney } from '../currency'
import { Trash2, Plus, Lock } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

const blankHeader = {
  status: 'draft', record_date: today(), accounting_date: '',
  customer_id: '', customer_name: '', channel: '',
  order_id: '', original_si_no: '', original_uc_no: '', marketplace_ref: '',
  currency: 'USD', disposition: '', reason: '', remarks: '',
  accounting_amount: '', adjustment_reason: '',
  cn_no: '', uc_id: null,
}

// Credit Note editor — Sales Return / Credit Note Phase C. One combined
// entity: the goods-return details AND the accounting document, created
// together (Cindy, 2026-08-17: "there was never a sales return without
// credit note or vice versa" — matches the real JES sample, one document
// carrying both an SR-style doc number and a CN-style ref).
//
// Draft is Firestore-only and freely editable. Posting calls /api/credit-note
// (post_credit_note), which allocates the CN number and writes the permanent
// financial fact to Postgres in one transaction — after that the record is
// read-only here except for Void, matching the invoice/UC posture of never
// mutating a posted financial fact in place.
export default function CreditNoteForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { orders } = useOrders()
  const { customers } = useCustomers()

  const [header, setHeader] = useState(blankHeader)
  const [lines, setLines] = useState([emptyLine()])
  const [fetching, setFetching] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [error, setError] = useState('')

  const posted = header.status === 'posted'
  const voided = header.status === 'void'
  const locked = posted || voided   // read-only once the financial fact exists

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'credit_notes', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setHeader({ ...blankHeader, ...d })
        setLines((d.lines?.length ? d.lines : [{}]).map(l => ({ ...emptyLine(), ...l })))
      }
      setFetching(false)
    }).catch(() => setFetching(false))
  }, [id, isEdit])

  // Original order's lines (for the over-quantity check) + existing posted
  // credit notes against the same invoice (for the over-credit check).
  const [orderLines, setOrderLines] = useState([])
  const [postedElsewhere, setPostedElsewhere] = useState([])
  useEffect(() => {
    if (header.order_id) getOrderLines(header.order_id).then(setOrderLines).catch(() => setOrderLines([]))
    else setOrderLines([])
  }, [header.order_id])
  useEffect(() => {
    if (!header.original_si_no) { setPostedElsewhere([]); return }
    listCreditNotes({ si_no: header.original_si_no })
      .then(rows => setPostedElsewhere(rows.filter(r => r.status !== 'void' && r.firestore_id !== id)))
      .catch(() => setPostedElsewhere([]))
  }, [header.original_si_no, id])

  const orderedQtyByCode = useMemo(() => {
    const m = {}
    for (const l of orderLines) m[l.item_code] = (m[l.item_code] || 0) + (Number(l.qty_ordered) || 0)
    return m
  }, [orderLines])
  // Sum every OTHER posted credit note's lines against this invoice, per code.
  const postedElsewhereByCode = useMemo(() => {
    const m = {}
    for (const cn of postedElsewhere) {
      for (const l of cn.lines || []) m[l.item_code] = (m[l.item_code] || 0) + (Number(l.qty_returned) || 0)
    }
    return m
  }, [postedElsewhere])

  const invoicedOrders = useMemo(() => orders.filter(o => o.erp_si_no), [orders])

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

  const totals = cnTotals(lines)
  const systemAmount = totals.subtotal
  const accountingAmount = header.accounting_amount !== '' ? parseFloat(header.accounting_amount) : systemAmount
  const adjustment = Math.round((accountingAmount - systemAmount) * 100) / 100
  const overCredit = overCreditWarnings(lines, orderedQtyByCode, postedElsewhereByCode)

  function buildPayload() {
    const clean = cleanLines(lines)
    return {
      status: header.status,
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
      system_amount: cnTotals(clean).subtotal,
      accounting_amount: header.accounting_amount !== '' ? parseFloat(header.accounting_amount) : null,
      adjustment_reason: header.adjustment_reason.trim(),
      updatedAt: serverTimestamp(),
    }
  }

  async function handleSaveDraft(e) {
    e.preventDefault()
    setError('')
    const v = validateCreditNote(header, lines)
    if (!v.ok) { setError(v.errors.map(x => x.message).join(' · ')); return }

    setSaving(true)
    try {
      const payload = buildPayload()
      if (isEdit) {
        await updateDoc(doc(db, 'credit_notes', id), payload)
        navigate(`/credit-notes/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'credit_notes'), { ...payload, createdAt: serverTimestamp() })
        navigate(`/credit-notes/${ref.id}`)
      }
    } catch (err) {
      setError(err.message || 'Could not save this credit note.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePost(e) {
    e.preventDefault()
    setError('')
    const v = validateCreditNote(header, lines)
    if (!v.ok) { setError(v.errors.map(x => x.message).join(' · ')); return }

    setPosting(true)
    try {
      // Save the draft first so the working record matches what's about to
      // post, then allocate — same "commit before allocate" ordering the
      // invoice path uses to avoid burning a number on an unsaved form.
      const payload = buildPayload()
      let docId = id
      if (isEdit) await updateDoc(doc(db, 'credit_notes', id), payload)
      else { const ref = await addDoc(collection(db, 'credit_notes'), { ...payload, createdAt: serverTimestamp() }); docId = ref.id }

      const clean = cleanLines(lines)
      const res = await postCreditNote({
        firestoreId: docId,
        customer: header.customer_name,
        channel: header.channel,
        currency: header.currency,
        order_id: header.order_id || null,
        uc_no: header.original_uc_no || null,
        si_no: header.original_si_no || null,
        system_amount: cnTotals(clean).subtotal,
        accounting_amount: header.accounting_amount !== '' ? parseFloat(header.accounting_amount) : null,
        adjustment_reason: header.adjustment_reason || null,
        disposition: header.disposition,
        reason: header.reason,
        remarks: header.remarks,
        lines: clean,
        record_date: header.record_date || null,
        accounting_date: header.accounting_date || null,
        marketplace_ref: header.marketplace_ref || null,
      })
      await updateDoc(doc(db, 'credit_notes', docId), {
        status: 'posted', cn_no: res.cn_no, posted_cn_id: res.id, posted_at: serverTimestamp(),
      })
      navigate(`/credit-notes/${docId}`)
    } catch (err) {
      setError(err.message || 'Could not post this credit note.')
    } finally {
      setPosting(false)
    }
  }

  async function handleVoid() {
    if (!confirm(`Void credit note ${header.cn_no}? This cannot be undone.`)) return
    setVoiding(true); setError('')
    try {
      await voidCreditNote(header.posted_cn_id)
      await updateDoc(doc(db, 'credit_notes', id), { status: 'void', voidedAt: serverTimestamp() })
      setHeader(h => ({ ...h, status: 'void' }))
    } catch (err) {
      setError(err.message || 'Could not void this credit note.')
    } finally {
      setVoiding(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-6">
        <Link to="/credit-notes" className="text-sm text-brand-600 hover:underline">← Credit Notes</Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-bold text-ink">
            {header.cn_no || (isEdit ? 'Edit Credit Note' : 'New Credit Note')}
          </h1>
          {isEdit && (() => {
            const meta = CN_STATUSES.find(s => s.value === header.status) || CN_STATUSES[0]
            return <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          })()}
        </div>
        {locked && (
          <p className="text-xs text-ink-60 mt-1 inline-flex items-center gap-1">
            <Lock size={11} /> {posted ? 'Posted — this is a permanent financial fact and cannot be edited.' : 'Voided.'}
          </p>
        )}
      </div>

      <form onSubmit={handleSaveDraft} className="space-y-5">
        <fieldset disabled={locked} className="space-y-5">
          {/* ── Header ── */}
          <div className="card p-4 md:p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Record Date</label>
                <input type="date" className="input" value={header.record_date} onChange={set('record_date')} />
              </div>
              <div>
                <label className="label" title="The finance date, if different from Record Date. Blank falls back to it.">Accounting Date</label>
                <input type="date" className="input" value={header.accounting_date} onChange={set('accounting_date')} />
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
                <label className="label">Original Order <span className="text-ink-60 font-normal">(optional)</span></label>
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
                <input className="input" list="cn-customers" value={header.customer_name}
                       onChange={e => {
                         const value = e.target.value
                         const match = customers.find(c => customerName(c) === value)
                         setHeader(h => ({ ...h, customer_name: value, customer_id: match ? match.id : '' }))
                       }}
                       placeholder="Typed, or picked from Customers" />
                <datalist id="cn-customers">
                  {customers.map(c => <option key={c.id} value={customerName(c)} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Marketplace Reference <span className="text-ink-60 font-normal">(optional)</span></label>
                <input className="input" value={header.marketplace_ref} onChange={set('marketplace_ref')} placeholder="e.g. Amazon order / settlement id" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Original Invoice No.</label>
                <input className="input font-mono" value={header.original_si_no} onChange={set('original_si_no')} placeholder="e.g. SI260090" />
              </div>
              <div>
                <label className="label">Original UC#</label>
                <input className="input font-mono" value={header.original_uc_no} onChange={set('original_uc_no')} placeholder="e.g. UC4791/25" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Disposition *</label>
                <select className="input" value={header.disposition} onChange={set('disposition')}>
                  <option value="">— select —</option>
                  {CN_DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                {header.disposition && (
                  <p className="text-xs text-ink-60 mt-1">{CN_DISPOSITIONS.find(d => d.value === header.disposition)?.hint}</p>
                )}
              </div>
              <div>
                <label className="label">Reason</label>
                <select className="input" value={header.reason} onChange={set('reason')}>
                  <option value="">— select —</option>
                  {CN_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Line items ── */}
          <div className="card p-4 md:p-6">
            <h2 className="text-sm font-semibold text-ink-80 mb-3">Returned Lines</h2>
            <div className="hidden sm:grid grid-cols-[2fr_3fr_1fr_1fr_1.3fr_1.3fr_auto] gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-ink-60">
              <span>Item Code</span><span>Description</span><span className="text-right">Qty Returned</span>
              <span>Unit</span><span className="text-right">Unit Price</span><span className="text-right">Amount</span><span />
            </div>
            <div className="space-y-2">
              {lines.map(ln => {
                const ordered = orderedQtyByCode[ln.item_code]
                const elsewhere = postedElsewhereByCode[ln.item_code] || 0
                const thisQty = Number(ln.qty_returned) || 0
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
                      <div className="text-sm text-right tabular-nums text-ink-80 px-1">
                        {lineAmount(ln) ? lineAmount(ln).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                      </div>
                      <button type="button" onClick={() => removeLine(ln._uid)}
                              className="text-platinum hover:text-red-500 justify-self-end" title="Remove line">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {overQty && (
                      <p className="text-xs text-amber-600 mt-0.5 pl-1">
                        {elsewhere + thisQty} credited vs {ordered} ordered for {ln.item_code} — exceeds the original invoice line. Not blocked, just flagged.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            {!locked && (
              <button type="button" onClick={addLine} className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800">
                <Plus size={14} /> Add line
              </button>
            )}

            {overCredit.length > 0 && (
              <div className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-none px-3 py-2">
                {overCredit.length} line{overCredit.length === 1 ? '' : 's'} would credit more than the original invoice — check before posting.
              </div>
            )}

            {/* Accounting amount — what finance actually records, kept
                separate from the system-calculated total. A nonzero gap
                needs a reason (SR-05); enforced here and again server-side. */}
            <div className="mt-5 pt-4 border-t border-warm-grey flex justify-end">
              <div className="w-full sm:w-72 space-y-1.5 text-sm">
                {totals.totalQty > 0 && (
                  <div className="flex justify-between"><span className="text-ink-60">Total Qty</span><span className="tabular-nums font-medium">{totals.totalQty}</span></div>
                )}
                <div className="flex justify-between items-center pt-1 border-t border-warm-grey">
                  <span className="text-ink-60">System Amount</span>
                  <span className="tabular-nums font-medium">{fmtMoney(systemAmount, header.currency)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-ink-60" title="What finance records. Blank uses the System Amount above.">Accounting Amount</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-ink-60">{header.currency}</span>
                    <input type="number" step="0.01" className="input py-0.5 text-xs w-24 text-right font-mono"
                           value={header.accounting_amount} onChange={set('accounting_amount')}
                           placeholder={systemAmount.toFixed(2)} />
                  </div>
                </div>
                {Math.abs(adjustment) > 0.005 && (
                  <>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-amber-600">Adjustment</span>
                      <span className="font-mono text-amber-600">{adjustment > 0 ? '+' : ''}{fmtMoney(adjustment, header.currency)}</span>
                    </div>
                    <input className="input py-1 text-xs" value={header.adjustment_reason}
                           onChange={set('adjustment_reason')}
                           placeholder="Reason for the adjustment (required)" />
                  </>
                )}
                <div className="flex justify-between text-base font-semibold pt-1.5 border-t border-warm-grey">
                  <span>Total</span>
                  <span className="tabular-nums">{fmtMoney(accountingAmount, header.currency)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Remarks — prints above the signature on the credit note ── */}
          <div className="card p-4 md:p-6">
            <label className="label">Remarks</label>
            <textarea className="input" rows={2} value={header.remarks} onChange={set('remarks')}
                       placeholder="Extra message shown to the customer when this is issued" />
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          {!locked && (
            <>
              <button type="submit" className="btn-primary" disabled={saving || posting}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button type="button" className="btn-secondary" disabled={saving || posting} onClick={handlePost}>
                {posting ? 'Posting…' : 'Post Credit Note'}
              </button>
            </>
          )}
          {posted && (
            <button type="button" className="text-sm text-red-500 hover:text-red-700" disabled={voiding} onClick={handleVoid}>
              {voiding ? 'Voiding…' : 'Void this credit note'}
            </button>
          )}
          {isEdit && (
            <Link to={`/credit-notes/${id}/print`} target="_blank" rel="noreferrer" className="btn-secondary">
              Print
            </Link>
          )}
          <Link to="/credit-notes" className="btn-secondary ml-auto">Back</Link>
        </div>
      </form>
    </div>
  )
}
