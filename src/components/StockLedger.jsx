import { useState } from 'react'
import { MOVEMENT_TYPES, movementDelta, postMovement, useMovements } from '../stockLedger'
import { PackagePlus, PackageMinus, ClipboardCheck, Pencil, Lock, Unlock, Factory } from 'lucide-react'

// Stock ledger panel (V7.13a R1) — the append-only movement history for one SKU,
// plus a form to post a manual on-hand movement. The item now tracks two
// balances: On-hand and Reserved (allocated to confirmed orders); Available =
// On-hand − Reserved. Reserve / Production-in movements are posted from the order
// page and shown here read-only. Every change is a dated, noted row.

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const TYPE_LABEL = { receipt: 'Receipt', issue: 'Issue', adjustment: 'Adjustment', stocktake: 'Stock-take', reserve: 'Reserve', release: 'Release', produce: 'Production-in' }
const ICONS = { receipt: PackagePlus, issue: PackageMinus, adjustment: Pencil, stocktake: ClipboardCheck, reserve: Lock, release: Unlock, produce: Factory }

export default function StockLedger({ componentId, currentStock = 0, currentReserved = 0, collectionPath = 'range_components' }) {
  const { movements, loading } = useMovements(collectionPath, componentId)
  const [type, setType] = useState('receipt')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Latest running balances — from the newest movement when present, else the
  // cached figures (pre-ledger / pre-reserve).
  const latest = movements[0]
  const onHand = latest ? Number(latest.balance_after) || 0 : Number(currentStock) || 0
  const reserved = latest && latest.reserved_after != null ? Number(latest.reserved_after) || 0 : Number(currentReserved) || 0
  const available = onHand - reserved
  const isStocktake = type === 'stocktake'
  const preview = qty === '' ? null : onHand + movementDelta({ type, qty, counted: qty }, onHand)

  async function submit(e) {
    e.preventDefault()
    if (qty === '' || !Number.isFinite(Number(qty))) { setError('Enter a quantity.'); return }
    setSaving(true); setError('')
    try {
      await postMovement(collectionPath, componentId, {
        type,
        qty: isStocktake ? undefined : Number(qty),
        counted: isStocktake ? Number(qty) : undefined,
        date, note,
      })
      setQty(''); setNote('')
    } catch (err) {
      setError(err.message || 'Could not post movement.')
    } finally {
      setSaving(false)
    }
  }

  const Stat = ({ label, value, cls }) => (
    <div className="text-right">
      <span className="text-[10px] uppercase tracking-wide text-ink-60 block leading-none">{label}</span>
      <span className={`font-mono text-lg font-semibold tabular-nums ${cls}`}>{fmt(value)}</span>
    </div>
  )

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="text-sm font-semibold text-gray-700">Stock Ledger</h2>
        <div className="flex items-center gap-5">
          <Stat label="On hand" value={onHand} cls={onHand < 0 ? 'text-red-600' : 'text-ink'} />
          <Stat label="Reserved" value={reserved} cls={reserved > 0 ? 'text-amber-600' : 'text-ink-60'} />
          <Stat label="Available" value={available} cls={available < 0 ? 'text-red-600' : 'text-green-700'} />
        </div>
      </div>

      {/* Add movement (manual on-hand ops; reserve/production-in come from orders) */}
      <form onSubmit={submit} className="rounded-lg border border-ivory-dark p-3 mb-4 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {MOVEMENT_TYPES.map(t => (
            <button key={t.value} type="button" onClick={() => setType(t.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                type === t.value ? 'bg-brand-50 text-brand-700 border-brand-300' : 'bg-white text-ink-60 border-ivory-dark hover:border-gray-300'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-60">{MOVEMENT_TYPES.find(t => t.value === type)?.note}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="input text-sm sm:w-28" inputMode="numeric" value={qty}
                 onChange={e => setQty(e.target.value.replace(isStocktake || type === 'adjustment' ? /[^\d.\-]/g : /[^\d.]/g, ''))}
                 placeholder={isStocktake ? 'Counted qty' : type === 'adjustment' ? '± qty' : 'Qty'} />
          <input type="date" className="input text-sm sm:w-40" value={date} onChange={e => setDate(e.target.value)} />
          <input className="input text-sm flex-1" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Note (PU no., reason, order…)" />
          <button type="submit" disabled={saving} className="btn-primary text-sm shrink-0">{saving ? 'Posting…' : 'Post'}</button>
        </div>
        {preview != null && (
          <p className="text-[11px] text-ink-60">New on-hand would be <span className={`font-mono font-medium ${preview < 0 ? 'text-red-600' : 'text-ink-80'}`}>{fmt(preview)}</span></p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {/* History */}
      {loading ? (
        <p className="text-sm text-ink-60 py-4 text-center">Loading…</p>
      ) : movements.length === 0 ? (
        <p className="text-sm text-ink-60 py-4 text-center">No movements yet. Post a receipt or stock-take to start the ledger.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-60 text-left border-b border-ivory-dark">
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="py-1.5 pr-2 font-medium">Type</th>
                <th className="py-1.5 pr-2 font-medium text-right">Change</th>
                <th className="py-1.5 pr-2 font-medium text-right">On-hand</th>
                <th className="py-1.5 pr-2 font-medium text-right">Reserved</th>
                <th className="py-1.5 font-medium whitespace-normal">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movements.map(m => {
                const Icon = ICONS[m.type] || Pencil
                const dOn = Number(m.qty) || 0
                const dRes = Number(m.reserved_qty) || 0
                const isRes = dOn === 0 && dRes !== 0
                const primary = dOn !== 0 ? dOn : dRes
                return (
                  <tr key={m.id} className="align-top">
                    <td className="py-1.5 pr-2 text-ink-60">{m.date || '—'}</td>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex items-center gap-1 text-ink-70"><Icon size={12} className="text-ink-60" />{TYPE_LABEL[m.type] || m.type}</span>
                    </td>
                    <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${primary > 0 ? 'text-green-700' : primary < 0 ? 'text-red-600' : 'text-ink-60'}`}>
                      {primary > 0 ? '+' : ''}{fmt(primary)}{isRes ? ' res' : ''}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-80">{fmt(m.balance_after)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-amber-700">{fmt(m.reserved_after)}</td>
                    <td className="py-1.5 text-ink-60 whitespace-normal">{m.note || (m.order_id ? `Order ${m.order_id}` : '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
