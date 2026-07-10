import { useState, useEffect } from 'react'
import { postMovement } from '../stockLedger'
import { Minus, Plus, Check } from 'lucide-react'

// Inline stock editor — type a new qty (or use −/+); on blur it posts a
// stock-take movement to the ledger (stockLedger.js), so a quick reconcile from
// a list stays fully audited instead of overwriting the number in place. Shared
// by the metal Critical Components list and the generic inventory stock tabs.
export default function StockEditor({ component: c, collectionPath = 'range_components' }) {
  const current = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
  const [val, setVal]       = useState(String(current))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  // Re-sync when the live snapshot changes (e.g. edited elsewhere).
  useEffect(() => { setVal(String(Number.isFinite(c.stock_qty) ? c.stock_qty : 0)) }, [c.stock_qty])

  async function commit(next) {
    const n = Math.max(0, Math.round(Number(next)))
    const safe = Number.isFinite(n) ? n : 0
    setVal(String(safe))
    if (safe === current) return
    setSaving(true)
    try {
      await postMovement(collectionPath, c.id, { type: 'stocktake', counted: safe, note: 'Inline stock update' })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  function step(delta) {
    const next = Math.max(0, (Math.round(Number(val)) || 0) + delta)
    commit(next)
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} title="−1"
                className="w-6 h-6 rounded border border-ivory-dark text-ink-50 hover:bg-ivory flex items-center justify-center"><Minus size={13} /></button>
        <input
          type="number" inputMode="numeric" min="0"
          className="input text-sm text-right tabular-nums w-16 px-2 py-1"
          value={val}
          onChange={e => setVal(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur()
            if (e.key === 'Escape') { setVal(String(current)); e.target.blur() }
          }}
        />
        <button type="button" onClick={() => step(1)} title="+1"
                className="w-6 h-6 rounded border border-ivory-dark text-ink-50 hover:bg-ivory flex items-center justify-center"><Plus size={13} /></button>
      </div>
      <div className="w-12 text-right leading-tight">
        <p className="text-[10px] text-ink-40">pcs</p>
        {saving
          ? <p className="text-[10px] text-ink-40">saving…</p>
          : saved
            ? <p className="inline-flex items-center gap-0.5 text-[10px] text-green-600"><Check size={11} />saved</p>
            : <p className="text-[10px] text-ink-50">{c.lead_time_weeks != null ? `${c.lead_time_weeks}wk lead` : '—'}</p>}
      </div>
    </div>
  )
}
