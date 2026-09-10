import { useState, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')

// Inline whole-number editor for a reserved-line quantity. Read-only until the
// pencil is clicked; Enter / ✓ commits, Esc / ✗ cancels. Only fires `onSave`
// for a positive integer that actually changed. Used by the Component and
// Crystal/Packaging order-stock cards to adjust a reservation before
// production-in (XiangXia ask #2 — see docs/plans/RESERVE-QTY-EDIT-AUDIT.md).
export default function EditableQty({ value, onSave, busy }) {
  const current = Math.abs(Number(value) || 0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(current))
  useEffect(() => { setDraft(String(current)) }, [current])

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono tabular-nums text-ink-70">{fmt(current)}</span>
        <button type="button" onClick={() => setEditing(true)}
                className="text-platinum hover:text-brand-600" title="Edit reserved qty">
          <Pencil size={12} />
        </button>
      </span>
    )
  }

  const cancel = () => { setDraft(String(current)); setEditing(false) }
  const commit = () => {
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n > 0 && n !== current) onSave(n)
    setEditing(false)
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus className="input text-sm w-20 text-right tabular-nums py-1" inputMode="numeric"
             value={draft}
             onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))}
             onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
      <button type="button" onClick={commit} disabled={busy}
              className="text-green-700 hover:text-green-800 disabled:opacity-50" title="Save">
        <Check size={14} />
      </button>
      <button type="button" onClick={cancel}
              className="text-platinum hover:text-red-500" title="Cancel">
        <X size={14} />
      </button>
    </span>
  )
}
