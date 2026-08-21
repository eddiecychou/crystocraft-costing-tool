import { useState, Fragment } from 'react'
import { listWooOrders, wooOrderMeta } from '../wooSyncApi'
import { downloadCsv, exportStem } from '../exportCsv'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, AlertTriangle, ShoppingCart, Search } from 'lucide-react'

// WooCommerce sync — Phase 1 (WooCommerce_B2C_Sync_Spec.md). Read-only: fetches
// paid orders and their refunds for a date range and shows them for review.
// Nothing here writes to Firestore or Supabase — no invoice or UC# is issued
// from this page. The point of Phase 1 is to see, on real data, what
// WooCommerce actually reports for fees/payout/tax before designing the
// invoice/credit-note import (spec §12 Q2-4).

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtMoney = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

// Default range: the previous calendar month, matching the spec's §6 monthly
// procedure ("on the 7th, sync the previous month's paid orders") — so
// opening this page during a normal review already shows the right window.
function defaultRange() {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastOfLastMonth = new Date(firstOfThisMonth - 1)
  return {
    from: firstOfLastMonth.toISOString().slice(0, 10),
    to: lastOfLastMonth.toISOString().slice(0, 10),
  }
}

export default function WooCommerceSync() {
  const [{ from, to }, setRange] = useState(defaultRange)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { rows, refunds, skipped_unpaid, total_fetched }
  const [metaFor, setMetaFor] = useState(null)     // order_id currently expanded
  const [meta, setMeta] = useState(null)           // { order_id, payment_method, transaction_id, meta } or 'loading' or error string
  // Keys worth eyeballing first — anything mentioning fee, stripe, paypal,
  // rate or net. Not a filter on what's shown, just what's sorted to the top.
  const FEE_LIKE = /fee|stripe|paypal|rate|net|payout|charge/i

  async function inspectMeta(orderId) {
    if (metaFor === orderId) { setMetaFor(null); return }
    setMetaFor(orderId); setMeta('loading')
    try {
      const m = await wooOrderMeta(orderId)
      setMeta(m)
    } catch (e) {
      setMeta({ error: e.message || 'Could not load order meta.' })
    }
  }

  async function fetchOrders() {
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await listWooOrders(from, to)
      setResult(r)
    } catch (e) {
      setError(e.message || 'Sync failed.')
    } finally {
      setLoading(false)
    }
  }

  const ORDER_COLUMNS = [
    { label: 'Order no.',       value: (r) => r.number, text: true },
    { label: 'Status',          value: (r) => r.status },
    { label: 'Date paid',       value: (r) => r.date_paid || '' },
    { label: 'Customer',        value: (r) => r.customer_name || '' },
    { label: 'Email',           value: (r) => r.customer_email || '' },
    { label: 'Guest checkout',  value: (r) => (r.is_guest ? 'Yes' : 'No') },
    { label: 'Currency',        value: (r) => r.currency },
    { label: 'Subtotal',        value: (r) => r.subtotal },
    { label: 'Discount',        value: (r) => r.discount_total },
    { label: 'Shipping',        value: (r) => r.shipping_total },
    { label: 'Tax',             value: (r) => r.tax_total },
    { label: 'Total',           value: (r) => r.total },
    { label: 'Payment method',  value: (r) => r.payment_method_title || r.payment_method || '' },
    { label: 'Transaction ID',  value: (r) => r.transaction_id || '', text: true },
    { label: 'Fee lines total (best-effort)', value: (r) => r.fee_lines_total },
    { label: 'Refunded total',  value: (r) => r.refunded_total },
  ]
  const exportOrders = () => downloadCsv(exportStem('woocommerce-orders', { from, to }), ORDER_COLUMNS, result?.rows || [])

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-4 border-b border-ivory-dark">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl md:text-2xl">WooCommerce Sync</h1>
        </div>
        <p className="text-sm text-ink-50 mt-1">
          Phase 1 — read-only. Pulls paid B2C orders and refunds from WooCommerce for review. Nothing here creates a
          Sales Invoice, Credit Note or UC#; see <code>WooCommerce_B2C_Sync_Spec.md</code> for the full plan.
        </p>
      </div>

      <div className="p-4 md:p-6">
        {loading && <LoadingBar />}

        <div className="card p-4 mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From (payment date)</label>
            <input type="date" className="input" value={from}
              onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" className="input" value={to}
              onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} />
          </div>
          <button type="button" onClick={fetchOrders} disabled={loading || !from || !to}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCcw size={14} /> Fetch from WooCommerce
          </button>
          {result && (
            <button type="button" onClick={exportOrders} disabled={!result.rows.length}
              className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 disabled:opacity-40 disabled:no-underline">
              Export orders (CSV)
            </button>
          )}
        </div>

        {error && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 inline-flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {result && (
          <>
            <p className="text-sm text-gray-500 mb-4">
              {result.rows.length} paid order{result.rows.length === 1 ? '' : 's'}
              {result.skipped_unpaid > 0 && <span> · {result.skipped_unpaid} unpaid/cancelled fetched and excluded</span>}
              {result.refunds.length > 0 && <span> · {result.refunds.length} refund{result.refunds.length === 1 ? '' : 's'}</span>}
            </p>

            {result.rows.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <ShoppingCart size={28} className="mx-auto mb-3 opacity-40" />
                No paid orders in this range.
              </div>
            ) : (
              <div className="card overflow-x-auto mb-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Order</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Paid</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cur</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Subtotal</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Discount</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Shipping</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Tax</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Total</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Payment</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Fee (best-effort)</th>
                      <th className="px-4 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.rows.map((o) => (
                      <Fragment key={o.id}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs font-medium text-gray-900">
                            #{o.number}
                            {o.refunded_total > 0 && <span className="ml-1.5 text-[10px] font-sans font-medium text-amber-600">refunded</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDate(o.date_paid)}</td>
                          <td className="px-4 py-3 text-gray-900 min-w-0">
                            <span className="truncate">O07 Online Crystocraft - "{o.customer_name || 'Unnamed'}"</span>
                            {o.is_guest && <span className="ml-1.5 text-[10px] text-gray-400">guest</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-500">{o.currency}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600">{fmtMoney(o.subtotal)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600">{fmtMoney(o.discount_total)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600">{fmtMoney(o.shipping_total)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600">{fmtMoney(o.tax_total)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-900 font-medium">{fmtMoney(o.total)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">{o.payment_method_title || o.payment_method || '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-500 text-xs" title="Not a guaranteed WooCommerce field — see spec §12 Q4">
                            {o.fee_lines_total ? fmtMoney(o.fee_lines_total) : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <button type="button" onClick={() => inspectMeta(o.id)}
                              className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
                              title="Inspect this order's raw meta for a hidden fee field">
                              <Search size={12} /> {metaFor === o.id ? 'Hide' : 'Meta'}
                            </button>
                          </td>
                        </tr>
                        {metaFor === o.id && (
                          <tr key={`${o.id}-meta`}>
                            <td colSpan={11} className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                              {meta === 'loading' && <span className="text-xs text-gray-400">Loading order meta…</span>}
                              {meta?.error && <span className="text-xs text-amber-700">{meta.error}</span>}
                              {meta && meta !== 'loading' && !meta.error && (
                                <div className="text-xs">
                                  <p className="text-gray-500 mb-2">
                                    payment_method: <span className="font-mono">{meta.payment_method || '—'}</span>
                                    {' · '}transaction_id: <span className="font-mono">{meta.transaction_id || '—'}</span>
                                    {' · '}{meta.meta.length} meta key{meta.meta.length === 1 ? '' : 's'}
                                  </p>
                                  {meta.meta.length === 0 ? (
                                    <p className="text-gray-400">No meta keys returned by the API for this order (private/underscore-prefixed keys are commonly stripped server-side).</p>
                                  ) : (
                                    <div className="grid grid-cols-[minmax(0,220px)_1fr] gap-x-3 gap-y-1 max-h-64 overflow-y-auto">
                                      {[...meta.meta].sort((a, b) => (FEE_LIKE.test(b.key) ? 1 : 0) - (FEE_LIKE.test(a.key) ? 1 : 0)).map((m, i) => (
                                        <Fragment key={i}>
                                          <span className={`font-mono truncate ${FEE_LIKE.test(m.key) ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>{m.key}</span>
                                          <span className="font-mono text-gray-800 truncate">{typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)}</span>
                                        </Fragment>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.refunds.length > 0 && (
              <>
                <h2 className="text-sm font-medium text-gray-700 mb-2">Refunds in range</h2>
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">Order</th>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">Refund date</th>
                        <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Amount</th>
                        <th className="px-4 py-2.5 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.refunds.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-900">#{r.order_number}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDate(r.date_created)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">{fmtMoney(r.amount)}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{r.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
