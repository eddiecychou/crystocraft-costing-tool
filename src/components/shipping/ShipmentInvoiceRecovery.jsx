import { useState } from 'react'
import { invoiceFollowupsDone, invoiceFollowupReviewTarget, sameInvoiceValue } from '../../invoiceRecoveryModel'

const stageLabel = { financial: 'Financial copy', woo: 'UC Registry' }
const dispositionLabel = { resume: 'Ready to resume', in_progress: 'In progress', finance_review: 'Finance review needed' }
export default function ShipmentInvoiceRecovery({
  state,
  busy,
  error,
  onAction,
  hasInvoice,
  readOnly = false,
  statusUnavailable = false,
  onRefresh,
}) {
  const [selection, setSelection] = useState(null),
    [reason, setReason] = useState(''),
    [purpose, setPurpose] = useState('split')
  const mode = selection?.mode
  const op = state?.operation
  const entries = state?.followupChecklist?.entries || []
  const current = entries.find(row => row.id === op?.id)
  const unavailable = statusUnavailable || state?.followupChecklist?.unavailable
  const canManage = !readOnly && state?.canManage !== false
  const needsResume = op && (op.status !== 'linked' || !invoiceFollowupsDone(op))
  const canResume = needsResume && (!current || current.disposition === 'resume')
  const selectedRow = mode === 'closure_review_followups'
    ? entries.find(row => row.id === selection.id && !row.current) : op
  const liveTarget = invoiceFollowupReviewTarget(state?.order, selectedRow, state?.expected)
  const selectionChanged = selection && (selection.id !== (selectedRow?.id || null) ||
    !sameInvoiceValue(selection.target, liveTarget))
  const open = (mode, row = op) => {
    setSelection({ mode, id: row?.id || null, target: invoiceFollowupReviewTarget(state?.order, row, state?.expected) })
    setReason('')
  }
  const subjectMatches =
    op &&
    state.expected?.customer === op.customer &&
    state.expected?.currency === op.currency
  const run = (action) =>
    onAction(action, {
      reason: reason.trim(),
      purpose,
      previous_operation_id: selection.id,
      expected: selection.target.expected,
      review_expected: action === 'link_review' ? selection.target.expected : selection.target
    })
      .then(() => {
        setSelection(null)
        setReason('')
      })
      .catch(() => {})
  return (
    <section
      className="card p-4 md:p-6 mb-5 space-y-3"
      aria-label="Invoice recovery"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="eyebrow">Invoice status</h2>
        {canManage && hasInvoice && state?.canStartNew && (
          <button
            type="button"
            className="btn-secondary text-sm min-h-[44px]"
            disabled={busy || unavailable}
            onClick={() => open('new')}
          >
            New split / reissued invoice
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 break-words">
          {error}
        </p>
      )}
      {op ? (
        <>
          <p role="status" className="text-sm break-words">
            {op.status === 'linked'
              ? invoiceFollowupsDone(op)
                ? 'Invoice linked.'
                : 'Invoice linked — follow-up pending.'
              : op.status === 'review_required'
                ? 'Review required — keep this saved request.'
                : op.result
                  ? 'Invoice issued — linking pending.'
                  : 'Invoice request pending — safe to resume.'}
            {op.result && (
              <strong className="block mt-1 text-ink">
                {op.result.si_no} · {op.result.uc_no}
              </strong>
            )}
          </p>
          {op.error?.message && (
            <p className="text-sm text-amber-800 break-words">
              {op.error.message}
            </p>
          )}
          {['financial', 'woo']
            .filter((k) => op.followups[k]?.error)
            .map((k) => (
              <p key={k} className="text-sm text-amber-800 break-words">
                {k === 'financial' ? 'Financial copy' : 'UC Registry'}:{' '}
                {op.followups[k].error}
              </p>
            ))}
          {canManage && needsResume && (
            <div className="flex flex-wrap gap-3">
              {canResume && <button
                type="button"
                className="btn-primary min-h-[44px]"
                disabled={busy || unavailable}
                onClick={() => onAction('resume', { previous_operation_id: op.id }).catch(() => {})}
              >
                {busy ? 'Confirming…' : 'Resume saved request'}
              </button>}
              {op.status === 'review_required' && op.result && (
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={busy || unavailable}
                  onClick={() => open('link_review')}
                >
                  Review references
                </button>
              )}
              {op.status === 'linked' && current?.disposition !== 'in_progress' && (
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={busy || unavailable}
                  onClick={() => open('manual_followups')}
                >
                  Record Finance review
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-60">
          {state
            ? hasInvoice
              ? !canManage ? 'Existing invoice retained.' : 'Existing invoice retained. Use the separate action above for a deliberate split or reissue.'
              : 'Raise Invoice after saving the order details.'
            : 'Checking saved invoice status…'}
        </p>
      )}
      {(unavailable || state?.followupChecklist?.incomplete || entries.length > 0) && (
        <div className="border-t border-warm-grey pt-3 space-y-2">
          <h3 className="eyebrow">Invoice follow-ups</h3>
          {unavailable && <p role="status" className="text-sm">Follow-ups could not be verified. {onRefresh &&
            <button type="button" onClick={onRefresh} disabled={busy} className="text-brand-600 underline">Refresh invoice status</button>}
          </p>}
          {state?.followupChecklist?.incomplete && <p role="status" className="text-sm">This list includes the first 500 linked receipts. Ask Finance to check the remaining history.</p>}
          <ul className="divide-y divide-warm-grey">
            {entries.map(row => <li key={row.id} className="space-y-1 py-2 text-sm break-words">
              <p><strong>{row.result.si_no} · {row.result.uc_no}</strong> · {row.current ? 'Current invoice' : 'Historical invoice'}</p>
              <p className={row.disposition === 'finance_review' ? 'text-amber-800' : 'text-ink-70'}>{dispositionLabel[row.disposition]}</p>
              {row.referenceConflict && <p className="text-amber-800">Saved invoice references or customer details have changed.</p>}
              {row.stages.map(stage => <p key={stage.stage} className="text-ink-70">
                {stageLabel[stage.stage]} · {stage.inProgress ? 'In progress' : 'Pending'}{stage.error ? ` · ${stage.error}` : ''}
              </p>)}
              {canManage && !row.current && <button type="button" className="btn-secondary min-h-[44px]"
                disabled={busy || unavailable} onClick={() => open('closure_review_followups', row)}>
                Record Finance review for {row.result.si_no}
              </button>}
            </li>)}
          </ul>
        </div>
      )}
      {canManage && mode && (
        <div className="border-t border-warm-grey pt-4 space-y-3">
          <p className="text-sm">
            {mode === 'new'
              ? 'Issue a separate invoice. Earlier invoices remain in the ledger; this does not void or replace them.'
              : mode === 'link_review'
                ? `Link issued invoice ${op?.result?.si_no} to this order. Current invoice: ${state.expected.si || 'none'}; current UC: ${state.expected.uc || 'none'}.`
                : `Record Finance’s completed follow-up review for ${selection.target.si} · ${selection.target.uc}.`}
          </p>
          {selectionChanged && <p role="alert" className="text-sm text-amber-800">The invoice or saved references changed. Reopen the review for the intended invoice before confirming.</p>}
          {mode === 'link_review' && !subjectMatches && (
            <p role="alert" className="text-sm text-amber-800">
              Issued for {op.customer} ({op.currency}). The saved
              customer/currency differ. Restore or review them before linking.
            </p>
          )}
          {mode === 'new' && (
            <label className="label">
              Invoice purpose
              <select
                className="input mt-1"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              >
                <option value="split">Split shipment / invoice</option>
                <option value="reissue">Reissued invoice</option>
              </select>
            </label>
          )}
          <label className="label">
            Reason
            <textarea
              className="input mt-1 normal-case tracking-normal"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary min-h-[44px]"
              disabled={
                busy ||
                unavailable || selectionChanged ||
                !reason.trim() ||
                (mode === 'link_review' && !subjectMatches)
              }
              onClick={() => run(mode)}
            >
              {busy ? 'Confirming…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() => setSelection(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {state?.history?.length > 0 && (
        <details className="border-t border-warm-grey pt-3">
          <summary className="cursor-pointer text-sm text-brand-600">
            Invoice request history ({state.history.length}
            {state.moreHistory ? '+' : ''})
          </summary>
          <ul className="mt-3 divide-y divide-warm-grey">
            {state.history.map((row) => (
              <li key={row.id} className="py-2 text-sm break-words">
                <span className="text-ink">
                  {row.result?.si_no || 'Pending'} · {row.purpose} ·{' '}
                  {row.status.replaceAll('_', ' ')}
                </span>
                {row.reason && <p className="text-ink-60">{row.reason}</p>}
              </li>
            ))}
          </ul>
          {state.moreHistory && (
            <p className="text-xs text-ink-60 mt-2">
              Showing the latest 20 requests. Earlier requests and invoices
              remain retained.
            </p>
          )}
        </details>
      )}
    </section>
  )
}
