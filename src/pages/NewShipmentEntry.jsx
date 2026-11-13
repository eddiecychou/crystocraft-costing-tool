import { useRef, useState } from 'react'
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom'
import ShipmentForm from './ShipmentForm'
import { useShipmentOrderRequest } from '../hooks/useShipmentOrderRequest'
import { requestUrl, validRequestId, needsInitialInvoice } from '../orderCreateRequestModel.js'

function StartRequest({ uid, params }) {
  const [id] = useState(() => crypto.randomUUID())
  return <Navigate replace to={requestUrl(uid, id, params)} />
}

export default function NewShipmentEntry({ uid }) {
  const [params] = useSearchParams()
  const drafts = useRef(new Map())
  if (params.get('from_quote')) return <ShipmentForm />
  if (!params.has('request') && !params.has('operator'))
    return <StartRequest uid={uid} params={params} />
  const id = params.get('request')
  if (params.get('operator') !== uid || !validRequestId(id))
    return (
      <div className="p-6">
        <p role="alert">This order request cannot be opened with this login.</p>
        <Link to="/shipping">Back to Shipping</Link>
      </div>
    )
  return <RequestEditor key={uid + ':' + id} operator={uid} id={id} drafts={drafts.current} />
}

function RequestEditor({ operator, id, drafts }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const separateOrder = new URLSearchParams(params)
  separateOrder.delete('request')
  separateOrder.delete('operator')
  const location = useLocation()
  const {
    state, busy, error, openedForm, conflictDraft, initialDraft, originalFile,
    needsOriginal, checkingOriginal, attachDraftOriginal, submit, useDraftForSeparateOrder,
    checkSavedStatus, finishDirectInvoice, resumeOrder, selectOriginal, makeAnotherCopy,
  } = useShipmentOrderRequest({
    operator, id, drafts,
    direct: params.get('direct') === '1',
    initialError: location.state?.requestError || '',
    openRequest: requestId => navigate(requestUrl(operator, requestId)),
    openOrder: orderId => navigate('/shipments/' + orderId),
    openSeparateDraft: (requestId, direct) => {
      const query = new URLSearchParams(separateOrder)
      if (direct) query.set('direct', '1')
      else query.delete('direct')
      navigate(requestUrl(operator, requestId, query))
    },
  })
  if (state?.direct) separateOrder.set('direct', '1')

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mx-4 mt-4 p-3 border border-red-200 bg-red-50 text-red-800"
        >
          {error}
        </p>
      )}
      {openedForm && !conflictDraft && (!state || state.status === 'empty') && (
        <div hidden={!state}>
          {initialDraft && (
            <div className="m-4 md:m-6 card p-4 space-y-2">
              <p>Review your draft for this separate order. Enter any applicable order, UC or invoice references.</p>
              {needsOriginal && (
                <label className="block">
                  Reattach the original PI ({initialDraft.original.name}) to create this order
                  <input type="file" accept="image/*,.pdf" className="block mt-1"
                    disabled={checkingOriginal} onChange={(e) => {
                      attachDraftOriginal(e.target.files[0])
                      e.target.value = ''
                    }} />
                </label>
              )}
            </div>
          )}
          <ShipmentForm onCreateOrder={submit} initialDraft={initialDraft}
            originalFile={originalFile} createBlocked={Boolean(needsOriginal)} />
        </div>
      )}
      {state?.status !== 'empty' && (
        <section
          className="m-4 md:m-6 card p-4 space-y-3"
          aria-label="Saved order request"
        >
          <Link to="/shipping" className="text-brand-600">
            ← Shipping
          </Link>
          <h1 className="text-xl">
            {state?.source_id
              ? 'Order copy'
              : state?.direct
                ? 'Direct Invoice'
                : 'Saved order request'}
          </h1>
          {!state &&
            (error ? (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={checkSavedStatus}
              >
                Check saved status
              </button>
            ) : (
              <p role="status">Checking the order request…</p>
            ))}
          {state && (
            <>
              <p>
                {[
                  state.customer,
                  state.customer_po,
                  `${state.line_count} lines`,
                  state.total != null
                    ? state.currency + ' ' + state.total
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {state.source_id && (
                <p>
                  <Link
                    className="text-brand-600"
                    to={'/shipments/' + state.source_id}
                  >
                    View source order {state.source_label}
                  </Link>
                </p>
              )}
              {state.source_id && state.uc && (
                <p>
                  Issued {state.uc}{' '}
                  {state.status === 'prepared' && '· Order copy pending'}
                </p>
              )}
              {state.source_id && state.uc_started && !state.uc && (
                <p role="status">
                  UC issuance has started. Resume this copy to confirm its
                  number.
                </p>
              )}
              {state.status === 'committed' && state.invoice && (
                <>
                  <p role="status">
                    {state.invoice.si
                      ? `${state.invoice.state === 'supplied' ? 'Supplied invoice' : 'Invoice'} ${state.invoice.si}`
                      : 'Order saved.'}
                    {state.invoice.state === 'due' &&
                      ' The first invoice is ready to issue.'}
                    {state.invoice.state === 'pending' &&
                      ' Resume the first invoice request to confirm issuance and linking.'}
                  </p>
                  {state.invoice.message && (
                    <p role="alert">{state.invoice.message}</p>
                  )}
                  {needsInitialInvoice(state.invoice.state) && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={finishDirectInvoice}
                    >
                      {busy ? 'Checking…' : 'Finish Direct Invoice'}
                    </button>
                  )}
                </>
              )}
              {state.uc_error && <p role="alert">{state.uc_error}</p>}
              {state.file && <p>{state.file.name}</p>}
              {state.lines && (
                <details>
                  <summary>Review saved line items</summary>
                  <ul className="mt-2 space-y-1">
                    {state.lines.map((line, i) => (
                      <li key={i}>
                        {[line.item_code, line.description]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        · {line.qty_ordered ?? '—'} {line.unit} ×{' '}
                        {state.currency} {line.unit_price ?? '—'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {state.status === 'review' ? (
                <p role="alert"><strong>Needs review</strong> · {state.review_message}</p>
              ) : state.status === 'committed' ? (
                <Link
                  className="btn-primary inline-block"
                  to={'/shipments/' + state.order_id}
                >
                  Open saved order{state.so ? ' · ' + state.so : ''}
                </Link>
              ) : (
                <div className="space-y-3">
                  {(state.needs_file || (state.file && error)) && (
                    <label className="block">
                      Select the original PI to finish this order
                      <input
                        type="file"
                        className="block mt-1"
                        disabled={busy}
                        onChange={(e) => selectOriginal(e.target.files[0] || null)}
                      />
                    </label>
                  )}
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={resumeOrder}
                  >
                    {busy
                      ? 'Checking…'
                      : state.source_id
                        ? 'Finish order copy'
                        : 'Resume saved request'}
                  </button>
                </div>
              )}
              {conflictDraft ? (
                <div className="space-y-2 border-t border-warm-grey pt-3">
                  <p>Your unsaved changes are available for a separate order.</p>
                  <button type="button" className="btn-secondary" disabled={busy}
                    onClick={useDraftForSeparateOrder}>
                    {conflictDraft.separateId ? 'Open separate request' : 'Use my draft for a separate order'}
                  </button>
                </div>
              ) : state.source_id ? (
                <button
                  className="btn-secondary block"
                  disabled={busy}
                  onClick={makeAnotherCopy}
                >
                  Make another copy
                </button>
              ) : (
                <Link
                  className="block text-brand-600"
                  to={{
                    pathname: '/shipments/new',
                    search: separateOrder.toString()
                  }}
                >
                  {state.direct
                    ? 'Start a separate Direct Invoice'
                    : 'Start a separate order'}
                </Link>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
