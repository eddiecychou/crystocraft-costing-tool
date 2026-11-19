import { asOcDate, formatOcDate } from '../ocTime.js'
import { useState, useEffect, useMemo } from 'react'
import { myOrderHistory, myOcInvoiceHistory } from '../customerOrderHistoryApi'
import { buyerInvoiceHistory } from '../domain/customerInvoiceHistory'
import { Receipt, ChevronDown, ChevronUp } from 'lucide-react'

const fmtDate = d => {
  if (!d) return '—'
  const dt = asOcDate(d)
  return Number.isNaN(dt.getTime()) ? '—' : formatOcDate(dt, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB')
}

export default function OrderHistoryPage({ profile }) {
  return <InvoiceHistory key={JSON.stringify([profile?.id,profile?.customer_id])} />
}

function InvoiceHistory() {
  const oc = useInvoiceSource(myOcInvoiceHistory)
  const jes = useInvoiceSource(myOrderHistory)
  const [invoicesOpen, setInvoicesOpen] = useState(true)
  const [invoicesShown, setInvoicesShown] = useState(10)
  const invoiceHistory = useMemo(() => buyerInvoiceHistory(oc.data?.rows || [], jes.data?.rows || []),
    [oc.data, jes.data])
  const empty = oc.data && jes.data && invoiceHistory.length === 0

  return (
    <div>
      <h1 className="text-xl md:text-2xl text-ink mb-1">My Orders</h1>
      <p className="text-sm text-ink-60 mb-5">Your order and invoice history with Crystocraft.</p>

      <div>
        <button type="button" onClick={() => setInvoicesOpen(v => !v)}
                aria-expanded={invoicesOpen}
                className="w-full flex items-center justify-between mb-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
          <h2 className="eyebrow text-bronze">Sales Invoice History</h2>
          {invoicesOpen ? <ChevronUp size={16} className="text-ink-60" /> : <ChevronDown size={16} className="text-ink-60" />}
        </button>
        {invoicesOpen && <>
          <SourceNotice name="OC" source={oc} />
          <SourceNotice name="JES" source={jes} />
          {empty && (jes.data.shared ? (
            <div className="card p-6 text-center">
              <p className="eyebrow text-ink-60 mb-1.5">Not linked to this account</p>
              <p className="text-sm text-ink-60">Your invoice history isn't linked to an individual account yet — contact us if you'd like a copy of a past invoice.</p>
            </div>
          ) : (
            <div className="card p-6 text-center">
              <p className="eyebrow text-ink-60 mb-1.5">Nothing yet</p>
              <p className="text-sm text-ink-60">No invoices on file yet.</p>
            </div>
          ))}
          {invoiceHistory.length > 0 && (
            <div className="card divide-y divide-ivory-dark">
              {invoiceHistory.slice(0, invoicesShown).map(r => {
                const Row = r.href ? 'a' : 'div'
                return (
                <Row key={r.key} href={r.href || undefined} target={r.href ? '_blank' : undefined} rel={r.href ? 'noopener' : undefined}
                     className={`flex items-center justify-between px-4 py-3 ${r.href ? 'hover:bg-ivory focus-visible:ring-2 focus-visible:ring-brand-500' : ''}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Receipt size={14} className="text-ink-60 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {r.no || '—'}
                        {/* r.uc (JES siref / app uc_no) already reads "UC4920/26" — no extra label prefix, or it doubles up. */}
                        {r.uc && <span className="ml-1.5 text-xs font-mono text-ink-60">{r.uc}</span>}
                      </p>
                      <p className="text-xs text-ink-60 mt-0.5">{fmtDate(r.date)}{r.currency ? ` · ${r.currency}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.amount != null && <span className="text-sm text-ink-70 tabular-nums">{Number(r.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                    <span className="badge bg-ivory-dark text-ink-60">{r.href ? 'CONFIRMED' : 'Original unavailable'}</span>
                  </div>
                </Row>
                )
              })}
              {invoiceHistory.length > invoicesShown && (
                <button type="button" onClick={() => setInvoicesShown(n => n + 20)}
                        className="w-full text-xs text-brand-600 hover:text-brand-800 text-center py-2.5">
                  …and {invoiceHistory.length - invoicesShown} more — show more
                </button>
              )}
            </div>
          )}
        </>}
      </div>

    </div>
  )
}

function useInvoiceSource(load) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  useEffect(() => {
    const request = new AbortController()
    const timeout = setTimeout(() => {
      request.abort()
      setResult({attempt, failed: true})
    }, 30000)
    load(request.signal).then(
      data => { if (!request.signal.aborted) setResult({attempt, data}) },
      () => { if (!request.signal.aborted) setResult({attempt, failed: true}) },
    ).finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); request.abort() }
  }, [load, attempt])
  const current = result?.attempt === attempt ? result : null
  return {data: current?.data, failed: current?.failed, loading: !current, retry: () => setAttempt(n => n + 1)}
}

function SourceNotice({name, source}) {
  if (source.loading) return <p role="status" className="text-sm text-ink-60 mb-3">Loading {name} invoices…</p>
  if (!source.failed) return null
  return (
    <div role="alert" className="card flex flex-wrap items-center justify-between gap-x-3 px-4 py-1 mb-3 text-sm">
      <span>{name} invoice history is temporarily unavailable.</span>
      <button type="button" onClick={source.retry} className="min-h-11 text-brand-600 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-brand-500">
        Retry {name}
      </button>
    </div>
  )
}
