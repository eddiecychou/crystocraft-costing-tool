import { useRef, useState } from 'react'
import { documentVoidAction } from '../../documentVoids'
import { exactSalesInvoiceNo } from '../../documentVoidModel'
import DocumentVoidConfirmation from './DocumentVoidConfirmation'

export default function InvoiceVoidPanel({ onVoided }) {
  const [no, setNo] = useState('')
  const [target, setTarget] = useState(null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const pending = useRef(false)
  const query = no.trim().toUpperCase()

  async function lookup(event) {
    event.preventDefault()
    if (pending.current || !exactSalesInvoiceNo(query)) return
    pending.current = true
    setWaiting(true)
    setTarget(null)
    setError('')
    try { setTarget(await documentVoidAction('review_si', { no: query })) }
    catch (failure) { setError(failure.message) }
    finally { pending.current = false; setWaiting(false) }
  }
  async function voidInvoice(reason) {
    const saved = await documentVoidAction('void_si', {
      id: target.id, no: target.no, updatedAt: target.updatedAt, reason,
    })
    setTarget(current => ({ ...current, ...saved }))
    setConfirm(false)
    onVoided(saved.no)
  }

  return (
    <details className="card p-4 mb-4">
      <summary className="cursor-pointer font-medium">Void sales invoice</summary>
      <form className="flex flex-wrap gap-2 items-end mt-3" onSubmit={lookup}>
        <label className="block text-sm">
          Exact SI number
          <input className="input block mt-1" value={no} maxLength={64} disabled={waiting || confirm}
                 onChange={e => { setNo(e.target.value); setTarget(null); setError('') }} />
        </label>
        <button className="btn-secondary" disabled={!exactSalesInvoiceNo(query) || waiting || confirm}>
          {waiting ? 'Checking…' : 'Find invoice'}
        </button>
      </form>
      {error && <p className="text-sm text-red-700 mt-3" role="alert">{error}</p>}
      {target && (
        <div className="mt-3 text-sm space-y-2">
          <p><strong>{target.no}</strong> · {target.customer} · {target.date || 'Date unavailable'}</p>
          <p>{target.uc || 'UC unavailable'} · {target.currency} {target.total ?? 'Total unavailable'}</p>
          {target.status === 'issued' ? (
            <button type="button" className="btn-danger" onClick={() => setConfirm(true)}>Void SI</button>
          ) : (
            <div role="status">
              <strong className="uppercase">{target.status === 'void' ? 'VOID' : target.status}</strong>
              {target.reason && <p className="whitespace-pre-wrap">{target.reason}</p>}
              {target.voidedAt && <time dateTime={target.voidedAt}>{target.voidedAt.slice(0, 10)}</time>}
            </div>
          )}
        </div>
      )}
      {confirm && <DocumentVoidConfirmation label="Void SI" document={target.no}
        onCancel={() => setConfirm(false)} onConfirm={voidInvoice} />}
    </details>
  )
}
