import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { listWooOrders, wooOrderMeta, wooProbePayout } from '../wooSyncApi'
import { importWooOrder, checkImportedWooOrders } from '../wooImport'
import { downloadCsv, exportStem } from '../exportCsv'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, AlertTriangle, ShoppingCart, Search, Compass, Download, CheckCircle2 } from 'lucide-react'

// WooCommerce sync — Phase 1 (WooCommerce_B2C_Sync_Spec.md) is read-only
// review. Phase 2 adds actual Firestore writes: "Import" turns a reviewed
// WooCommerce order into a real `orders/{id}` doc (wooImport.js), landing it
// in the existing "awaiting invoice" list on SalesInvoices.jsx — same as any
// other order. No invoice number or UC# is allocated here; that stays a
// manual step from the Sales Invoices page (Phase 3).

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
  const [metaFor, setMetaFor] = useState(null)     // order_id currently expanded (raw meta inspector)
  const [meta, setMeta] = useState(null)           // { order_id, payment_method, transaction_id, meta } or 'loading' or error string
  const [detailsFor, setDetailsFor] = useState(null) // order_id currently expanded (line items / addresses) — no fetch, already in `result`
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

  // Which WooCommerce order IDs are already imported (order doc exists) —
  // rechecked whenever the result set changes so "Import" flips to
  // "Imported" the moment it's known, without a page reload.
  const [importedIds, setImportedIds] = useState(new Set())
  const [importing, setImporting] = useState(null) // order id currently importing, or null
  const [importError, setImportError] = useState('')

  async function fetchOrders() {
    setLoading(true); setError(''); setResult(null); setImportedIds(new Set())
    try {
      const r = await listWooOrders(from, to)
      setResult(r)
      if (r.rows.length) checkImportedWooOrders(r.rows.map(o => o.id)).then(setImportedIds)
    } catch (e) {
      setError(e.message || 'Sync failed.')
    } finally {
      setLoading(false)
    }
  }

  async function doImport(o) {
    setImporting(o.id); setImportError('')
    try {
      await importWooOrder(o)
      setImportedIds((s) => new Set(s).add(o.id))
    } catch (e) {
      setImportError(`#${o.number}: ${e.message || 'Import failed.'}`)
    } finally {
      setImporting(null)
    }
  }

  // Payout DATE (distinct from _wcpay_net, the payout amount already wired in)
  // isn't in per-order meta — a deposit typically bundles several orders, so
  // WooCommerce Payments tracks it as its own object, not a per-order field.
  // This tries the documented REST paths and shows exactly what each returns,
  // rather than guessing at one. Diagnostic only — spec §12 Q2/Q3.
  const [payoutProbe, setPayoutProbe] = useState(null) // 'loading' | results[] | { error }
  async function probePayout() {
    setPayoutProbe('loading')
    try {
      const orderId = result?.rows?.[0]?.id
      setPayoutProbe(await wooProbePayout(orderId))
    } catch (e) {
      setPayoutProbe({ error: e.message || 'Probe failed.' })
    }
  }

  // Base product code from a SKU like "UC019-C13-RED-004": the first two
  // dash-separated segments are the product ("UC019-C13"); anything after
  // is colour/running-number and gets dropped for grouping purposes — the
  // owner (2026-08-22): "the colors and the running number i don't need to
  // know", grouping by full name had still split the same product across
  // colour variants since WooCommerce gives each variant its own line-item
  // name. Falls back to the item name (lowercased) when a SKU is missing.
  function baseSku(sku) {
    if (!sku) return null
    const parts = sku.trim().split('-')
    return parts.length >= 2 ? parts.slice(0, 2).join('-') : sku.trim()
  }

  // Item-level rollup across every fetched order — "how many of X sold,
  // grouped by base product code." Qty and order count are summed across
  // ALL currencies (a unit count is valid regardless of what currency it was
  // paid in); money is kept broken out per currency inside `currencies`,
  // since orders come in GBP/HKD/USD/EUR (confirmed on real data) and
  // summing money across currencies would silently produce a meaningless
  // total. Sorted by base code ascending — the owner wants a scannable,
  // ordered list, not "biggest first."
  const itemReport = useMemo(() => {
    if (!result?.rows?.length) return []
    const byBase = new Map()
    for (const o of result.rows) {
      for (const l of o.line_items || []) {
        const base = baseSku(l.sku) || l.name.trim().toLowerCase()
        const row = byBase.get(base) || {
          base, names: new Map(), skus: new Set(), qty: 0, orders: new Set(), byCurrency: new Map(),
        }
        row.names.set(l.name, (row.names.get(l.name) || 0) + l.quantity)
        if (l.sku) row.skus.add(l.sku)
        row.qty += l.quantity
        row.orders.add(o.id)
        const c = row.byCurrency.get(o.currency) || { qty: 0, subtotal: 0, discount: 0, tax: 0, total: 0 }
        c.qty += l.quantity; c.subtotal += l.subtotal; c.discount += l.discount; c.tax += l.tax; c.total += l.total
        row.byCurrency.set(o.currency, c)
        byBase.set(base, row)
      }
    }
    return [...byBase.values()].map((r) => {
      // Representative name: whichever variant name sold the most units —
      // just a label, the base code is the real identity of the row.
      const name = [...r.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || r.base
      const skuList = [...r.skus]
      const currencies = [...r.byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, v]) => ({ currency, ...v }))
      return {
        base: r.base, name, variants: r.names.size,
        sku: skuList.length === 1 ? skuList[0] : (skuList.length > 1 ? `${skuList.length} SKUs` : null),
        skuList: skuList.join('; '),
        qty: r.qty, orders: r.orders.size, currencies,
      }
    }).sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true }))
  }, [result])

  // Flattened one-row-per-(base,currency) for the CSV — Excel can't hold a
  // nested currency breakdown in one cell the way the UI's summary can.
  const itemReportCsvRows = useMemo(
    () => itemReport.flatMap((r) => r.currencies.map((c) => ({ ...r, ...c }))),
    [itemReport],
  )
  const ITEM_COLUMNS = [
    { label: 'Base SKU',   value: (r) => r.base, text: true },
    { label: 'Item',       value: (r) => r.name, text: true },
    { label: 'Variants',   value: (r) => r.variants },
    { label: 'SKU(s)',     value: (r) => r.skuList || '', text: true },
    { label: 'Currency',   value: (r) => r.currency },
    { label: 'Orders',     value: (r) => r.orders },
    { label: 'Qty sold (this currency)', value: (r) => r.qty },
    { label: 'Subtotal',   value: (r) => r.subtotal },
    { label: 'Discount',   value: (r) => r.discount },
    { label: 'Tax',        value: (r) => r.tax },
    { label: 'Total',      value: (r) => r.total },
  ]
  const exportItems = () => downloadCsv(exportStem('woocommerce-items', { from, to }), ITEM_COLUMNS, itemReportCsvRows)

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
    { label: 'Gateway fee',     value: (r) => r.gateway_fee ?? '' },
    { label: 'Fee source',      value: (r) => r.gateway_fee_source || 'not found', text: true },
    { label: 'Net payout',      value: (r) => r.net_payout ?? '' },
    { label: 'Payout date (available_on)', value: (r) => r.payout_date || '' },
    { label: 'Deposit ID',      value: (r) => r.deposit_id || '', text: true },
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
          {result?.rows?.length > 0 && (
            <button type="button" onClick={probePayout} disabled={payoutProbe === 'loading'}
              className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 disabled:opacity-50"
              title="Payout DATE isn't in per-order data — this checks whether WooCommerce Payments' deposits/transactions REST endpoints are reachable">
              <Compass size={12} /> {payoutProbe === 'loading' ? 'Probing…' : 'Find payout date source'}
            </button>
          )}
        </div>

        {payoutProbe && payoutProbe !== 'loading' && (
          <div className="card p-4 mb-5 text-xs">
            <p className="text-gray-500 mb-2 font-medium">Payout-date endpoint probe (spec §12 Q2/Q3) — diagnostic only, nothing is stored:</p>
            {payoutProbe.error ? (
              <p className="text-amber-700">{payoutProbe.error}</p>
            ) : (
              <div className="space-y-1">
                {payoutProbe.map((r) => (
                  <div key={r.path} className={`flex items-start gap-2 ${r.ok ? 'text-green-700' : 'text-gray-500'}`}>
                    <span className="font-mono shrink-0">{r.ok ? '200' : (r.status ?? 'ERR')}</span>
                    <span className="font-mono shrink-0">{r.path}</span>
                    <span className="text-gray-400 truncate">{r.body}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 inline-flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {importError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 inline-flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Import failed for {importError}
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
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Gateway fee</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Net payout</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Payout date</th>
                      <th className="px-4 py-2.5 font-medium" />
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
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600 text-xs"
                              title={o.gateway_fee_source ? `Source: ${o.gateway_fee_source}` : 'Not found on this order — check Meta'}>
                            {o.gateway_fee != null ? fmtMoney(o.gateway_fee) : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600 text-xs">
                            {o.net_payout != null ? fmtMoney(o.net_payout) : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs" title={o.deposit_id ? `Deposit ${o.deposit_id}` : ''}>
                            {fmtDate(o.payout_date)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            {importedIds.has(o.id) ? (
                              <Link to={`/shipments/woo-${o.id}`} target="_blank" rel="noreferrer"
                                className="text-xs text-green-700 hover:text-green-800 inline-flex items-center gap-1"
                                title="Open the imported order">
                                <CheckCircle2 size={12} /> Imported
                              </Link>
                            ) : (
                              <button type="button" onClick={() => doImport(o)} disabled={importing === o.id}
                                className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"
                                title="Create an order from this WooCommerce order — lands in Sales Invoices' awaiting-invoice list, no invoice/UC# allocated yet">
                                <Download size={12} /> {importing === o.id ? 'Importing…' : 'Import'}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <button type="button" onClick={() => setDetailsFor(detailsFor === o.id ? null : o.id)}
                              className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 mr-3"
                              title="Line items, addresses, customer note">
                              {detailsFor === o.id ? 'Hide' : 'Details'}
                            </button>
                            <button type="button" onClick={() => inspectMeta(o.id)}
                              className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                              title="Inspect this order's raw meta for a hidden fee field">
                              <Search size={12} /> {metaFor === o.id ? 'Hide' : 'Meta'}
                            </button>
                          </td>
                        </tr>
                        {detailsFor === o.id && (
                          <tr>
                            <td colSpan={15} className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                              <div className="grid md:grid-cols-[1fr_auto] gap-4">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-gray-400">
                                      <th className="pr-3 py-1 font-medium">Item</th>
                                      <th className="pr-3 py-1 font-medium">SKU</th>
                                      <th className="pr-3 py-1 font-medium text-right">Qty</th>
                                      <th className="pr-3 py-1 font-medium text-right">Unit price</th>
                                      <th className="pr-3 py-1 font-medium text-right">Discount</th>
                                      <th className="pr-3 py-1 font-medium text-right">Tax</th>
                                      <th className="pr-3 py-1 font-medium text-right">Line total</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {o.line_items.map((l, i) => (
                                      <tr key={i}>
                                        <td className="pr-3 py-1.5 text-gray-800">{l.name}</td>
                                        <td className="pr-3 py-1.5 font-mono text-gray-500">{l.sku || '—'}</td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-gray-600">{l.quantity}</td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-gray-600">{fmtMoney(l.unit_price)}</td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-gray-600">{l.discount ? fmtMoney(l.discount) : '—'}</td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-gray-600">{l.tax ? fmtMoney(l.tax) : '—'}</td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-gray-900 font-medium">{fmtMoney(l.total)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="text-xs text-gray-600 min-w-[220px] space-y-2">
                                  <div>
                                    <p className="text-gray-400 font-medium mb-0.5">Billing</p>
                                    <p>{o.customer_name || '—'}{o.customer_email && <> · {o.customer_email}</>}</p>
                                    {o.billing_phone && <p>{o.billing_phone}</p>}
                                    {o.billing_address && <p>{o.billing_address}</p>}
                                  </div>
                                  {(o.shipping_name || o.shipping_address) && (
                                    <div>
                                      <p className="text-gray-400 font-medium mb-0.5">Shipping</p>
                                      {o.shipping_name && <p>{o.shipping_name}</p>}
                                      {o.shipping_address && <p>{o.shipping_address}</p>}
                                    </div>
                                  )}
                                  {o.customer_note && (
                                    <div>
                                      <p className="text-gray-400 font-medium mb-0.5">Customer note</p>
                                      <p className="italic">{o.customer_note}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {metaFor === o.id && (
                          <tr key={`${o.id}-meta`}>
                            <td colSpan={15} className="px-4 py-3 bg-gray-50 border-t border-gray-100">
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

            {itemReport.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h2 className="text-sm font-medium text-gray-700">By item</h2>
                  <button type="button" onClick={exportItems}
                    className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2">
                    Export items (CSV)
                  </button>
                </div>
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">Base SKU</th>
                        <th className="px-4 py-2.5 font-medium">Item</th>
                        <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Orders</th>
                        <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Qty sold</th>
                        <th className="px-4 py-2.5 font-medium">Amount by currency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {itemReport.map((r) => (
                        <tr key={r.base} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs font-medium text-gray-900" title={r.skuList || ''}>{r.base}</td>
                          <td className="px-4 py-3 text-gray-900 min-w-0">
                            <span className="truncate">{r.name}</span>
                            {r.variants > 1 && <span className="ml-1.5 text-[10px] text-gray-400">{r.variants} variants</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600">{r.orders}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-900 font-medium">{r.qty}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {r.currencies.map((c) => `${c.currency} ${fmtMoney(c.total)}`).join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Grouped by base product code (SKU up to the second "-", colour/running number dropped) — Qty sold is a unit count across
                  all currencies; Amount stays broken out by currency since totals can't be summed across them. Export for the full
                  subtotal/discount/tax detail per currency.
                </p>
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
