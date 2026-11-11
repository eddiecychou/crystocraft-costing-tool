import { useEffect, useRef, useState } from 'react'
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom'
import ShipmentForm from './ShipmentForm'
import {
  beginOrderCopy,
  describePi,
  finishOrderRequest,
  orderRequestAction
} from '../orderCreateRequest'
import {
  requestUrl,
  validRequestId,
  needsInitialInvoice
} from '../orderCreateRequestModel.js'

function StartRequest({ uid, params }) {
  const [id] = useState(() => crypto.randomUUID())
  return <Navigate replace to={requestUrl(uid, id, params)} />
}

export default function NewShipmentEntry({ uid }) {
  const [params] = useSearchParams()
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
  return <RequestEditor key={uid + ':' + id} operator={uid} id={id} />
}

function RequestEditor({ operator, id }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const separateOrder = new URLSearchParams(params)
  separateOrder.delete('request')
  separateOrder.delete('operator')
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const location = useLocation()
  const [error, setError] = useState(location.state?.requestError || '')
  const active = useRef(false)
  const inFlight = useRef(false)
  const selectedFile = useRef(null)
  const [openedForm, setOpenedForm] = useState(false)
  const key = { operator, id }
  if (state?.direct) separateOrder.set('direct', '1')

  async function check() {
    const result = await orderRequestAction('status', key)
    if (active.current) {
      setState(result)
      if (result.status === 'empty') setOpenedForm(true)
    }
    return result
  }
  useEffect(() => {
    let alive = true
    active.current = true
    orderRequestAction('status', { operator, id })
      .then((result) => {
        if (alive) {
          setState(result)
          if (result.status === 'empty') setOpenedForm(true)
        }
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
      active.current = false
    }
  }, [operator, id])

  async function run(action) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (!active.current) return
      setState(result)
      if (result.id && result.id !== id)
        navigate(requestUrl(operator, result.id))
      else if (
        result.status === 'committed' &&
        (!result.direct ||
          ['issued', 'supplied'].includes(result.invoice?.state))
      )
        navigate('/shipments/' + result.order_id)
    } catch (err) {
      if (!active.current) return
      setError(err.message)
      try {
        await check()
      } catch {
        if (active.current) setState(null)
      }
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }
  async function submit(order, lines, file) {
    selectedFile.current = file
    return run(async () => {
      const descriptor = await describePi(file)
      const saved = await orderRequestAction('prepare', {
        ...key,
        order,
        lines,
        file: descriptor,
        mode: params.get('direct') === '1' ? 'direct' : undefined
      })
      if (saved.status === 'committed' && !saved.direct) return saved
      return finishOrderRequest(key, file, saved.file)
    })
  }

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
      {openedForm && (!state || state.status === 'empty') && (
        <div hidden={!state}>
          <ShipmentForm onCreateOrder={submit} />
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
                onClick={() => run(check)}
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
                      onClick={() => run(() => finishOrderRequest(key))}
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
                <p role="alert">{state.review_message}</p>
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
                        onChange={(e) => {
                          selectedFile.current = e.target.files[0] || null
                        }}
                      />
                    </label>
                  )}
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        finishOrderRequest(
                          key,
                          selectedFile.current,
                          state.file
                        )
                      )
                    }
                  >
                    {busy
                      ? 'Checking…'
                      : state.source_id
                        ? 'Finish order copy'
                        : 'Resume saved request'}
                  </button>
                </div>
              )}
              {state.source_id ? (
                <button
                  className="btn-secondary block"
                  disabled={busy}
                  onClick={() =>
                    run(() => beginOrderCopy(operator, state.source_id, id))
                  }
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
