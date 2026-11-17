import { useEffect, useId, useRef, useState } from 'react'
import { authHeader } from '../../firebase'
import { financeLookupTarget, invoiceFinanceStatus, invoicePurposeLabel } from '../../invoiceFinanceLookupModel.js'

export default function InvoiceFinanceLookup() {
  const [value, setValue] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(null)
  const inputId = useId()
  useEffect(() => () => active.current?.abort(), [])

  async function lookup(event) {
    event.preventDefault()
    if (active.current) return
    const target = financeLookupTarget(value)
    setResult(null)
    if (!target) {
      setError('Enter an exact OC invoice number or saved request ID.')
      return
    }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ lookup:target.si || target.requestId })
      const response = await fetch('/api/oc-invoice-summaries?' + params, { headers:await authHeader(), cache:'no-store',
        signal:AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      const data = await response.json()
      if (!response.ok || !Object.hasOwn(invoiceFinanceStatus, data?.status)) throw Error()
      if (!controller.signal.aborted) setResult(data)
    } catch {
      if (!controller.signal.aborted) setError('Invoice evidence could not be checked. Try the lookup again.')
    } finally {
      if (active.current === controller && !controller.signal.aborted) {
        active.current = null
        setBusy(false)
      }
    }
  }

  return <details className="card p-4 mb-4">
    <summary className="cursor-pointer text-sm font-semibold">Finance invoice lookup</summary>
    <form onSubmit={lookup} className="mt-3 space-y-2">
      <label htmlFor={inputId} className="text-sm">OC invoice number or saved request ID</label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
        <input id={inputId} className="input w-full sm:max-w-md" value={value} maxLength={40}
          placeholder="SI260001 or saved request ID" autoComplete="off" spellCheck="false" disabled={busy}
          onChange={event => { setValue(event.target.value); setResult(null); setError('') }} />
        <button type="submit" className="btn-secondary min-h-11 shrink-0" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Look up invoice'}
        </button>
      </div>
    </form>
    {error && <p className="text-sm text-brand-600 mt-3" role="alert">{error}</p>}
    {result && <div className="border-t border-warm-grey mt-3 pt-3 text-sm space-y-2 break-words" role="status">
      <p className="font-semibold">{invoiceFinanceStatus[result.status]}</p>
      {result.ledgerId && <p>OC ledger · {result.si} · {result.ledgerStatus === 'void' ? 'Void' : 'Issued'} · Record {result.ledgerId}</p>}
      {result.uc && <p>Verified UC · {result.uc}{result.purpose && ` · ${invoicePurposeLabel[result.purpose]}`}</p>}
      {result.orderId && <p>{result.requestId ? 'Request order' : 'Ledger order'} · {result.orderId}</p>}
      {result.requestId && <p>Saved request · {result.requestId}</p>}
    </div>}
  </details>
}
