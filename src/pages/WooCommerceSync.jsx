import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { listWooOrders, searchWooOrders, wooOrderMeta, wooProbePayout } from '../wooSyncApi'
import { importWooOrder, checkImportedWooOrders, linkCustomerToWoo } from '../wooImport'
import { importWooRefund, checkImportedWooRefunds } from '../wooRefundImport'
import { downloadCsv, exportStem } from '../exportCsv'
import { loadCustomers } from '../domain/customer'
import { scanWooCustomers, classifyWooCustomers, createWooRetailCustomers } from '../wooCustomerSync'
import { CustomerPicker } from './CustomerAccounts'
import LoadingBar from '../components/LoadingBar'
import { RefreshCcw, AlertTriangle, ShoppingCart, Search, Compass, Download, CheckCircle2, Link2, Users } from 'lucide-react'

// WooCommerce sync — Phase 1 (WooCommerce_B2C_Sync_Spec.md) is read-only
// review. Phase 2 adds actual Firestore writes: "Import" turns a reviewed
// WooCommerce order into a real `orders/{id}` doc (wooImport.js), landing it
// in the existing "awaiting invoice" list on SalesInvoices.jsx — same as any
// other order. No invoice number or UC# is allocated here; that stays a
// manual step from the Sales Invoices page (Phase 3). Phase 4 does the same
// for refunds: "Import" on a refund creates a DRAFT Credit Note
// (wooRefundImport.js) for Cindy to review and post from the existing
// Credit Notes page — never auto-posted.

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

  // Same pattern, for refund → draft Credit Note imports (Phase 4). Kept as
  // separate state from the order import above — a refund's id space and an
  // order's id space are different WooCommerce entities, and conflating
  // "importing" flags between the two tables would make one spin the other's
  // button.
  const [importedRefundIds, setImportedRefundIds] = useState(new Set())
  // Live FX rates for the "By item" report's turnover-in-HKD conversion —
  // see fetchOrders() below for when this gets populated and why it must
  // never be used for anything accounting-facing.
  const [fx, setFx] = useState(null) // null | 'loading' | { RMB,USD,EUR,GBP,HKD:1, updatedAt } | { error }
  const [importingRefund, setImportingRefund] = useState(null)

  // "Find a customer's order history" — checking whether an existing CRM
  // customer record actually has WooCommerce orders behind it, before
  // deciding to link the two (owner, 2026-08-22: checking Petar Chankov,
  // confirming Anxo Domínguez Rama / Ryan Cheung). Independent of the
  // date-range fetch above — this searches ALL of WooCommerce history by
  // email/name, any status.
  const [personQuery, setPersonQuery] = useState('')
  const [personResults, setPersonResults] = useState(null) // null | 'loading' | rows[] | { error }
  async function searchPerson() {
    const q = personQuery.trim()
    if (!q) return
    setPersonResults('loading')
    try {
      setPersonResults(await searchWooOrders(q))
    } catch (e) {
      setPersonResults({ error: e.message || 'Search failed.' })
    }
  }

  // Link an existing CRM customer to the WooCommerce identity found above —
  // explicit, admin-picked, per-order. `customers` loads lazily (only once
  // the picker is actually opened) since most visits to this page never need
  // the full customer list. `linkedFor` is a per-order-id success marker,
  // not persisted state — reflects what THIS session just did.
  const [customers, setCustomers] = useState(null)
  const [linkOpenFor, setLinkOpenFor] = useState(null) // order id
  const [linkChoice, setLinkChoice] = useState('')
  const [linkedFor, setLinkedFor] = useState({}) // order id -> customer_name
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  async function openLinkPicker(orderId) {
    if (customers == null) setCustomers(await loadCustomers())
    setLinkOpenFor(orderId); setLinkChoice(''); setLinkError('')
  }
  async function confirmLink(order) {
    if (!linkChoice) return
    setLinkBusy(true); setLinkError('')
    try {
      await linkCustomerToWoo(linkChoice, order.woo_customer_id)
      const c = customers.find(x => x.id === linkChoice)
      setLinkedFor(prev => ({ ...prev, [order.id]: c?.company_name || 'Linked' }))
      setLinkOpenFor(null)
    } catch (e) {
      setLinkError(e.message || 'Link failed.')
    } finally {
      setLinkBusy(false)
    }
  }

  // Retail Customer bulk sync (2026-08-22) — scan ALL-TIME paid order
  // history, classify each unique buyer against the existing customer list,
  // then let the owner review before anything is created. Never writes
  // during the scan itself — createWooRetailCustomers is a separate,
  // explicit confirm step.
  const [customerScan, setCustomerScan] = useState(null) // null | { scanning, page, ordersScanned, uniqueCount } | rows[] | { error }
  const [customerSyncBusy, setCustomerSyncBusy] = useState(false)
  const [customerSyncDone, setCustomerSyncDone] = useState(null) // count created, once confirmed
  const [customerSyncError, setCustomerSyncError] = useState('')
  async function scanCustomers() {
    setCustomerScan({ scanning: true, page: 0, ordersScanned: 0, uniqueCount: 0 })
    setCustomerSyncDone(null)
    try {
      const [entries, existing] = await Promise.all([
        scanWooCustomers((page, ordersScanned, uniqueCount) => setCustomerScan({ scanning: true, page, ordersScanned, uniqueCount })),
        customers ?? loadCustomers(),
      ])
      if (customers == null) setCustomers(existing)
      setCustomerScan(classifyWooCustomers(entries, existing).sort((a, b) => b.orderCount - a.orderCount))
    } catch (e) {
      setCustomerScan({ error: e.message || 'Scan failed.' })
    }
  }
  async function confirmCustomerSync() {
    if (!Array.isArray(customerScan)) return
    setCustomerSyncBusy(true); setCustomerSyncError('')
    try {
      const n = await createWooRetailCustomers(customerScan)
      setCustomerSyncDone(n)
      // Re-classify in place so the review table immediately reflects the
      // new 'linked' status — no need to re-scan WooCommerce to see it.
      setCustomerScan(prev => prev.map(e => (e.status !== 'linked' ? { ...e, status: 'linked' } : e)))
    } catch (e) {
      setCustomerSyncError(e.message || 'Create failed.')
    } finally {
      setCustomerSyncBusy(false)
    }
  }

  async function fetchOrders() {
    setLoading(true); setError(''); setResult(null); setImportedIds(new Set()); setImportedRefundIds(new Set())
    try {
      const r = await listWooOrders(from, to)
      setResult(r)
      if (r.rows.length) checkImportedWooOrders(r.rows.map(o => o.id)).then(setImportedIds)
      if (r.refunds.length) checkImportedWooRefunds(r.refunds.map(rf => rf.id)).then(setImportedRefundIds)
      // Live rates for the "By item" report's turnover-in-HKD conversion
      // (owner, 2026-08-22) — fetched once and cached; this is a REPORTING
      // convenience only. It is explicitly NOT the accounting exchange rate:
      // CLAUDE.md is emphatic that the books use Cindy's own audit-year
      // table, never a computed/live rate, so this must never be read by
      // anything that touches an actual invoice or the UC Registry — the
      // disclaimer shown with it says so.
      if (fx == null) {
        setFx('loading')
        fetch('/api/fx-rates').then((res) => res.json())
          .then((d) => setFx(d.error ? { error: d.error } : { ...d, HKD: 1 }))
          .catch((e) => setFx({ error: e.message || 'Could not load exchange rates.' }))
      }
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

  // The refund's own object doesn't carry the parent order's currency or
  // customer name — mapWooRefundToDraft needs both, so the matching order
  // from THIS SAME fetch is looked up by refund.order_id. If that order
  // isn't in the current result (its payment date fell outside the fetched
  // range even though the refund date is inside it), importing is refused
  // rather than guessing a currency — see the disabled button's title below.
  async function doImportRefund(rf) {
    const order = result?.rows?.find((o) => o.id === rf.order_id)
    if (!order) {
      setImportError(`Refund on order #${rf.order_number}: matching order not in this date range — widen "From" to include its payment date.`)
      return
    }
    setImportingRefund(rf.id); setImportError('')
    try {
      await importWooRefund(rf, order)
      setImportedRefundIds((s) => new Set(s).add(rf.id))
    } catch (e) {
      setImportError(`Refund on order #${rf.order_number}: ${e.message || 'Import failed.'}`)
    } finally {
      setImportingRefund(null)
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
    // fx: HKD-per-1-unit for RMB/USD/EUR/GBP, HKD:1 — see fetchOrders(). null
    // while still loading/unavailable, in which case rowHkd stays null rather
    // than silently treating an unconverted amount as zero.
    const rate = (cur) => (fx && typeof fx === 'object' && typeof fx[cur] === 'number' ? fx[cur] : null)
    return [...byBase.values()].map((r) => {
      // Representative name: whichever variant name sold the most units —
      // just a label, the base code is the real identity of the row.
      const name = [...r.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || r.base
      const skuList = [...r.skus]
      const currencies = [...r.byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, v]) => ({ currency, ...v, hkd: rate(currency) != null ? v.total * rate(currency) : null }))
      // Owner (2026-08-22): convert to one reporting currency (HKD) so
      // turnover across a mixed-currency period is readable at a glance —
      // this is DIFFERENT from the per-currency `Amount by currency` figures
      // above, which stay exact/native. rowHkd is null (not a wrong number)
      // when any one currency's rate is unavailable, per convertedIncomplete.
      const rowHkd = currencies.every((c) => c.hkd != null) ? currencies.reduce((s, c) => s + c.hkd, 0) : null
      return {
        base: r.base, name, variants: r.names.size,
        sku: skuList.length === 1 ? skuList[0] : (skuList.length > 1 ? `${skuList.length} SKUs` : null),
        skuList: skuList.join('; '),
        qty: r.qty, orders: r.orders.size, currencies, rowHkd,
      }
    }).sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true }))
  }, [result, fx])

  // Report-wide turnover in HKD and total units — the owner's actual ask
  // ("what is the overall turnover... and units sold"). incomplete:true
  // means at least one currency's rate wasn't available, so the total is
  // shown as a lower bound rather than a possibly-wrong final figure.
  const itemReportTotals = useMemo(() => {
    const unitsTotal = itemReport.reduce((s, r) => s + r.qty, 0)
    const rows = itemReport.filter((r) => r.rowHkd != null)
    const turnoverHkd = rows.reduce((s, r) => s + r.rowHkd, 0)
    return { unitsTotal, turnoverHkd, incomplete: rows.length < itemReport.length }
  }, [itemReport])

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
    { label: 'Total (≈HKD, live market rate — reporting only, not the accounting rate)', value: (r) => r.hkd ?? '' },
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

        <div className="card p-4 mb-5">
          <p className="text-xs font-medium text-gray-500 mb-2">Find a customer's order history (any status, no date limit)</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" value={personQuery} onChange={(e) => setPersonQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPerson()}
              placeholder="Email or name…" className="input w-full sm:w-72 text-sm" />
            <button type="button" onClick={searchPerson} disabled={personResults === 'loading' || !personQuery.trim()}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Search size={14} /> {personResults === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>
          {personResults && personResults !== 'loading' && (
            personResults.error ? (
              <p className="text-xs text-amber-700 mt-2">{personResults.error}</p>
            ) : personResults.length === 0 ? (
              <p className="text-xs text-gray-400 mt-2">No WooCommerce orders found for "{personQuery}".</p>
            ) : (
              // No overflow-x-auto here (unlike the other tables on this page):
              // CustomerPicker's dropdown below is `position: absolute`, and
              // setting overflow-x to anything but visible forces overflow-y
              // to clip too (CSS spec quirk) — the dropdown was being cut off
              // invisibly, reported 2026-08-22 as "doesn't show customer
              // names." This table is only 6 narrow columns, so losing
              // horizontal scroll on tiny screens is an acceptable trade.
              <div className="mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 pr-3 font-medium">Order</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 pr-3 font-medium">Date paid</th>
                      <th className="py-1.5 pr-3 font-medium">Customer</th>
                      <th className="py-1.5 pr-3 font-medium">Email</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Total</th>
                      <th className="py-1.5 pr-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {personResults.map((o) => (
                      <Fragment key={o.id}>
                        <tr>
                          <td className="py-1.5 pr-3 font-mono">#{o.number}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{o.status}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{fmtDate(o.date_paid)}</td>
                          <td className="py-1.5 pr-3">{o.customer_name || '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{o.customer_email || '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{o.currency} {fmtMoney(o.total)}</td>
                          <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                            {linkedFor[o.id] ? (
                              <span className="text-green-700 inline-flex items-center gap-1">
                                <CheckCircle2 size={12} /> Linked to {linkedFor[o.id]}
                              </span>
                            ) : (
                              <button type="button" onClick={() => openLinkPicker(o.id)}
                                className="text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
                                title="Attach this WooCommerce identity to an existing CRM customer record">
                                <Link2 size={12} /> Link to CRM customer
                              </button>
                            )}
                          </td>
                        </tr>
                        {linkOpenFor === o.id && (
                          <tr>
                            <td colSpan={7} className="py-2 pr-3 bg-gray-50">
                              {customers == null ? (
                                <span className="text-gray-400">Loading customers…</span>
                              ) : (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <CustomerPicker customers={customers} value={linkChoice} onChange={setLinkChoice} />
                                  <button type="button" onClick={() => confirmLink(o)} disabled={!linkChoice || linkBusy}
                                    className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-50">
                                    {linkBusy ? 'Linking…' : 'Confirm link'}
                                  </button>
                                  <button type="button" onClick={() => setLinkOpenFor(null)} className="text-gray-400 hover:text-brand-600">
                                    Cancel
                                  </button>
                                </div>
                              )}
                              {linkError && <p className="text-amber-700 mt-1">{linkError}</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        <div className="card p-4 mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-medium text-gray-500">Sync all WooCommerce customers who have transacted with us</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Scans all-time PAID order history (not WooCommerce's registered-account list) and creates a Retail
                Customer record for each unique buyer, keyed by their real WooCommerce identity — never merges with
                an existing customer on email match, only flags it for your review.
              </p>
            </div>
            <button type="button" onClick={scanCustomers} disabled={customerScan?.scanning}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0">
              <Users size={14} /> {customerScan?.scanning ? 'Scanning…' : 'Scan order history'}
            </button>
          </div>

          {customerScan?.scanning && (
            <p className="text-xs text-gray-500 mt-3">
              Page {customerScan.page} · {customerScan.ordersScanned} paid orders scanned · {customerScan.uniqueCount} unique customers found so far…
            </p>
          )}
          {customerScan?.error && <p className="text-xs text-amber-700 mt-3">{customerScan.error}</p>}

          {Array.isArray(customerScan) && (() => {
            const counts = { new: 0, possible_match: 0, linked: 0 }
            for (const e of customerScan) counts[e.status] = (counts[e.status] || 0) + 1
            return (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <p className="text-xs text-gray-500">
                    {customerScan.length} unique buyers found — <span className="text-green-700 font-medium">{counts.new} new</span>,{' '}
                    <span className="text-amber-700 font-medium">{counts.possible_match} possible B2B match</span>,{' '}
                    <span className="text-gray-500">{counts.linked} already linked</span>
                  </p>
                  {(counts.new + counts.possible_match) > 0 && (
                    <button type="button" onClick={confirmCustomerSync} disabled={customerSyncBusy}
                      className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                      {customerSyncBusy ? 'Creating…' : `Create ${counts.new + counts.possible_match} retail customer${counts.new + counts.possible_match === 1 ? '' : 's'}`}
                    </button>
                  )}
                </div>
                {customerSyncDone != null && (
                  <p className="text-xs text-green-700 mb-2">
                    <CheckCircle2 size={12} className="inline mr-1" /> {customerSyncDone} customer record{customerSyncDone === 1 ? '' : 's'} created.
                    Any flagged as a possible B2B match still needs your review on that customer's page.
                  </p>
                )}
                {customerSyncError && <p className="text-xs text-amber-700 mb-2">{customerSyncError}</p>}
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-100 sticky top-0 bg-white">
                        <th className="py-1.5 pr-3 font-medium">Name</th>
                        <th className="py-1.5 pr-3 font-medium">Email</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Orders</th>
                        <th className="py-1.5 pr-3 font-medium">Total spent</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {customerScan.map((e) => (
                        <tr key={e.key}>
                          <td className="py-1.5 pr-3">{e.name || '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{e.email || '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{e.orderCount}</td>
                          <td className="py-1.5 pr-3 text-gray-500">
                            {Object.entries(e.totalsByCurrency).map(([cur, sum]) => `${cur} ${fmtMoney(sum)}`).join(' · ')}
                          </td>
                          <td className="py-1.5 pr-3">
                            {e.status === 'linked' && <span className="text-gray-400">Already linked</span>}
                            {e.status === 'new' && <span className="text-green-700">New</span>}
                            {e.status === 'possible_match' && (
                              <span className="text-amber-700" title={`Possible match: ${e.possibleMatch?.company_name}`}>
                                Possible match: {e.possibleMatch?.company_name}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
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
                            {/* Every row on this page is already a WooCommerce order, so
                                repeating "O07 Online Crystocraft" per row is pure noise here
                                (owner, 2026-08-22) — that exact format is still written onto
                                the actual invoice at import time (wooImport.js's
                                wooCustomerName, spec §3.2), unchanged. This is display-only. */}
                            <span className="truncate">{o.customer_name || 'Unnamed'}</span>
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

                <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-4 py-2.5 mb-3 flex items-center gap-4 flex-wrap">
                  <div>
                    <span className="text-[11px] text-gray-500 block">Total units sold</span>
                    <span className="text-lg font-medium text-gray-900 tabular-nums">{itemReportTotals.unitsTotal}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-gray-500 block">Turnover, converted to HKD{itemReportTotals.incomplete ? ' (partial)' : ''}</span>
                    <span className="text-lg font-medium text-gray-900 tabular-nums">
                      {fx === 'loading' ? '…' : fx?.error ? '—' : `HKD ${fmtMoney(itemReportTotals.turnoverHkd)}`}
                    </span>
                  </div>
                  {fx?.error && <span className="text-xs text-amber-700">Rates unavailable: {fx.error}</span>}
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
                        <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">≈ HKD</th>
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
                          <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-600 text-xs">
                            {r.rowHkd != null ? fmtMoney(r.rowHkd) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Grouped by base product code (SKU up to the second "-", colour/running number dropped) — Qty sold is a unit count across
                  all currencies; "Amount by currency" stays exact/native. "≈ HKD" and the turnover total above are converted using a
                  <strong> live market rate</strong>{fx && fx !== 'loading' && !fx.error && ` (fetched ${fmtDate(fx.updatedAt)})`}, for
                  reporting/analytics only — <strong>not</strong> the accounting exchange rate, which is Cindy's own audit-year table and
                  must never be computed (see CLAUDE.md). Export for the full subtotal/discount/tax detail per currency.
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
                        <th className="px-4 py-2.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.refunds.map((r) => {
                        const hasOrder = result.rows.some((o) => o.id === r.order_id)
                        return (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-900">#{r.order_number}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDate(r.date_created)}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">{fmtMoney(r.amount)}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs">{r.reason || '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              {importedRefundIds.has(r.id) ? (
                                <Link to={`/credit-notes/woo-refund-${r.id}`} target="_blank" rel="noreferrer"
                                  className="text-xs text-green-700 hover:text-green-800 inline-flex items-center gap-1"
                                  title="Open the draft Credit Note">
                                  <CheckCircle2 size={12} /> Imported
                                </Link>
                              ) : (
                                <button type="button" onClick={() => doImportRefund(r)}
                                  disabled={importingRefund === r.id || !hasOrder}
                                  className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-50"
                                  title={hasOrder
                                    ? 'Create a draft Credit Note from this refund — review and post it from the Credit Notes page'
                                    : 'The original order\'s payment date is outside the current range — widen "From" to include it'}>
                                  <Download size={12} /> {importingRefund === r.id ? 'Importing…' : 'Import'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
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
