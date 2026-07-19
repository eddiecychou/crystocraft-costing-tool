import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { computeOrderIssue, reserveForOrder, produceForOrder, releaseForOrder, reverseProduceForOrder, metalOrderConfig } from '../orderStock'
import { gapsOf } from '../orderStockStatus'
import { Lock, Factory, RotateCcw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'

// Order → component stock card (V7.13a R1). Two-stage, matching the ERP:
// Reserve at confirmation (allocated, on-hand unchanged) → Production-in when
// built (consumed). Both reversible. Metal lines come from the BOM explosion.

const cfg = metalOrderConfig
const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')

export default function OrderStockIssue({ orderId, orderLabel }) {
  const [state, setState] = useState({ stage: 'open', at: null, lines: [], gaps: { missing: [], unmatched: [], count: 0 } })
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      const d = snap.data() || {}
      const o = cfg.order
      const committed = !!d[o.committed] || !!d[o.legacyIssued]
      const reserved = !!d[o.reserved]
      const stage = committed ? 'committed' : reserved ? 'reserved' : 'open'
      const at = committed ? (d[o.committedAt] || d[`${o.legacyIssued}_at`] || null) : reserved ? d[o.reservedAt] : null
      const lines = (d[o.lines]?.length ? d[o.lines] : d[o.legacyLines]) || []
      setState({ stage, at, lines, gaps: gapsOf(d, cfg) })
    })
  }, [orderId])

  const loadPreview = useCallback(async () => {
    setLoading(true); setError('')
    try { setPreview(await computeOrderIssue(orderId)) }
    catch (e) { setError(e.message || 'Could not compute requirements.') }
    finally { setLoading(false) }
  }, [orderId])

  useEffect(() => { if (open && state.stage === 'open' && !preview) loadPreview() }, [open, state.stage, preview, loadPreview])

  async function run(fn, confirmMsg, after) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true); setError('')
    try { await fn(); if (after) after() }
    catch (e) { setError(e.message || 'Action failed.') }
    finally { setBusy(false) }
  }

  const doReserve = () => {
    const lines = (preview?.items || []).map(it => ({ component_id: it.component_id, code: it.code, qty: it.required }))
    const gaps = { missing: preview?.missing || [], unmatched: preview?.unmatched || [] }
    const gapCount = gaps.missing.length + gaps.unmatched.length
    run(() => reserveForOrder(cfg, orderId, orderLabel, lines, gaps),
      `Reserve components for order ${orderLabel}? Stock is allocated to this order (still physically on hand).`
        + (gapCount ? `\n\n${gapCount} line(s) CANNOT be reserved and will be recorded as a gap on this order.` : ''),
      () => setPreview(null))
  }
  const doProduce = () => run(() => produceForOrder(cfg, orderId, orderLabel),
    `Production-in for order ${orderLabel}? This consumes the reserved components into finished goods.`)
  const doRelease = () => run(() => releaseForOrder(cfg, orderId, orderLabel),
    `Release the reservation for order ${orderLabel}? Components return to free stock.`)
  const doReverse = () => run(() => reverseProduceForOrder(cfg, orderId, orderLabel),
    `Reverse production-in for order ${orderLabel}? Consumed components return to stock.`)

  const dateStr = state.at?.toDate ? state.at.toDate().toLocaleDateString() : null

  return (
    <div className="card p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {open ? <ChevronDown size={15} className="text-ink-40" /> : <ChevronRight size={15} className="text-ink-40" />}
          Component stock
        </span>
        <StageChip stage={state.stage} dateStr={dateStr} gapCount={state.gaps.count} />
      </button>

      {open && (
        <div className="mt-3">
          {state.stage !== 'open' && <GapNotice gaps={state.gaps} />}
          {state.stage === 'committed' ? (
            <>
              <p className="text-xs text-ink-50 mb-2">{state.lines.length} component(s) consumed (production-in) for this order.</p>
              <LinesTable lines={state.lines} />
              <button type="button" onClick={doReverse} disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                <RotateCcw size={14} /> {busy ? 'Reversing…' : 'Reverse production-in (return to stock)'}
              </button>
            </>
          ) : state.stage === 'reserved' ? (
            <>
              <p className="text-xs text-ink-50 mb-2">{state.lines.length} component(s) reserved — on the line, not yet consumed.</p>
              <LinesTable lines={state.lines} />
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button type="button" onClick={doProduce} disabled={busy} className="inline-flex items-center gap-1.5 btn-primary text-sm">
                  <Factory size={14} /> {busy ? 'Working…' : 'Production-in (consume)'}
                </button>
                <button type="button" onClick={doRelease} disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                  <RotateCcw size={14} /> Release reservation
                </button>
              </div>
            </>
          ) : loading ? (
            <p className="text-sm text-ink-40 py-3 text-center">Computing requirements…</p>
          ) : preview ? (
            <>
              {preview.items.length === 0 ? (
                <p className="text-sm text-ink-50 py-2">No metal-component BOM to reserve on this order.</p>
              ) : (
                <>
                  <PreviewTable items={preview.items} />
                  <button type="button" onClick={doReserve} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 btn-primary text-sm">
                    <Lock size={14} /> {busy ? 'Reserving…' : 'Reserve components'}
                  </button>
                </>
              )}
              {(preview.missing?.length > 0 || preview.unmatched?.length > 0) && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    {preview.missing?.length > 0 && <p>{preview.missing.length} BOM part(s) not in the component ledger — won’t be reserved: {preview.missing.map(m => m.code).join(', ')}.</p>}
                    {preview.unmatched?.length > 0 && <p>{preview.unmatched.length} figurine line(s) not matched to the Range — no BOM to reserve.</p>}
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

function StageChip({ stage, dateStr, gapCount }) {
  // A gap outranks the stage: "produced-in, but 2 parts were never reserved" is
  // the state that used to be indistinguishable from a clean one.
  if (gapCount > 0) return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
      <AlertTriangle size={13} /> {stage === 'committed' ? 'Produced-in' : 'Reserved'} · {gapCount} gap{gapCount > 1 ? 's' : ''}
    </span>
  )
  if (stage === 'committed') return <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} /> Produced-in{dateStr ? ` · ${dateStr}` : ''}</span>
  if (stage === 'reserved') return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Lock size={12} /> Reserved{dateStr ? ` · ${dateStr}` : ''}</span>
  // Not a hint — this is the state that quietly drifts stock, so it reads as one.
  return <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium"><AlertTriangle size={13} /> not recorded</span>
}

// The gaps recorded at reserve time, shown for as long as the reservation
// lives. Before V7.16 this existed only in the pre-reserve preview.
function GapNotice({ gaps }) {
  if (!gaps?.count) return null
  return (
    <div className="mb-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{gaps.count} line(s) were never reserved — this order's consumption is incomplete.</p>
        {gaps.missing.length > 0 && <p className="mt-0.5">Not in the component ledger: {gaps.missing.map(m => m.code).join(', ')}.</p>}
        {gaps.unmatched.length > 0 && <p className="mt-0.5">Not matched to the Range: {gaps.unmatched.map(u => u.label).join(', ')}.</p>}
      </div>
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
            <th className="py-1.5 font-medium text-right">After reserve</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map(it => (
            <tr key={it.component_id}>
              <td className="py-1.5 pr-2"><span className="font-mono text-xs">{it.code}</span>{it.name ? <span className="text-ink-50"> · {it.name}</span> : ''}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-amber-700">{fmt(it.required)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-60">{fmt(it.inStock)}</td>
              <td className={`py-1.5 text-right font-mono tabular-nums ${it.after < 0 ? 'text-red-600 font-semibold' : 'text-green-700'}`}>{fmt(it.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LinesTable({ lines }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-50">
          {lines.map((l, i) => (
            <tr key={l.component_id || i}>
              <td className="py-1.5 pr-2"><span className="font-mono text-xs">{l.code}</span></td>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink-70">{fmt(l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
