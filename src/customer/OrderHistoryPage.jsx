import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { myOrderHistory } from '../customerOrderHistoryApi'
import { mergeSalesInvoiceHistory } from '../domain/salesInvoiceHistory'
import { Receipt, ChevronDown, ChevronUp } from 'lucide-react'

const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// "My Orders" — owner, 2026-08-07: "let customers be able to see their order
// history on portal", then: "combine both in JES and in App sales invoice
// in 'Sales Invoice History'... sales invoices should be clickable... an
// icon to expand and collapse... more on bottom to see more." Then, after a
// real click-through: "the orders and [sales invoices are] duplicated...
// very confusing. I rather only display the sales invoices which is
// confirmed. The sales orders is for our internal so it is not necessary to
// show to customers." So: ONE list, confirmed invoices only — the separate
// "Orders" section (general in-production status) was dropped entirely.
//
// Sales Invoice History: what's actually been sold to this customer, merged
// from the app's own invoiced orders AND legacy JES invoices
// (domain/salesInvoiceHistory.js — same merge CustomerDetail.jsx's admin
// view uses, minus the App/JES source badge — a customer doesn't need to
// know which system it lives in), filtered to confirmed only (an app row's
// invoiced-ness IS its confirmation; a JES row needs status === 'CONFIRMED'
// — VOID/other statuses are an internal JES state, not something to show).
// Clicking a row opens the invoice's own formatted print/PDF page
// (CustomerInvoicePrint.jsx, /shop/invoice/:key — "the clicked view needs
// to be more serious, with the same format as our sales invoices, and
// customer can view and download with PDF or Excel") in a NEW TAB
// (window.open, not navigate()) — "open new page instead of staying in
// same page... unless you add a back button" (owner, 2026-08-07). Same
// pattern the admin Sales Invoices page already uses for its own invoice
// link (target="_blank"), so this list stays put behind it rather than
// being replaced. Some accounts' ERP
// code is a shared JES "bucket" code (owner confirmed A29/C13/O07 each
// cover many different real customers) — `shared: true` from the edge
// function means history genuinely can't be attributed to just this
// customer, so it's explained, not just empty.
export default function OrderHistoryPage({ profile }) {
  const customerId = profile?.customer_id || null
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [erpRows, setErpRows] = useState([])
  const [erpShared, setErpShared] = useState(false)
  const [erpLoading, setErpLoading] = useState(true)
  const [invoicesOpen, setInvoicesOpen] = useState(true)
  const [invoicesShown, setInvoicesShown] = useState(10)

  useEffect(() => {
    if (!customerId) { setOrders([]); setOrdersLoading(false); return }
    let alive = true
    setOrdersLoading(true)
    getDocs(query(collection(db, 'orders'), where('customer_id', '==', customerId)))
      .then(snap => {
        if (!alive) return
        setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
      .catch(() => { if (alive) setOrders([]) })
      .finally(() => { if (alive) setOrdersLoading(false) })
    return () => { alive = false }
  }, [customerId])

  useEffect(() => {
    let alive = true
    setErpLoading(true)
    myOrderHistory()
      .then(({ rows, shared }) => { if (alive) { setErpRows(rows); setErpShared(shared) } })
      .finally(() => { if (alive) setErpLoading(false) })
    return () => { alive = false }
  }, [])

  // Draft is excluded BEFORE the merge, not after: mergeSalesInvoiceHistory's
  // 'app' branch only checks invoicedAlready() (has an erp_si_no) — invoice
  // allocation isn't gated on order status, so a draft order that already
  // carries an SI number (allocated early, or reverted back to draft after)
  // would otherwise pass straight through as "src === 'app'" and render as a
  // confirmed invoice to the customer. Scoped to this portal page only —
  // SalesInvoices.jsx / CustomerDetail.jsx are admin-only internal tracking
  // and legitimately want to see it regardless of status (bug-fix pack B-04).
  const invoiceHistory = useMemo(
    () => mergeSalesInvoiceHistory(orders.filter(o => o.status !== 'draft'), erpRows, null)
      .filter(r => r.src === 'app' || r.status === 'CONFIRMED'),
    [orders, erpRows],
  )
  const historyLoading = ordersLoading || erpLoading

  return (
    <div>
      <h1 className="text-xl md:text-2xl text-ink mb-1">My Orders</h1>
      <p className="text-sm text-ink-60 mb-5">Your order and invoice history with Crystocraft.</p>

      <div>
        <button type="button" onClick={() => setInvoicesOpen(v => !v)}
                className="w-full flex items-center justify-between mb-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
          <h2 className="eyebrow text-bronze">Sales Invoice History</h2>
          {invoicesOpen ? <ChevronUp size={16} className="text-ink-60" /> : <ChevronDown size={16} className="text-ink-60" />}
        </button>
        {invoicesOpen && (
          historyLoading ? (
            <p className="text-sm text-ink-60 py-6 text-center">Loading…</p>
          ) : erpShared && invoiceHistory.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="eyebrow text-ink-60 mb-1.5">Not linked to this account</p>
              <p className="text-sm text-ink-60">Your invoice history isn't linked to an individual account yet — contact us if you'd like a copy of a past invoice.</p>
            </div>
          ) : invoiceHistory.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="eyebrow text-ink-60 mb-1.5">Nothing yet</p>
              <p className="text-sm text-ink-60">No invoices on file yet.</p>
            </div>
          ) : (
            <div className="card divide-y divide-ivory-dark">
              {invoiceHistory.slice(0, invoicesShown).map(r => {
                const openInvoice = () => window.open(`/shop/invoice/${r.key}`, '_blank', 'noopener')
                return (
                <div key={r.key} onClick={openInvoice}
                     role="button" tabIndex={0}
                     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInvoice() } }}
                     className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-ivory transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset">
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
                    {/* An app row's status is always null by design (domain/
                        salesInvoiceHistory.js: "an app row's invoiced-ness IS
                        its confirmation") — shown here as CONFIRMED rather
                        than no badge at all, which read as "not confirmed"
                        next to a JES row's real CONFIRMED pill (found live,
                        2026-08-21). */}
                    <span className="badge bg-ivory-dark text-ink-60">{r.status || 'CONFIRMED'}</span>
                  </div>
                </div>
                )
              })}
              {invoiceHistory.length > invoicesShown && (
                <button type="button" onClick={() => setInvoicesShown(n => n + 20)}
                        className="w-full text-xs text-brand-600 hover:text-brand-800 text-center py-2.5">
                  …and {invoiceHistory.length - invoicesShown} more — show more
                </button>
              )}
            </div>
          )
        )}
      </div>

    </div>
  )
}
