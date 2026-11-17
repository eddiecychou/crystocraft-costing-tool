import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { authHeader } from '../../firebase'
import { invoiceFollowupDispositionLabel, invoiceFollowupStageLabel } from '../../invoiceRecoveryModel.js'

const rowKey = row => `${row.orderId}/${row.operationId}`
const nextStep = {
  resume: 'Open the order to resume the saved invoice.',
  in_progress: 'Refresh to check whether this attempt has finished.',
  finance_review: 'Use the invoice and UC references to follow up with Finance.',
}
const issueDetail = {
  order_unavailable: 'Order unavailable',
  order_closed: 'Order closed',
  request_not_current: 'A different invoice request is current',
  receipt_conflict: 'Receipt evidence conflicts or could not be verified',
}
const purposeLabel = { first: 'First invoice', split: 'Split invoice', reissue: 'Reissued invoice' }

export default function InvoiceFollowups({ onBack, awaiting = false }) {
  const title = awaiting ? 'Awaiting order link' : 'Invoice follow-ups'
  const orderQuery = awaiting ? 'invoiceRequest' : 'followup'
  const [page, setPage] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  const active = useRef(null)

  const load = useCallback(async cursor => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    if (!cursor) setPage(null)
    try {
      const params = new URLSearchParams()
      if (awaiting) params.set('view', 'awaiting_link')
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`/api/invoice-followups${params.size ? '?' + params : ''}`, { headers: await authHeader(),
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) })
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.rows)) throw Error(data?.error || 'Invoice receipts could not be loaded.')
      if (active.current !== controller) return
      setPage(previous => {
        const rows = new Map((cursor ? previous?.rows || [] : []).map(row => [rowKey(row), row]))
        for (const row of data.rows) rows.set(rowKey(row), row)
        return { rows: [...rows.values()], next: data.next }
      })
    } catch (err) {
      if (active.current === controller) setError({ message: err.message, cursor })
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }, [awaiting])

  useEffect(() => {
    load(null)
    return () => {
      active.current?.abort()
      active.current = null
    }
  }, [load])

  return <section aria-labelledby="invoice-followups-heading" className="p-4 md:p-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <button type="button" className="text-sm text-brand-600 min-h-11" onClick={onBack}>← Back to orders</button>
        <h2 id="invoice-followups-heading" className="text-xl">{title}</h2>
      </div>
      <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => load(null)}>Refresh</button>
    </div>
    <div className="card divide-y divide-warm-grey" aria-busy={busy}>
      {page?.rows.map(row => <div key={rowKey(row)} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 sm:gap-4 p-4 text-sm break-words">
        {row.issue ? <>
          <div><p>Order {row.orderId}</p><p className="text-ink-60">{issueDetail[row.issue]}</p>
            {awaiting && <p className="text-xs text-ink-60">Request {row.operationId}</p>}</div>
          <p className="text-brand-600">Finance review needed</p>
        </> : <>
          <div>
            <p>{row.si} · {row.uc}</p>
            <p className="text-ink-60">{row.reference}{row.customer && ` · ${row.customer}`}</p>
            <p className="text-xs text-ink-60">{awaiting ? purposeLabel[row.purpose] : row.current ? 'Current invoice' : 'Historical invoice'}</p>
          </div>
          <div>
            <p className={row.disposition === 'finance_review' ? 'text-brand-600' : 'text-ink'}>{invoiceFollowupDispositionLabel[row.disposition]}</p>
            {row.stages && <p className="text-ink-60">{row.stages.map(stage => invoiceFollowupStageLabel[stage.stage]).join(' · ')}</p>}
            <p className="text-xs text-ink-60">{nextStep[row.disposition]}</p>
          </div>
          <Link className="btn-secondary min-h-11 w-fit" aria-label={`${awaiting ? 'Open saved request' : 'Open order'} for ${row.si}`}
            to={`/shipments/${encodeURIComponent(row.orderId)}?${orderQuery}=${encodeURIComponent(row.operationId)}`}>
            {awaiting ? 'Open saved request' : 'Open order'}
          </Link>
        </>}
      </div>)}
      {busy && <p className="p-4 text-sm text-ink-60" role="status">{awaiting ? 'Checking issued invoice receipts…' : 'Checking invoice follow-ups…'}</p>}
      {!busy && error && <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p role="alert" className="text-brand-600">{error.message}</p>
        <button type="button" className="btn-secondary min-h-11" onClick={() => load(error.cursor)}>Retry</button>
      </div>}
      {!busy && !error && page?.next && <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p className="text-ink-60">{page.rows.length ? 'More invoice receipts are available to check.' : 'No pending items in this page. More receipts are available to check.'}</p>
        <button type="button" className="btn-secondary min-h-11" onClick={() => load(page.next)}>Check more receipts</button>
      </div>}
      {!busy && !error && page && !page.next && !page.rows.length && <p className="p-4 text-sm text-ink-60">{awaiting
        ? 'No verified invoices awaiting an order link.' : 'No pending invoice follow-ups.'}</p>}
    </div>
  </section>
}
