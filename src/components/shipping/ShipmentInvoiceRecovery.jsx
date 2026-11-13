import { useState } from 'react'

const finished = (op) =>
  ['financial', 'woo'].every((k) =>
    ['done', 'not_applicable', 'manual_review'].includes(
      op?.followups?.[k]?.state
    )
  )
export default function ShipmentInvoiceRecovery({
  state,
  busy,
  error,
  onAction,
  hasInvoice,
  readOnly = false
}) {
  const [mode, setMode] = useState(''),
    [reason, setReason] = useState(''),
    [purpose, setPurpose] = useState('split')
  const op = state?.operation,
    needsResume = op && (op.status !== 'linked' || !finished(op))
  const subjectMatches =
    op &&
    state.expected?.customer === op.customer &&
    state.expected?.currency === op.currency
  const run = (action) =>
    onAction(action, {
      reason: reason.trim(),
      purpose,
      previous_operation_id: op?.id || null,
      expected: state.expected,
      review_expected: state.expected
    })
      .then(() => {
        setMode('')
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
        {!readOnly && hasInvoice && state?.canStartNew && (
          <button
            type="button"
            className="btn-secondary text-sm min-h-[44px]"
            disabled={busy}
            onClick={() => {
              setMode('new')
              setReason('')
            }}
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
              ? finished(op)
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
          {!readOnly && needsResume && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-primary min-h-[44px]"
                disabled={busy}
                onClick={() => onAction('resume').catch(() => {})}
              >
                {busy ? 'Confirming…' : 'Resume saved request'}
              </button>
              {op.status === 'review_required' && op.result && (
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={busy}
                  onClick={() => {
                    setMode('link_review')
                    setReason('')
                  }}
                >
                  Review references
                </button>
              )}
              {op.status === 'linked' && (
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={busy}
                  onClick={() => {
                    setMode('manual_followups')
                    setReason('')
                  }}
                >
                  Record manual follow-up
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-60">
          {state
            ? hasInvoice
              ? readOnly ? 'Existing invoice retained.' : 'Existing invoice retained. Use the separate action above for a deliberate split or reissue.'
              : 'Raise Invoice after saving the order details.'
            : 'Checking saved invoice status…'}
        </p>
      )}
      {!readOnly && mode && (
        <div className="border-t border-warm-grey pt-4 space-y-3">
          <p className="text-sm">
            {mode === 'new'
              ? 'Issue a separate invoice. Earlier invoices remain in the ledger; this does not void or replace them.'
              : mode === 'link_review'
                ? `Link issued invoice ${op?.result?.si_no} to this order. Current invoice: ${state.expected.si || 'none'}; current UC: ${state.expected.uc || 'none'}.`
                : 'Record that the pending financial/UC follow-up has been reviewed manually. This acknowledgment does not change financial values.'}
          </p>
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
              onClick={() => setMode('')}
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
