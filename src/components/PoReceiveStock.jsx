import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { computePoReceive, receivePo, reversePoReceive } from '../poReceive'
import { PackagePlus, RotateCcw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'

// Receive-to-stock card on the Purchase Order (V7.13a). When a PU's goods
// arrive, receive them into inventory: each line posts a receipt movement to the
// matching SKU (metal / crystal / packaging). Received qty defaults to the
// ordered qty but is editable for partial deliveries. Reversible.

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const CLASS_BADGE = { metal: 'bg-ivory text-ink-70', crystal: 'bg-brand-50 text-brand-700', packaging: 'bg-sky-50 text-sky-700' }

export default function PoReceiveStock({ po }) {
  const poId = po.id
  const poNumber = po.pu_number || po.id
  const [state, setState] = useState({ received: false, at: null, lines: [] })
  const [preview, setPreview] = useState(null)   // { items:[{...,recv}], unmatched }
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!poId) return
    return onSnapshot(doc(db, 'purchase_orders', poId), snap => {
      const d = snap.data() || {}
      setState({ received: !!d.stock_received, at: d.stock_received_at || null, lines: d.received_lines || [] })
    })
  }, [poId])

  const loadPreview = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await computePoReceive(po)
      setPreview({ ...r, items: r.items.map(it => ({ ...it, recv: String(it.qty) })) })
    } catch (e) { setError(e.message || 'Could not match lines to inventory.') }
    finally { setLoading(false) }
  }, [po])

  useEffect(() => { if (open && !state.received && !preview) loadPreview() }, [open, state.received, preview, loadPreview])

  const setRecv = (i, v) => setPreview(p => ({ ...p, items: p.items.map((it, j) => j === i ? { ...it, recv: v.replace(/[^\d]/g, '') } : it) }))

  async function doReceive() {
    const lines = (preview?.items || [])
      .map(it => ({ cls: it.cls, sku_id: it.sku_id, code: it.code, qty: Number(it.recv) }))
      .filter(l => l.qty > 0)
    if (!lines.length) { setError('Enter at least one quantity to receive.'); return }
    if (!window.confirm(`Receive ${lines.length} line(s) from PU ${poNumber} into stock?`)) return
    setBusy(true); setError('')
    try { await receivePo(poId, poNumber, lines); setPreview(null) }
    catch (e) { setError(e.message || 'Receive failed.') }
    finally { setBusy(false) }
  }
  async function doReverse() {
    if (!window.confirm(`Reverse the stock receipt for PU ${poNumber}? The received quantities are removed from stock.`)) return
    setBusy(true); setError('')
    try { await reversePoReceive(poId, poNumber) }
    catch (e) { setError(e.message || 'Reverse failed.') }
    finally { setBusy(false) }
  }

  const dateStr = state.at?.toDate ? state.at.toDate().toLocaleDateString() : null

  return (
    <div className="card p-5 mb-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-80">
          {open ? <ChevronDown size={15} className="text-ink-60" /> : <ChevronRight size={15} className="text-ink-60" />}
          Receive to stock
        </span>
        {state.received
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} /> Received{dateStr ? ` · ${dateStr}` : ''}</span>
          : <span className="text-xs text-ink-60">not received</span>}
      </button>

      {open && (
        <div className="mt-3">
          {state.received ? (
            <>
              <p className="text-xs text-ink-60 mb-2">{state.lines.length} line(s) added to stock from this PU.</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-warm-grey">
                  {state.lines.map((l, i) => (
                    <tr key={l.sku_id || i}>
                      <td className="py-1.5 pr-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CLASS_BADGE[l.cls] || ''}`}>{l.cls}</span></td>
                      <td className="py-1.5 pr-2 font-mono text-xs">{l.code}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-green-700">+{fmt(l.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" onClick={doReverse} disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                <RotateCcw size={14} /> {busy ? 'Reversing…' : 'Reverse receipt (remove from stock)'}
              </button>
            </>
          ) : loading ? (
            <p className="text-sm text-ink-60 py-3 text-center">Matching lines to inventory…</p>
          ) : preview ? (
            <>
              {preview.items.length === 0 ? (
                <p className="text-sm text-ink-60 py-2">No PU lines match an inventory SKU by code. Add the SKUs in Components / Crystal Stock / Packaging Stock first.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-ink-60 text-left border-b border-warm-grey">
                          <th className="py-1.5 pr-2 font-medium">Class</th>
                          <th className="py-1.5 pr-2 font-medium">Code</th>
                          <th className="py-1.5 pr-2 font-medium">Name</th>
                          <th className="py-1.5 pr-2 font-medium text-right">In stock</th>
                          <th className="py-1.5 pr-2 font-medium text-right">Ordered</th>
                          <th className="py-1.5 font-medium text-right">Receive</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-warm-grey">
                        {preview.items.map((it, i) => (
                          <tr key={`${it.cls}:${it.sku_id}`}>
                            <td className="py-1.5 pr-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CLASS_BADGE[it.cls] || ''}`}>{it.cls}</span></td>
                            <td className="py-1.5 pr-2 font-mono text-xs">{it.code}</td>
                            <td className="py-1.5 pr-2 text-xs text-ink-60 truncate max-w-[180px]">{it.name || '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-60">{fmt(it.stock)}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-60">{fmt(it.qty)}</td>
                            <td className="py-1.5 text-right">
                              <input className="input py-1 text-xs w-20 text-right tabular-nums" inputMode="numeric"
                                value={it.recv} onChange={e => setRecv(i, e.target.value)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={doReceive} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 btn-primary text-sm">
                    <PackagePlus size={14} /> {busy ? 'Receiving…' : 'Receive to stock'}
                  </button>
                </>
              )}
              {preview.unmatched?.length > 0 && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>{preview.unmatched.length} line(s) not in inventory — won’t be received: {preview.unmatched.map(u => u.code).join(', ')}. Add them as an SKU first.</div>
                </div>
              )}
            </>
          ) : null}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
