import { formatOcDate } from '../ocTime.js'
import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { reserveForOrder, produceForOrder, releaseForOrder, reverseProduceForOrder, adjustReservedLine, addReservedLine } from '../orderStock'
import EditableQty from './EditableQty'
import ConfirmDialog from './ConfirmDialog'
import { Gem, Box, Lock, Factory, Plus, Trash2, RotateCcw, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'

// Generic order → inventory card (crystals, packaging) — V7.13a R1. Two-stage,
// batch-per-order: at Reserve the operator picks SKUs + actual quantities (no
// BOM); Production-in consumes them. Both reversible. Driven by an `inv` config.

const ICONS = { gem: Gem, box: Box }
const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const newLine = () => ({ _uid: 'il_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), item_id: '', qty: '' })

export default function OrderInventoryIssue({ orderId, orderLabel, inv }) {
  const { items } = inv.useItems()
  const [state, setState] = useState({ stage: 'open', at: null, lines: [] })
  const [rows, setRows] = useState([newLine()])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addition, setAddition] = useState({ item_id: '', qty: '' })
  const [pendingAddition, setPendingAddition] = useState(null)
  const Icon = ICONS[inv.iconKey] || Box
  const idField = inv.order.lineIdField

  useEffect(() => {
    setAddition({ item_id: '', qty: '' }); setPendingAddition(null); setError('')
  }, [orderId, inv.collectionPath])

  useEffect(() => {
    if (!orderId) return
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      const d = snap.data() || {}
      const o = inv.order
      const committed = !!d[o.committed] || !!d[o.legacyIssued]
      const reserved = !!d[o.reserved]
      const stage = committed ? 'committed' : reserved ? 'reserved' : 'open'
      const at = committed ? (d[o.committedAt] || null) : reserved ? d[o.reservedAt] : null
      const lines = (d[o.lines]?.length ? d[o.lines] : d[o.legacyLines]) || []
      setState({ stage, at, lines })
    })
  }, [orderId, inv.order])

  const byId = Object.fromEntries(items.map(c => [c.id, c]))
  const setRow = (uid, patch) => setRows(rs => rs.map(r => r._uid === uid ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, newLine()])
  const removeRow = uid => setRows(rs => rs.length > 1 ? rs.filter(r => r._uid !== uid) : rs)

  async function run(fn, confirmMsg, after) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true); setError('')
    try { await fn(); if (after) after() }
    catch (e) { setError(e.message || 'Action failed.') }
    finally { setBusy(false) }
  }

  const doReserve = () => {
    const lines = rows.filter(r => r.item_id && Number(r.qty) > 0)
      .map(r => ({ [idField]: r.item_id, code: byId[r.item_id]?.code || '', qty: Number(r.qty) }))
    if (!lines.length) { setError('Add at least one item and quantity.'); return }
    run(() => reserveForOrder(inv, orderId, orderLabel, lines),
      `Reserve ${lines.length} ${inv.noun} line(s) for order ${orderLabel}? Stock is allocated (still on hand).`,
      () => setRows([newLine()]))
  }
  const doProduce = () => run(() => produceForOrder(inv, orderId, orderLabel),
    `Production-in for order ${orderLabel}? This consumes the reserved ${inv.nounPlural}.`)
  const doRelease = () => run(() => releaseForOrder(inv, orderId, orderLabel),
    `Release the reservation for order ${orderLabel}? Items return to free stock.`)
  const doReverse = () => run(() => reverseProduceForOrder(inv, orderId, orderLabel),
    `Reverse production-in for order ${orderLabel}? Consumed items return to stock.`)
  const doAdjust = (lineId, code, newQty) => run(
    () => adjustReservedLine(inv, orderId, orderLabel, lineId, newQty),
    `Change the reserved quantity for ${code} to ${fmt(newQty)}? The difference is reserved or released on the ${inv.noun} ledger.`)

  const reservedIds = new Set(state.lines.map(l => l[idField]))
  const additionalItems = items.filter(item => !reservedIds.has(item.id))
  const selectedAddition = byId[addition.item_id]
  const additionQty = Number(addition.qty)
  const validAddition = !!selectedAddition && !reservedIds.has(addition.item_id) && Number.isSafeInteger(additionQty) && additionQty > 0
  const additionAvailable = selectedAddition ? (Number(selectedAddition.stock_qty) || 0) - (Number(selectedAddition.reserved_qty) || 0) : null
  function reviewAddition() {
    if (!validAddition || busy) return
    setPendingAddition({ component_id: addition.item_id, code: selectedAddition.code || '', qty: additionQty })
  }
  function confirmAddition() {
    const next = pendingAddition
    setPendingAddition(null)
    if (!next) return
    run(() => addReservedLine(inv, orderId, orderLabel, next), null,
      () => setAddition({ item_id: '', qty: '' }))
  }

  const dateStr = state.at?.toDate ? formatOcDate(state.at.toDate(), {}) : null

  return (
    <div className="card p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-80">
          {open ? <ChevronDown size={15} className="text-ink-60" /> : <ChevronRight size={15} className="text-ink-60" />}
          <Icon size={14} className="text-brand-400" /> {inv.cardTitle} stock
        </span>
        {state.stage === 'committed'
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} /> Produced-in{dateStr ? ` · ${dateStr}` : ''}</span>
          : state.stage === 'reserved'
            ? <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Lock size={12} /> Reserved{dateStr ? ` · ${dateStr}` : ''}</span>
            : <span className="text-xs text-ink-60">not used on this order</span>}
      </button>

      {open && (
        <div className="mt-3">
          {state.stage !== 'open' ? (
            <>
              <p className="text-xs text-ink-60 mb-2">
                {state.lines.length} line(s) {state.stage === 'committed' ? 'consumed (production-in)' : 'reserved — on the line, not yet consumed'}.
              </p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-warm-grey">
                  {state.lines.map((l, i) => (
                    <tr key={l[idField] || i}>
                      <td className="py-1.5 pr-2"><span className="font-mono text-xs">{l.code || byId[l[idField]]?.code || l[idField]}</span>{byId[l[idField]]?.[inv.attrField] ? <span className="text-ink-60"> · {byId[l[idField]][inv.attrField]}</span> : ''}</td>
                      <td className="py-1.5 text-right">
                        {state.stage === 'reserved'
                          ? <EditableQty value={l.qty} busy={busy}
                                         onSave={n => doAdjust(l[idField], l.code || byId[l[idField]]?.code || l[idField], n)} />
                          : <span className="font-mono tabular-nums text-ink-70">{fmt(l.qty)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.stage === 'reserved' && additionalItems.length > 0 && (
                <div className="mt-3 border-t border-warm-grey pt-3">
                  <p className="text-xs text-ink-60 mb-2">Add another item to this reservation. Existing reserved quantities stay in place.</p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <select className="input text-sm flex-1 min-w-0" aria-label={`Additional ${inv.noun}`} disabled={busy}
                      value={addition.item_id} onChange={e => setAddition(a => ({ ...a, item_id: e.target.value }))}>
                      <option value="">— pick —</option>
                      {additionalItems.map(x => <option key={x.id} value={x.id}>{x.code}{x[inv.attrField] ? ` · ${x[inv.attrField]}` : ''}{x.name ? ` · ${x.name}` : ''}</option>)}
                    </select>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input className="input text-sm w-24 text-right tabular-nums" aria-label={`Additional ${inv.noun} quantity`}
                        disabled={busy} inputMode="numeric" value={addition.qty} placeholder="Qty"
                        onChange={e => setAddition(a => ({ ...a, qty: e.target.value.replace(/[^\d]/g, '') }))} />
                      <span className="text-2xs text-ink-60 w-28 shrink-0">
                        {additionAvailable != null && <>avail {fmt(additionAvailable)}{addition.qty !== '' && <> → <span className={additionAvailable - additionQty < 0 ? 'text-brand-600 font-semibold' : ''}>{fmt(additionAvailable - additionQty)}</span></>}</>}
                      </span>
                      <button type="button" onClick={reviewAddition} disabled={busy || !validAddition}
                        className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50">
                        <Plus size={14} /> Add to reservation
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {state.stage === 'reserved' ? (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={doProduce} disabled={busy} className="inline-flex items-center gap-1.5 btn-primary text-sm">
                    <Factory size={14} /> {busy ? 'Working…' : 'Production-in (consume)'}
                  </button>
                  <button type="button" onClick={doRelease} disabled={busy} className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                    <RotateCcw size={14} /> Release reservation
                  </button>
                </div>
              ) : (
                <button type="button" onClick={doReverse} disabled={busy}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 disabled:opacity-50">
                  <RotateCcw size={14} /> {busy ? 'Reversing…' : 'Reverse production-in (return to stock)'}
                </button>
              )}
            </>
          ) : items.length === 0 ? (
            <p className="text-sm text-ink-60 py-2">Nothing in stock yet — add it in Components first.</p>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map(r => {
                  const c = byId[r.item_id]
                  const avail = c ? (Number(c.stock_qty) || 0) - (Number(c.reserved_qty) || 0) : null
                  const after = avail != null && r.qty !== '' ? avail - Number(r.qty) : null
                  return (
                    <div key={r._uid} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <select className="input text-sm flex-1" value={r.item_id} onChange={e => setRow(r._uid, { item_id: e.target.value })}>
                        <option value="">— pick —</option>
                        {items.map(x => <option key={x.id} value={x.id}>{x.code}{x[inv.attrField] ? ` · ${x[inv.attrField]}` : ''}{x.name ? ` · ${x.name}` : ''}</option>)}
                      </select>
                      <div className="flex gap-2 items-center">
                        <input className="input text-sm w-24 text-right tabular-nums" inputMode="numeric" value={r.qty}
                               onChange={e => setRow(r._uid, { qty: e.target.value.replace(/[^\d]/g, '') })} placeholder="Qty" />
                        <span className="text-2xs text-ink-60 w-28 shrink-0">
                          {avail != null ? <>avail {fmt(avail)}{after != null ? <> → <span className={after < 0 ? 'text-red-600 font-semibold' : ''}>{fmt(after)}</span></> : ''}</> : ''}
                        </span>
                        <button type="button" onClick={() => removeRow(r._uid)} className="text-platinum hover:text-red-500 shrink-0"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800">
                  <Plus size={14} /> Add line
                </button>
                <button type="button" onClick={doReserve} disabled={busy} className="btn-primary text-sm ml-auto inline-flex items-center gap-1.5">
                  <Lock size={14} /> {busy ? 'Reserving…' : 'Reserve'}
                </button>
              </div>
            </>
          )}
          {error && <p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
      {pendingAddition && <ConfirmDialog danger={false} confirmLabel="Reserve item"
        message={`Reserve ${pendingAddition.code} × ${fmt(pendingAddition.qty)} for order ${orderLabel}? Existing reservations will be kept.`}
        onConfirm={confirmAddition} onCancel={() => setPendingAddition(null)} />}
    </div>
  )
}
