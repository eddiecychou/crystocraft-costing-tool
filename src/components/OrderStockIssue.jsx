import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { computeOrderIssue, issueOrder, reverseOrderIssue } from '../orderStock'
import { PackageMinus, RotateCcw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'

// Order → component stock issue card (V7.13a step 2). Deliberate, reversible:
// deducts this order's metal-component BOM from the ledger when the operator
// says production drew the parts. Reuses the MRP explosion (orderStock.js).

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')

export default function OrderStockIssue({ orderId, orderLabel }) {
  const [issuedState, setIssuedState] = useState({ issued: false, at: null, lines: [] })
  const [preview, setPreview] = useState(null)   // { items, missing, unmatched } | null
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  // Live issued-state from the order doc, so it reflects issue/reverse instantly.
  useEffect(() => {
    if (!orderId) return
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      const d = snap.data() || {}
      setIssuedState({ issued: !!d.components_issued, at: d.components_issued_at || null, lines: d.issued_lines || [] })
    })
  }, [orderId])

  const loadPreview = useCallback(async () => {
    setLoading(true); setError('')
    try { setPreview(await computeOrderIssue(orderId)) }
    catch (e) { setError(e.message || 'Could not compute requirements.') }
    finally { setLoading(false) }
  }, [orderId])

  // Compute the preview when the operator expands the card (before issuing).
  useEffect(() => { if (open && !issuedState.issued && !preview) loadPreview() }, [open, issuedState.issued, preview, loadPreview])

  async function doIssue() {
    if (!window.confirm(`Issue components for order ${orderLabel}? This deducts the figurine BOM from component stock.`)) return
    setBusy(true); setError('')
    try { await issueOrder(orderId, orderLabel); setPreview(null) }
    catch (e) { setError(e.message || 'Issue failed.') }
    finally { setBusy(false) }
  }
  async function doReverse() {
    if (!window.confirm(`Reverse the component issue for order ${orderLabel}? Parts go back to stock.`)) return
    setBusy(true); setError('')
    try { await reverseOrderIssue(orderId, orderLabel) }
    catch (e) { setError(e.message || 'Reverse failed.') }
    finally { setBusy(false) }
  }

  const issuedDate = issuedState.at?.toDate ? issuedState.at.toDate().toLocaleDateString() : null

  return (
    <div className="card p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {open ? <ChevronDown size={15} className="text-ink-40" /> : <ChevronRight size={15} className="text-ink-40" />}
          Component stock
        </span>
        {issuedState.issued
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} /> Issued{issuedDate ? ` · ${issuedDate}` : ''}</span>
          : <span className="text-xs text-ink-40">not issued</span>}
      </button>

      {open && (
        <div className="mt-3">
          {issuedState.issued ? (
            <>
              <p className="text-xs text-ink-50 mb-2">
                {issuedState.lines.length} component{issuedState.lines.length === 1 ? '' : 's'} deducted from stock for this order.
              </p>
              <IssuedTable lines={issuedState.lines} />
              <button type="button" onClick={doReverse} disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                <RotateCcw size={14} /> {busy ? 'Reversing…' : 'Reverse issue (return to stock)'}
              </button>
            </>
          ) : loading ? (
            <p className="text-sm text-ink-40 py-3 text-center">Computing requirements…</p>
          ) : preview ? (
            <>
              {preview.items.length === 0 ? (
                <p className="text-sm text-ink-50 py-2">No metal-component BOM to issue on this order (figurine lines with critical components required).</p>
              ) : (
                <>
                  <PreviewTable items={preview.items} />
                  <button type="button" onClick={doIssue} disabled={busy}
                    className="mt-3 inline-flex items-center gap-1.5 btn-primary text-sm">
                    <PackageMinus size={14} /> {busy ? 'Issuing…' : 'Issue components to stock'}
                  </button>
                </>
              )}
              {(preview.missing?.length > 0 || preview.unmatched?.length > 0) && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    {preview.missing?.length > 0 && <p>{preview.missing.length} BOM part(s) not in the component ledger — won’t be deducted: {preview.missing.map(m => m.code).join(', ')}.</p>}
                    {preview.unmatched?.length > 0 && <p>{preview.unmatched.length} figurine line(s) not matched to the Range — no BOM to deduct.</p>}
                  </div>
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

function PreviewTable({ items }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-ink-40 text-left border-b border-ivory-dark">
            <th className="py-1.5 pr-2 font-medium">Component</th>
            <th className="py-1.5 pr-2 font-medium text-right">Need</th>
            <th className="py-1.5 pr-2 font-medium text-right">In stock</th>
            <th className="py-1.5 font-medium text-right">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map(it => (
            <tr key={it.component_id}>
              <td className="py-1.5 pr-2"><span className="font-mono text-xs">{it.code}</span>{it.name ? <span className="text-ink-50"> · {it.name}</span> : ''}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-red-600">−{fmt(it.required)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-60">{fmt(it.inStock)}</td>
              <td className={`py-1.5 text-right font-mono tabular-nums ${it.after < 0 ? 'text-red-600 font-semibold' : 'text-ink-80'}`}>{fmt(it.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IssuedTable({ lines }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-50">
          {lines.map((l, i) => (
            <tr key={l.component_id || i}>
              <td className="py-1.5 pr-2"><span className="font-mono text-xs">{l.code}</span></td>
              <td className="py-1.5 text-right font-mono tabular-nums text-red-600">−{fmt(l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
