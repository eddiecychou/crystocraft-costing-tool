import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { quoteConversionAction } from '../../quoteConversion'

const money = (amount, currency) =>
  amount == null
    ? 'Not stated'
    : `${currency} ${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 3 })}`
export default function QuoteOrderRecovery({
  state,
  busy,
  error,
  onReload,
  onResume,
  onCancel,
  onAdditional,
  additional,
  onCloseAdditional,
  startHref,
  onMore,
  draftIssue = '',
  sourceHref = null,
  startDisabled = false
}) {
  const [showAdditional, setShowAdditional] = useState(false),
    [reason, setReason] = useState(''),
    [reviewedLegacy, setReviewedLegacy] = useState(false)
  const [showCancel, setShowCancel] = useState(false),
    [cancelReason, setCancelReason] = useState('')
  const hasExisting = Boolean(state?.latest || state?.legacy)
  const operation = state?.active
  const committed = [
    ...(state?.latest && !(state.history || []).some((op) => op.id === state.latest.id)
      ? [state.latest]
      : []),
    ...(state?.history || [])
  ].filter((op) => op.status === 'committed')
  const cancelled = (state?.history || []).filter((op) => op.status === 'cancelled')
  return (
    <section
      className="card p-4 md:p-5 space-y-4 min-w-0"
      aria-label="Quote order recovery"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg">Orders from this quote</h2>
        <button
          type="button"
          className="btn-secondary text-sm min-h-[44px]"
          disabled={busy}
          onClick={onReload}
        >
          Check saved requests
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-brand-700 break-words">
          {error}
        </p>
      )}
      {draftIssue && (
        <div className="text-sm space-y-2">
          <p role="alert" className="text-brand-700 break-words">
            {draftIssue}
          </p>
          {sourceHref && (
            <Link
              className="text-brand-600 underline inline-flex items-center min-h-[44px]"
              to={sourceHref}
            >
              Review source quote
            </Link>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-ink-60">
          Checking the saved conversion — please wait.
        </p>
      )}
      {!state && !busy && (
        <p className="text-sm text-ink-60">
          Check the saved requests before creating an order.
        </p>
      )}
      {state?.legacy && (
        <div className="border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm break-words">
          <p className="font-medium">Legacy order link — association requires review</p>
          <p>
            {state.legacy.missing
              ? 'The linked order is missing.'
              : !state.legacy.customer_matches
                ? 'The linked order belongs to a different or unresolved customer.'
                : 'This link predates saved conversion requests. It may have been inherited by a copied quote.'}
          </p>
          {!state.legacy.missing && (
            <Link
              className="text-brand-600 underline inline-flex items-center min-h-[44px]"
              to={`/shipments/${state.legacy.order_id}`}
            >
              Open legacy order {state.legacy.order_no || ''}
            </Link>
          )}
          <p>No historical order will be merged, reassigned or deleted.</p>
        </div>
      )}
      {operation && (
        <div className="border border-warm-grey p-3 md:p-4 space-y-3 min-w-0">
          <h3 className="font-medium">Saved conversion awaiting completion</h3>
          <p className="text-sm break-words">
            {operation.summary.customer_name} · {operation.summary.line_count} lines ·{' '}
            {money(operation.summary.total_amount, operation.summary.currency)}
          </p>
          {operation.summary.customer_po && (
            <p className="text-sm break-words">
              Customer PO: {operation.summary.customer_po}
            </p>
          )}
          {operation.reason && (
            <p className="text-sm break-words">Additional order: {operation.reason}</p>
          )}
          <div className="space-y-2 text-sm">
            {(operation.lines || []).map((line, i) => (
              <div key={i} className="border-t border-warm-grey pt-2 break-words">
                <p>
                  {line.item_code ? `${line.item_code} · ` : ''}
                  {line.description || 'Order line'}
                </p>
                <p className="text-ink-60">
                  {line.qty_ordered ?? 'Charge'} {line.unit} ×{' '}
                  {money(line.unit_price, operation.summary.currency)}
                </p>
                {line.tier_remarks && (
                  <p className="text-ink-60 whitespace-pre-wrap">{line.tier_remarks}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-60">
            Resume uses these saved details and the same order ID. It cannot create
            another order for this request.
          </p>
          <div className="flex flex-wrap gap-3">
            {onResume ? (
              <button
                type="button"
                className="btn-primary min-h-[44px]"
                disabled={busy}
                onClick={() => onResume(operation.id)}
              >
                Resume saved conversion
              </button>
            ) : (
              <Link className="btn-primary min-h-[44px]" to={startHref}>
                Resume saved conversion
              </Link>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy}
                onClick={() => setShowCancel((v) => !v)}
              >
                Cancel uncommitted request
              </button>
            )}
          </div>
          {showCancel && onCancel && (
            <div className="space-y-3">
              <label className="block">
                <span className="label">Cancellation reason</span>
                <input
                  className="input w-full"
                  maxLength={500}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </label>
              <p className="text-sm text-ink-60">
                Only this uncommitted request is cancelled. Existing orders and its review
                history are kept.
              </p>
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy || !cancelReason.trim()}
                onClick={() => onCancel(operation.id, cancelReason.trim())}
              >
                Confirm request cancellation
              </button>
            </div>
          )}
        </div>
      )}
      {committed.length > 0 && (
        <div className="space-y-3">
          {committed.map((op) => (
            <div
              key={op.id}
              className="flex flex-wrap items-start justify-between gap-3 border-t border-warm-grey pt-3"
            >
              <div className="flex-1 min-w-0 break-words text-sm">
                <p className="font-medium">
                  {op.result?.so || 'Saved order'} ·{' '}
                  {money(op.summary.total_amount, op.summary.currency)}
                </p>
                {op.summary.customer_po && (
                  <p className="text-ink-60">Customer PO: {op.summary.customer_po}</p>
                )}
                {op.reason && <p className="text-ink-60">{op.reason}</p>}
                {op.missing && (
                  <p role="alert" className="text-brand-700">
                    Order missing — review this receipt before proceeding.
                  </p>
                )}
                {op.customer_matches === false && !op.missing && (
                  <p className="text-brand-700">
                    The current order customer differs from the quote; review its
                    association.
                  </p>
                )}
              </div>
              {!op.missing && (
                <Link
                  className="btn-secondary text-sm min-h-[44px] shrink-0"
                  to={`/shipments/${op.order_id}`}
                >
                  Open order
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
      {cancelled.length > 0 && (
        <details className="text-sm space-y-2">
          <summary className="cursor-pointer text-ink-60 min-h-[44px] py-3">
            Cancelled requests ({cancelled.length})
          </summary>
          {cancelled.map((op) => (
            <div key={op.id} className="border-t border-warm-grey pt-2 break-words">
              <p>
                {op.summary.customer_po || op.summary.customer_name} ·{' '}
                {money(op.summary.total_amount, op.summary.currency)}
              </p>
              <p className="text-ink-60">
                {op.cancellation_reason || 'Cancelled before order creation'}
              </p>
            </div>
          ))}
        </details>
      )}
      {state?.more_history && onMore && (
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          disabled={busy}
          onClick={() => onMore(state.next_cursor)}
        >
          Load earlier requests
        </button>
      )}
      {state && !operation && !hasExisting && (
        <p className="text-sm text-ink-60">
          No saved order yet. Review the quote quantities and prices before creating the
          first order.
        </p>
      )}
      {state && !operation && startHref && !startDisabled && (
        <Link
          className={
            hasExisting ? 'btn-secondary min-h-[44px]' : 'btn-primary min-h-[44px]'
          }
          to={startHref}
        >
          {hasExisting ? 'Create additional order' : 'Convert to PI'}
        </Link>
      )}
      {state &&
        !operation &&
        hasExisting &&
        onAdditional &&
        !additional &&
        !draftIssue && (
          <div className="space-y-3">
            <p className="text-sm text-ink-60">
              Open an existing order above for follow-up. A separate order is available
              for an intentional new quantity, split or repeat order.
            </p>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() => setShowAdditional((v) => !v)}
            >
              Create additional order
            </button>
            {showAdditional && (
              <div className="space-y-3">
                <label className="block">
                  <span className="label">Reason for an additional order</span>
                  <textarea
                    className="input w-full"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {state.legacy && (
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={reviewedLegacy}
                      onChange={(e) => setReviewedLegacy(e.target.checked)}
                    />
                    <span>
                      I reviewed the legacy link above. Create a separate order without
                      changing that historical order&apos;s ownership.
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={
                    busy || !reason.trim() || Boolean(state.legacy && !reviewedLegacy)
                  }
                  onClick={() =>
                    onAdditional({
                      reason: reason.trim(),
                      legacy_review: state.legacy
                        ? {
                            order_id: state.legacy.order_id,
                            review_token: state.legacy.review_token
                          }
                        : null
                    })
                  }
                >
                  Review additional order
                </button>
              </div>
            )}
          </div>
        )}
      {additional && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">
            Additional order — review quantities, prices and customer PO below.
          </p>
          <p className="break-words">{additional.reason}</p>
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={busy}
            onClick={onCloseAdditional}
          >
            Return to existing orders
          </button>
        </div>
      )}
    </section>
  )
}

// QuoteDetail reads status only. Creating/resuming remains on the order editor.
export function QuoteOrderHistory({ quoteId, disabled = false }) {
  const [state, setState] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    let alive = true
    generation.current++
    setState(null)
    setBusy(true)
    setError('')
    quoteConversionAction(quoteId)
      .then((value) => {
        if (alive) setState(value)
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
      generation.current++
    }
  }, [quoteId, revision])
  const more = async (cursor) => {
    if (busy) return
    const seq = generation.current
    setBusy(true)
    setError('')
    try {
      const next = await quoteConversionAction(quoteId, 'status', { cursor })
      if (seq === generation.current)
        setState((old) => ({
          ...old,
          history: [...old.history, ...next.history],
          more_history: next.more_history,
          next_cursor: next.next_cursor
        }))
    } catch (e) {
      if (seq === generation.current) setError(e.message)
    } finally {
      if (seq === generation.current) setBusy(false)
    }
  }
  return (
    <QuoteOrderRecovery
      state={state}
      busy={busy}
      error={error}
      onReload={() => setRevision((v) => v + 1)}
      onMore={more}
      startDisabled={disabled}
      startHref={
        state ? `/shipments/new?from_quote=${encodeURIComponent(quoteId)}` : null
      }
    />
  )
}
