import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { usePackaging } from '../packaging'
import { issuePackagingForOrder, reversePackagingIssue } from '../orderStock'
import { Box, Plus, Trash2, RotateCcw, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'

// Order → packaging issue card (V7.13a packaging). Manual, batch-per-order at
// pack time — packaging has no per-product BOM, so the operator picks the
// materials + actual quantities this order used. Order-tagged and reversible.

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const newLine = () => ({ _uid: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), packaging_id: '', qty: '' })

export default function OrderPackagingIssue({ orderId, orderLabel }) {
  const { packaging } = usePackaging()
  const [state, setState] = useState({ issued: false, at: null, lines: [] })
  const [rows, setRows] = useState([newLine()])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      const d = snap.data() || {}
      setState({ issued: !!d.packaging_issued, at: d.packaging_issued_at || null, lines: d.packaging_issued_lines || [] })
    })
  }, [orderId])

  const byId = Object.fromEntries(packaging.map(c => [c.id, c]))
  const setRow = (uid, patch) => setRows(rs => rs.map(r => r._uid === uid ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, newLine()])
  const removeRow = uid => setRows(rs => rs.length > 1 ? rs.filter(r => r._uid !== uid) : rs)

  async function doIssue() {
    const lines = rows
      .filter(r => r.packaging_id && Number(r.qty) > 0)
      .map(r => ({ packaging_id: r.packaging_id, code: byId[r.packaging_id]?.code || '', qty: Number(r.qty) }))
    if (!lines.length) { setError('Add at least one packaging item and quantity.'); return }
    if (!window.confirm(`Issue ${lines.length} packaging line(s) for order ${orderLabel}? This deducts from packaging stock.`)) return
    setBusy(true); setError('')
    try { await issuePackagingForOrder(orderId, orderLabel, lines); setRows([newLine()]) }
    catch (e) { setError(e.message || 'Issue failed.') }
    finally { setBusy(false) }
  }
  async function doReverse() {
    if (!window.confirm(`Reverse the packaging issue for order ${orderLabel}? Items go back to stock.`)) return
    setBusy(true); setError('')
    try { await reversePackagingIssue(orderId, orderLabel) }
    catch (e) { setError(e.message || 'Reverse failed.') }
    finally { setBusy(false) }
  }

  const issuedDate = state.at?.toDate ? state.at.toDate().toLocaleDateString() : null

  return (
    <div className="card p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {open ? <ChevronDown size={15} className="text-ink-40" /> : <ChevronRight size={15} className="text-ink-40" />}
          <Box size={14} className="text-brand-400" /> Packaging stock
        </span>
        {state.issued
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} /> Issued{issuedDate ? ` · ${issuedDate}` : ''}</span>
          : <span className="text-xs text-ink-40">not issued</span>}
      </button>

      {open && (
        <div className="mt-3">
          {state.issued ? (
            <>
              <p className="text-xs text-ink-50 mb-2">{state.lines.length} packaging line(s) deducted for this order.</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {state.lines.map((l, i) => (
                    <tr key={l.packaging_id || i}>
                      <td className="py-1.5 pr-2"><span className="font-mono text-xs">{l.code || byId[l.packaging_id]?.code || l.packaging_id}</span>{byId[l.packaging_id]?.type ? <span className="text-ink-50"> · {byId[l.packaging_id].type}</span> : ''}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-red-600">−{fmt(l.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" onClick={doReverse} disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                <RotateCcw size={14} /> {busy ? 'Reversing…' : 'Reverse issue (return to stock)'}
              </button>
            </>
          ) : packaging.length === 0 ? (
            <p className="text-sm text-ink-50 py-2">No packaging in stock yet — add it in Components → Packaging Stock first.</p>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map(r => {
                  const c = byId[r.packaging_id]
                  const stock = c && Number.isFinite(c.stock_qty) ? c.stock_qty : null
                  const after = stock != null && r.qty !== '' ? stock - Number(r.qty) : null
                  return (
                    <div key={r._uid} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <select className="input text-sm flex-1" value={r.packaging_id} onChange={e => setRow(r._uid, { packaging_id: e.target.value })}>
                        <option value="">— pick packaging —</option>
                        {packaging.map(x => <option key={x.id} value={x.id}>{x.code}{x.type ? ` · ${x.type}` : ''}{x.name ? ` · ${x.name}` : ''}</option>)}
                      </select>
                      <div className="flex gap-2 items-center">
                        <input className="input text-sm w-24 text-right tabular-nums" inputMode="numeric" value={r.qty}
                               onChange={e => setRow(r._uid, { qty: e.target.value.replace(/[^\d]/g, '') })} placeholder="Qty" />
                        <span className="text-[11px] text-ink-50 w-28 shrink-0">
                          {stock != null ? <>stock {fmt(stock)}{after != null ? <> → <span className={after < 0 ? 'text-red-600 font-semibold' : ''}>{fmt(after)}</span></> : ''}</> : ''}
                        </span>
                        <button type="button" onClick={() => removeRow(r._uid)} className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800">
                  <Plus size={14} /> Add packaging
                </button>
                <button type="button" onClick={doIssue} disabled={busy} className="btn-primary text-sm ml-auto">
                  {busy ? 'Issuing…' : 'Issue packaging to stock'}
                </button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
