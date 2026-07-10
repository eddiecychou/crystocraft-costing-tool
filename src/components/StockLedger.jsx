import { useState } from 'react'
import { MOVEMENT_TYPES, movementTypeOf, movementDelta, postMovement, useMovements } from '../stockLedger'
import { PackagePlus, PackageMinus, ClipboardCheck, Pencil } from 'lucide-react'

// Stock ledger panel (V7.13a) — the append-only movement history for one range
// component, plus a form to post a new movement. On-hand shown here is the
// cached balance (kept in sync by postMovement's transaction). Read-only parts
// stay factual: every change is a dated, noted row, never an in-place edit.

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const ICONS = { receipt: PackagePlus, issue: PackageMinus, adjustment: Pencil, stocktake: ClipboardCheck }

export default function StockLedger({ componentId, currentStock = 0 }) {
  const { movements, loading } = useMovements(componentId)
  const [type, setType] = useState('receipt')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Balance = latest movement's balance_after when the ledger has rows, else the
  // component's cached stock (pre-ledger). Kept as a number for the preview.
  const balance = movements.length ? Number(movements[0].balance_after) || 0 : Number(currentStock) || 0
  const isStocktake = type === 'stocktake'
  const preview = qty === '' ? null : balance + movementDelta({ type, qty, counted: qty }, balance)

  async function submit(e) {
    e.preventDefault()
    if (qty === '' || !Number.isFinite(Number(qty))) { setError('Enter a quantity.'); return }
    setSaving(true); setError('')
    try {
      await postMovement(componentId, {
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

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Stock Ledger</h2>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wide text-ink-40 block leading-none">On hand</span>
          <span className={`font-mono text-lg font-semibold tabular-nums ${balance < 0 ? 'text-red-600' : 'text-ink-90'}`}>{fmt(balance)}</span>
        </div>
      </div>

      {/* Add movement */}
      <form onSubmit={submit} className="rounded-lg border border-ivory-dark p-3 mb-4 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {MOVEMENT_TYPES.map(t => (
            <button key={t.value} type="button" onClick={() => setType(t.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                type === t.value ? 'bg-brand-50 text-brand-700 border-brand-300' : 'bg-white text-ink-50 border-ivory-dark hover:border-gray-300'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-40">{movementTypeOf(type).note}</p>
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
          <p className="text-[11px] text-ink-50">New balance would be <span className={`font-mono font-medium ${preview < 0 ? 'text-red-600' : 'text-ink-80'}`}>{fmt(preview)}</span></p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {/* History */}
      {loading ? (
        <p className="text-sm text-ink-40 py-4 text-center">Loading…</p>
      ) : movements.length === 0 ? (
        <p className="text-sm text-ink-40 py-4 text-center">No movements yet. Post a receipt or stock-take to start the ledger.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-40 text-left border-b border-ivory-dark">
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="py-1.5 pr-2 font-medium">Type</th>
                <th className="py-1.5 pr-2 font-medium text-right">Change</th>
                <th className="py-1.5 pr-2 font-medium text-right">Balance</th>
                <th className="py-1.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movements.map(m => {
                const Icon = ICONS[m.type] || Pencil
                const chg = Number(m.qty) || 0
                return (
                  <tr key={m.id} className="align-top">
                    <td className="py-1.5 pr-2 text-ink-60 whitespace-nowrap">{m.date || '—'}</td>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex items-center gap-1 text-ink-70"><Icon size={12} className="text-ink-40" />{movementTypeOf(m.type).label}</span>
                    </td>
                    <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${chg > 0 ? 'text-green-700' : chg < 0 ? 'text-red-600' : 'text-ink-50'}`}>
                      {chg > 0 ? '+' : ''}{fmt(chg)}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink-80">{fmt(m.balance_after)}</td>
                    <td className="py-1.5 text-ink-60">{m.note || (m.order_id ? `Order ${m.order_id}` : '—')}</td>
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
