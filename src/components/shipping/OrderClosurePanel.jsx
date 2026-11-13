import { useRef, useState } from 'react'
import { orderRequestAction } from '../../shippingOrderApi'
import { invoiceAction } from '../../invoiceRecovery'
import { formatOcDateTime } from '../../ocTime'
import { orderStatusOf } from '../../shippingModel'

const stockLabels = { clear: 'Clear', reserved: 'Release needed', consumed: 'Consumption recorded', review: 'Supply review needed' }
const invoiceLabels = { ready: 'Follow-ups settled', followups: 'Follow-up pending', allocation: 'Allocation needs review' }

export default function OrderClosurePanel({ orderId, closed, onClosed, disabled }) {
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState(null)
  const [reason, setReason] = useState('')
  const [invoiceReview, setInvoiceReview] = useState('')
  const [financeReason, setFinanceReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const load = async () => setReview(await orderRequestAction('closure_status', { order_id: orderId }))

  async function run(work) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await work() }
    catch (err) { setError(err.message || 'Could not confirm the closure review.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const refresh = () => run(async () => { setReview(null); await load() })
  const close = () => run(async () => {
    const { base, token } = review
    setReview(null)
    const saved = await orderRequestAction('close_order', { order_id: orderId, base, token, reason })
    setReview(saved)
    onClosed()
    await load()
  })
  const recordReview = () => run(async () => {
    const id = invoiceReview
    await invoiceAction(orderId, 'closure_review_followups', { previous_operation_id: id, reason: financeReason.trim() })
    setInvoiceReview(''); setFinanceReason('')
    await load()
  })
  if (!open) return (
    <div className="flex flex-wrap items-center gap-3 mb-5">
      {closed && <span className="text-sm font-medium">Closed</span>}
      <button type="button" className="btn-secondary" disabled={disabled}
        onClick={() => { setOpen(true); refresh() }}>{closed ? 'View closure' : 'Review closure'}</button>
    </div>
  )
  return (
    <section aria-label="Order closure" aria-busy={busy} className="card p-4 md:p-6 mb-5 space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="eyebrow">{closed || review?.closed ? 'Closed order' : 'Review closure'}</h2>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}>Refresh checklist</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>
      {busy && <p role="status" className="text-sm">Checking saved order…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {review?.closed && <div className="space-y-2 text-sm">
        <p className="whitespace-pre-wrap">{review.reason}</p>
        {review.closedAt && <p className="text-ink-60">Closed {formatOcDateTime(new Date(review.closedAt))}</p>}
        {review.invoices?.length > 0 && <ul>{review.invoices.map(op => <li key={op.id}>{op.si} · {op.uc} · {invoiceLabels[op.state]}</li>)}</ul>}
      </div>}
      {review && !review.closed && !closed && (
        <>
          <p className="text-sm">Current stage {orderStatusOf(review.stage).label}. {review.documents.packing} packing scenario(s) and {review.documents.freight} freight quote(s) will stay linked.</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-3">
            {review.stock.map(item => <li key={item.label} className="border border-warm-grey p-2"><strong>{item.label}</strong><br />{stockLabels[item.state]}</li>)}
          </ul>
          {review.invoices.length > 0 && <ul className="space-y-2 text-sm">
            {review.invoices.map(op => <li key={op.id} className="flex flex-wrap gap-2 items-center">
              <span>{op.si || 'Invoice request'} · {invoiceLabels[op.state]}</span>
              {op.state === 'followups' && review.canReviewInvoices && <button type="button" className="btn-secondary" disabled={busy}
                onClick={() => { setInvoiceReview(op.id); setFinanceReason('') }}>Review follow-up</button>}
            </li>)}
          </ul>}
          {invoiceReview && <div className="space-y-2 border border-warm-grey p-3">
            <p className="text-sm">Confirm that Finance has manually reviewed this invoice’s pending follow-ups.</p>
            <label className="block text-sm">Finance review reason
              <textarea className="input w-full" maxLength={500} value={financeReason} onChange={e => setFinanceReason(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary" disabled={busy || !financeReason.trim()} onClick={recordReview}>Record finance review</button>
          </div>}
          {review.blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-800 space-y-1">
            {review.blockers.map(item => <li key={item}>{item}</li>)}
          </ul>}
          <label className="block text-sm">Closure reason
            <textarea className="input w-full" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" disabled={disabled || busy || !reason.trim() || review.blockers.length > 0} onClick={close}>Close order</button>
        </>
      )}
    </section>
  )
}
