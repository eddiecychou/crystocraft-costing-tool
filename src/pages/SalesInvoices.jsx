import { useState, useMemo, useEffect } from 'react'
import ExportFilterBar from '../components/ExportFilterBar'
import { downloadCsv, exportStem, inDateRange } from '../exportCsv'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, updateOrder, NO_INVOICE_REASONS, noInvoiceReasonOf } from '../shipping'
import { listAppInvoices, upsertInvoice } from '../ucRegistry'
import { erpLookup } from '../erpApi'
import { Receipt, AlertTriangle, FileText, Database } from 'lucide-react'
import ErpDocModal from '../components/ErpDocModal'

// Sales Invoices. An invoice is not a separate record here — it is an order
// that has been given an invoice number, which mirrors how CuiLing actually
// works in JES: "Load Document" builds the SI from the sales order rather than
// re-keying it. Keeping one record avoids the header/total drift that two
// records invite, and the PBIS export reads the same figures the customer sees.
//
// The list is deliberately split into invoiced and awaiting-invoice, because
// "which shipped orders have not been invoiced yet" is the question this page
// exists to answer.

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtValue = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

// Shipped or delivered but with no invoice number — the orders that owe an
// invoice. Draft and in-progress orders are not late, they are just early.
const AWAITING = new Set(['shipped', 'delivered'])

// Cap the preview. Unbounded, this block rendered 66 rows and pushed the actual
// invoice list — the point of the page — entirely below the fold.
const AWAITING_PREVIEW = 5

// Historical invoices are READ from the ERP mirror, never imported. Copying
// 5,455 JES invoices into Firestore would duplicate the system of record and
// invite the two to drift; the mirror is already the archive (see
// JES-RETIREMENT-PLAN.md §9 — "the Supabase archive remains as history").
// So JES rows are visible and searchable here but not editable, and they carry
// no Print action: the app cannot reissue a document JES produced.
function useErpInvoices(search) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    // Debounced — every keystroke would otherwise hit the edge function.
    const t = setTimeout(() => {
      erpLookup('sales_invoice', { q: search.trim(), limit: 100 })
        .then((r) => { if (alive) setRows(r || []) })
        .catch((e) => { if (alive) { setError(e.message || 'Could not reach the ERP archive.'); setRows([]) } })
        .finally(() => { if (alive) setLoading(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [search])

  return { rows, loading, error }
}

export default function SalesInvoices() {
  const navigate = useNavigate()
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')
  const [showAllAwaiting, setShowAllAwaiting] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [erpDoc, setErpDoc] = useState(null)   // JES invoice being viewed, read-only
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [srcFilter, setSrcFilter] = useState('')   // '' | 'app' | 'jes'
  const [ledger, setLedger] = useState(null)      // Postgres rows, or null while loading
  const [fixing, setFixing] = useState(false)
  const [showDrift, setShowDrift] = useState(false)

  const erp = useErpInvoices(search)

  const { invoiced, awaiting, resolved } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (o) =>
      !q || `${o.customer_name} ${o.erp_si_no} ${o.erp_so_no} ${o.uc_no}`.toLowerCase().includes(q)
    const all = orders.filter(match)
    return {
      invoiced: all
        .filter((o) => o.erp_si_no)
        .sort((a, b) => (b.invoiced_at || b.order_date || '').localeCompare(a.invoiced_at || a.order_date || '')),
      // Newest first. This was oldest-first on the reasoning that the oldest is
      // the most overdue — but the tail is pre-app JES history that will never
      // be invoiced here, so it buried the recent orders that actually need
      // acting on under two years of noise.
      awaiting: all
        .filter((o) => !o.erp_si_no && AWAITING.has(o.status) && !o.no_invoice_reason)
        .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')),
      // Dismissed, kept visible so the decision can be reviewed or undone.
      resolved: all.filter((o) => !o.erp_si_no && AWAITING.has(o.status) && o.no_invoice_reason),
    }
  }, [orders, search])

  // Marking an order as never-to-be-invoiced. Written straight through rather
  // than via a confirm: it is trivially reversible from the resolved list, and
  // there are 66 of these to work through.
  async function setNoInvoice(o, reason) {
    await updateOrder(o.id, {
      no_invoice_reason: reason,
      no_invoice_at: reason ? new Date().toISOString().slice(0, 10) : null,
    })
  }

  // The financial record as Postgres holds it. Firestore is the source of
  // truth; this is a copy, and a copy nobody checks is worse than no copy —
  // it invites trust it has not earned.
  useEffect(() => {
    let alive = true
    listAppInvoices(1000).then(r => { if (alive) setLedger(r) })
    return () => { alive = false }
  }, [])

  // One list, two sources. Which system an invoice lives in is an implementation
  // detail to the person looking for it, so they are merged and sorted by date —
  // but each row says where it came from, because what you can DO with it
  // differs. App rows print; JES rows are history.
  const merged = useMemo(() => {
    const app = invoiced.map((o) => ({
      key: `app-${o.id}`, src: 'app', id: o.id,
      no: o.erp_si_no, date: o.invoiced_at || o.order_date,
      so: o.erp_so_no, uc: o.uc_no, customer: o.customer_name,
      currency: o.currency, amount: o.total_amount ?? o.subtotal, status: null,
    }))
    // The app's own invoices may also exist in the mirror once a sync runs;
    // showing both would double-count. The app row wins — it is the live one.
    const appNos = new Set(app.map((r) => (r.no || '').trim().toUpperCase()))
    const jes = (erp.rows || [])
      .filter((r) => !appNos.has((r.code || '').trim().toUpperCase()))
      .map((r) => ({
        key: `erp-${r.code}`, src: 'jes', id: null,
        no: (r.code || '').trim(), date: r.date,
        so: null, uc: (r.ref || '').trim(), customer: r.customer,
        currency: r.currency, amount: r.amount, status: (r.status || '').trim().toUpperCase(),
        raw: r,
      }))
    return [...app, ...jes].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }, [invoiced, erp.rows])

  // Reconcile Firestore against Postgres. Compares only the fields the ledger
  // claims to hold — comparing anything else would report drift that does not
  // matter. Money is compared to 2dp because a float round-trip is not a
  // disagreement about the invoice.
  const drift = useMemo(() => {
    if (!ledger) return null
    const byNo = new Map(ledger.map((r) => [String(r.si_no || '').trim().toUpperCase(), r]))
    const money = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100) / 100)
    const out = []
    for (const o of invoiced) {
      const no = String(o.erp_si_no || '').trim().toUpperCase()
      if (!no) continue
      const row = byNo.get(no)
      if (!row) { out.push({ order: o, no, why: 'not in the financial record' }); continue }
      const diffs = []
      if (money(row.total) !== money(o.total_amount ?? o.subtotal)) diffs.push('total')
      if ((row.currency || '') !== (o.currency || '')) diffs.push('currency')
      if ((row.uc_no || '') !== (o.uc_no || '')) diffs.push('UC')
      if ((row.customer || '') !== (o.customer_name || '')) diffs.push('customer')
      if (diffs.length) out.push({ order: o, no, why: `${diffs.join(', ')} differ${diffs.length === 1 ? 's' : ''}` })
    }
    return out
  }, [ledger, invoiced])

  // Re-send every drifting order. Safe to re-run: the upsert keys on si_no.
  async function resync() {
    setFixing(true)
    try {
      for (const d of drift || []) {
        await upsertInvoice({
          si_no: d.order.erp_si_no, uc_no: d.order.uc_no || null, order_id: d.order.id,
          customer: d.order.customer_name, currency: d.order.currency,
          total: d.order.total_amount ?? d.order.subtotal ?? null,
          invoiced_at: d.order.invoiced_at || null,
        })
      }
      setLedger(await listAppInvoices(1000))
    } finally { setFixing(false) }
  }

  // The export set. Filtering here rather than inside `merged` keeps the
  // page's own two-source de-duplication intact — dropping a JES row by date
  // before de-duplication could let an app duplicate of it back in.
  const exportable = useMemo(() => merged.filter((r) => {
    if (srcFilter && r.src !== srcFilter) return false
    return inDateRange(r.date, from, to)
  }), [merged, srcFilter, from, to])

  // JES rows are read from the mirror, so an export mixing both sources is
  // only as current as the last sync — the Source column says which is which.
  const INVOICE_COLUMNS = [
    { label: 'Invoice no.', value: (r) => r.no, text: true },
    { label: 'Date',        value: (r) => r.date },
    { label: 'UC#',         value: (r) => r.uc, text: true },
    { label: 'SO no.',      value: (r) => r.so, text: true },
    { label: 'Customer',    value: (r) => r.customer },
    { label: 'Currency',    value: (r) => r.currency },
    { label: 'Amount',      value: (r) => r.amount },
    { label: 'Status',      value: (r) => r.status || '' },
    { label: 'Source',      value: (r) => (r.src === 'app' ? 'App' : 'JES') },
  ]

  const exportInvoices = () => downloadCsv(
    exportStem('sales-invoices', { from, to, type: srcFilter }),
    INVOICE_COLUMNS, exportable,
  )

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-4 border-b border-ivory-dark">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl md:text-2xl">Sales Invoices</h1>
          {/* A direct invoice needs its own front door. Smaller retail sales are
              invoiced without a sales order at all, so routing them through
              "Production → Import PI" would be both wrong and confusing. */}
          <Link to="/shipments/new?direct=1" className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-1.5">
            <Receipt size={15} /> Direct Invoice
          </Link>
        </div>
        <p className="text-sm text-ink-50 mt-1">
          An invoice needs a UC number; a sales order is optional — retail sales are invoiced directly.
        </p>
      </div>

      <div className="p-4 md:p-6">
        {loading && <LoadingBar />}
        {erpDoc && <ErpDocModal of="sales_invoice" doc={erpDoc} onClose={() => setErpDoc(null)} />}

        {/* Reconciliation. Silence here means the two records agree — which is
            the only way a copy earns any trust. */}
        {drift && drift.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-amber-800 inline-flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600" />
                {drift.length} invoice{drift.length === 1 ? '' : 's'} out of step with the financial record
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setShowDrift(v => !v)}
                  className="text-xs text-amber-800 hover:text-amber-900 underline underline-offset-2">
                  {showDrift ? 'Hide' : 'Show'}
                </button>
                <button type="button" onClick={resync} disabled={fixing}
                  className="text-xs font-medium px-2.5 py-1 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  {fixing ? 'Re-syncing…' : 'Re-sync all'}
                </button>
              </div>
            </div>
            <p className="text-xs text-amber-700/80 mt-0.5">
              The order in the app is the source of truth; this is its copy in Supabase, used for exports and the books.
              Re-syncing rewrites the copy from the order.
            </p>
            {showDrift && (
              <ul className="mt-2 space-y-0.5">
                {drift.slice(0, 30).map((d) => (
                  <li key={d.no} className="text-xs text-amber-900">
                    <span className="font-mono">{d.no}</span> — {d.why}
                    <span className="text-amber-700/70"> · {d.order.customer_name || 'Unnamed'}</span>
                  </li>
                ))}
                {drift.length > 30 && <li className="text-xs text-amber-700/70">…and {drift.length - 30} more</li>}
              </ul>
            )}
          </div>
        )}

        <ExportFilterBar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          typeLabel="Source" typeValue={srcFilter} onType={setSrcFilter}
          typeOptions={[{ value: 'app', label: 'Raised in app' }, { value: 'jes', label: 'JES (history)' }]}
          count={exportable.length} total={merged.length} noun="invoices"
          onExport={exportInvoices} disabled={loading}
        />

        <input type="text" placeholder="Search by customer, invoice no, SO no, UC#…"
          className="input w-full mb-4" value={search} onChange={(e) => setSearch(e.target.value)} />

        {awaiting.length > 0 && (
          <div className="card mb-5 overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-amber-800 inline-flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-600" />
                  {awaiting.length} order{awaiting.length === 1 ? '' : 's'} with no invoice recorded in the app
                </p>
                {awaiting.length > AWAITING_PREVIEW && (
                  <button type="button" onClick={() => setShowAllAwaiting(v => !v)}
                          className="text-xs text-amber-800 hover:text-amber-900 underline underline-offset-2">
                    {showAllAwaiting ? 'Show fewer' : `Show all ${awaiting.length}`}
                  </button>
                )}
              </div>
              {/* Most of these are pre-app orders imported from JES — their
                  invoice exists there, it was just never recorded here. Saying
                  "shipped without an invoice" claimed something untrue about
                  historical data and made 66 rows look like 66 problems. */}
              <p className="text-xs text-amber-700/80 mt-0.5">
                Newest first. Orders imported from JES were invoiced there — search the invoice or UC number to check
                before raising one, then mark it so it leaves this list.
              </p>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {(showAllAwaiting ? awaiting : awaiting.slice(0, AWAITING_PREVIEW)).map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/shipments/${o.id}`)}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(o.order_date)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-mono text-xs">{o.erp_so_no || '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{o.customer_name || 'Unnamed customer'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{o.currency}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-gray-800">
                      {fmtValue(o.total_amount ?? o.subtotal)}
                    </td>
                    {/* stopPropagation: the row itself navigates to the order,
                        and picking a reason must not do both. */}
                    <td className="px-4 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <select
                        value=""
                        onChange={(e) => e.target.value && setNoInvoice(o, e.target.value)}
                        className="text-xs border border-amber-200 bg-white rounded px-1.5 py-1 text-amber-800 hover:border-amber-400 cursor-pointer"
                        title="This order will not be invoiced in the app — say why, and it leaves this list">
                        <option value="">needs invoice ▾</option>
                        {NO_INVOICE_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {resolved.length > 0 && (
          <div className="mb-5">
            <button type="button" onClick={() => setShowResolved(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">
              {showResolved ? 'Hide' : 'Show'} {resolved.length} order{resolved.length === 1 ? '' : 's'} marked as not needing an invoice
            </button>
            {showResolved && (
              <div className="card mt-2 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {resolved.map((o) => (
                      <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/shipments/${o.id}`)}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{fmtDate(o.order_date)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-mono text-xs">{o.erp_so_no || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-700">{o.customer_name || 'Unnamed customer'}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-gray-600">
                          {fmtValue(o.total_amount ?? o.subtotal)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                                title={noInvoiceReasonOf(o.no_invoice_reason)?.hint}>
                            {noInvoiceReasonOf(o.no_invoice_reason)?.label || o.no_invoice_reason}
                          </span>
                          {o.no_invoice_at && <span className="text-[11px] text-gray-400 ml-1.5">{o.no_invoice_at}</span>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => setNoInvoice(o, '')}
                            className="text-xs text-gray-500 hover:text-brand-600 underline underline-offset-2"
                            title="Put this order back in the needs-invoice list">
                            Undo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <p className="text-sm text-gray-500">
            {merged.length} invoice{merged.length === 1 ? '' : 's'}
            {erp.rows.length > 0 && <span className="text-gray-400"> · {invoiced.length} in the app, {merged.length - invoiced.length} from JES</span>}
          </p>
          {erp.loading && <span className="text-xs text-gray-400">loading JES history…</span>}
        </div>

        {erp.error && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            JES history unavailable — {erp.error}
          </p>
        )}

        {merged.length === 0 && !loading && !erp.loading ? (
          <div className="text-center py-16 text-gray-400">
            <Receipt size={28} className="mx-auto mb-3 opacity-40" />
            {search ? 'No invoices match your search.' : 'No invoices yet. Open an order and allocate an invoice number to raise one.'}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Invoice No</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">SO No</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">UC#</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cur</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Total</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {merged.map((r) => {
                  const isApp = r.src === 'app'
                  // App rows open the order; JES rows open a read-only viewer.
                  // Both are clickable — read-only should not mean opaque.
                  const open = () => isApp ? navigate(`/shipments/${r.id}`) : setErpDoc(r.raw)
                  // A voided JES invoice is not a live document — it is excluded
                  // from the PBIS import, so it must not read as a normal row.
                  const void_ = r.status === 'VOID'
                  return (
                    <tr key={r.key} className={`transition-colors hover:bg-gray-50 ${void_ ? 'opacity-60' : ''}`}>
                      <td className={`px-4 py-3 whitespace-nowrap font-mono text-xs font-medium cursor-pointer ${isApp ? 'text-gray-900' : 'text-gray-600'}`}
                          onClick={open}>
                        {r.no || '—'}
                        {void_ && <span className="ml-1.5 text-[10px] font-sans font-medium text-red-600">VOID</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 cursor-pointer" onClick={open}>{fmtDate(r.date)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">{r.so || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">{r.uc || '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 min-w-0 cursor-pointer" onClick={open}>
                        <span className="truncate">{r.customer || 'Unnamed customer'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">{r.currency}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">{fmtValue(r.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {isApp ? (
                          <Link to={`/shipments/${r.id}/invoice`} target="_blank" rel="noreferrer"
                                className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
                            <FileText size={12} /> Print
                          </Link>
                        ) : (
                          <span title="Historical invoice from JES — read-only archive"
                                className="text-[10px] font-medium text-ink-40 inline-flex items-center gap-1 border border-ivory-dark rounded-full px-2 py-0.5">
                            <Database size={10} /> JES
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
