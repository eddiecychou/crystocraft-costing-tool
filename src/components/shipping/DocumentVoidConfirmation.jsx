import { useRef, useState } from 'react'

export default function DocumentVoidConfirmation({ label, document, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  async function confirm(event) {
    event.preventDefault()
    if (saving.current || !reason.trim()) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (failure) {
      setError(failure.message || 'Could not confirm the void. Retry the same document.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form role="dialog" aria-modal="true" aria-label={label} aria-busy={busy}
            onSubmit={confirm} className="card w-full max-w-md p-5 space-y-4">
        <h2 className="text-lg">{label} {document}</h2>
        <p className="text-sm text-ink-70">OC keeps this document number and records your reason in its history.</p>
        <label className="block text-sm">
          Void reason
          <textarea autoFocus required maxLength={500} disabled={busy} value={reason}
                    onChange={e => setReason(e.target.value)} className="input w-full mt-1" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : label}</button>
        </div>
      </form>
    </div>
  )
}
