import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { orderRequestAction } from '../../orderCreateRequest'
import {
  requestUrl,
  needsInitialInvoice
} from '../../orderCreateRequestModel.js'

export default function SavedOrderRequests({ uid }) {
  return uid ? <OperatorOrderRequests key={uid} uid={uid} /> : null
}

function OperatorOrderRequests({ uid }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [next, setNext] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const activeRead = useRef(null)

  useEffect(() => () => {
    activeRead.current = null
  }, [])

  async function load(cursor) {
    if (activeRead.current) return
    const read = {}
    activeRead.current = read
    setBusy(true)
    setError(null)
    try {
      const page = await orderRequestAction('list', { cursor })
      if (activeRead.current !== read) return
      setRows((old) => (cursor ? [...old, ...page.requests] : page.requests))
      setNext(page.next)
    } catch (err) {
      if (activeRead.current === read)
        setError({ message: err.message, cursor })
    } finally {
      if (activeRead.current === read) {
        activeRead.current = null
        setBusy(false)
      }
    }
  }
  return (
    <div className="mb-4">
      <button
        type="button"
        className="text-sm text-brand-600"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            activeRead.current = null
            setBusy(false)
          } else {
            load(null)
          }
          setOpen(!open)
        }}
      >
        My saved order requests
      </button>
      {open && (
        <div className="mt-2 card p-3 text-sm space-y-2">
          {error && (
            <p role="alert">
              {error.message}{' '}
              <button type="button" disabled={busy} onClick={() => load(error.cursor)}>
                Retry
              </button>
            </p>
          )}
          {!rows.length && !error && (
            <p>{busy ? 'Loading…' : 'No saved order requests.'}</p>
          )}
          {rows.map((row) => (
            <Link
              key={row.id}
              className="block text-brand-600"
              to={requestUrl(uid, row.id)}
            >
              {row.status === 'prepared' ||
              needsInitialInvoice(row.invoice?.state)
                ? 'Resume'
                : 'Open'}
              {row.source_id ? ' copy' : row.direct ? ' Direct Invoice' : ''} ·{' '}
              {[
                row.invoice?.si,
                row.so,
                row.source_label,
                row.customer,
                row.customer_po,
                row.file?.name
              ]
                .filter(Boolean)
                .join(' · ') || 'Order'}{' '}
              · {row.line_count} lines
            </Link>
          ))}
          {next && (
            <button type="button" disabled={busy} onClick={() => load(next)}>
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
