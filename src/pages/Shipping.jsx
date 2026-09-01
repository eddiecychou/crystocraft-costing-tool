import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { useOrders, orderStatusOf, orderUc, orderSi, orderSoDisplay, getOrder, getOrderLines, createOrderWithLinesAllocatingSo } from '../shipping'
import { allocateOrderUc } from '../ucRegistry'
import { useVendors, FREIGHT_MODES, modeLabel, strengthOf } from '../logistics'
import { erpLookup } from '../erpApi'
import { useCustomers } from '../domain/customer'
import { MapPin, FileInput, ClipboardCheck, MessageCircle, Star, Truck, Copy, Plus, Database } from 'lucide-react'
import ComponentRequirements from './ComponentRequirements'
import ErpDocModal from '../components/ErpDocModal'

const TABS = [
  { v: 'shipments', label: 'Orders' },
  { v: 'requirements', label: 'Requirements' },
  { v: 'logistics', label: 'Logistics' },
]

// Historical sales orders are READ from the ERP mirror, never imported — same
// reasoning as the invoice list. 2025 and 2026 are already parsed into the app,
// so rather than a date cutoff (brittle, and wrong the moment another year is
// imported) rows are de-duplicated by SO number: whatever the app holds wins,
// and JES fills in only what the app does not have.
//
// Note the default fetch is the most recent 100 SOs, most of which ARE in the
// app — so the default view stays app-dominated and search is what reaches back
// into the 5,631-row history. `code`, `customer` and `ref` are all searchable.
function useErpOrders(search) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(() => {
      erpLookup('sales_order', { q: search.trim(), limit: 100 })
        .then(r => { if (alive) setRows(r || []) })
        .catch(e => { if (alive) { setError(e.message || 'Could not reach the ERP archive.'); setRows([]) } })
        .finally(() => { if (alive) setLoading(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [search])
  return { rows, loading, error }
}

export default function Shipping() {
  const [tab, setTab] = useState('shipments')

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Production</h1>
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.v ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-60 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'shipments' && <ShipmentsList />}
      {tab === 'requirements' && <ComponentRequirements />}
      {tab === 'logistics' && <LogisticsList />}
    </div>
  )
}

function ShipmentsList() {
  const navigate = useNavigate()
  const { orders, loading } = useOrders()
  const [search, setSearch] = useState('')
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [dupError, setDupError] = useState('')

  const filtered = orders
    .filter(o => {
      if (!search) return true
      const hay = `${o.customer_name} ${orderUc(o)} ${o.erp_so_no} ${o.destination?.country} ${o.destination?.city}`.toLowerCase()
      return hay.includes(search.toLowerCase())
    })
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))   // newest order date first

  const erp = useErpOrders(search)
  const [erpDoc, setErpDoc] = useState(null)   // JES order being viewed, read-only

  // Customer code next to the name — Cindy keys this into PBIS (same need as
  // Sales Invoices, see SalesInvoices.jsx). App rows resolve via the order's
  // own customer_id; JES rows already carry customer_code straight from
  // erp_sales_order (socustomer), no extra lookup needed.
  const { customers } = useCustomers()
  const erpCodeByCustomerId = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c.erp_code]).filter(([, code]) => code)),
    [customers],
  )

  // App rows and JES rows in one list, de-duplicated by SO number with the app
  // row winning. That is what implements "only wire what is not already parsed"
  // without hard-coding which years were imported.
  const merged = useMemo(() => {
    const app = filtered.map(o => ({ src: 'app', key: `app-${o.id}`, o }))
    const appSo = new Set(filtered.map(o => (o.erp_so_no || '').trim().toUpperCase()).filter(Boolean))
    const jes = (erp.rows || [])
      .filter(r => !appSo.has((r.code || '').trim().toUpperCase()))
      .map(r => ({ src: 'jes', key: `erp-${r.code}`, r }))
    return [...app, ...jes].sort((a, b) => {
      const da = a.src === 'app' ? (a.o.order_date || '') : (a.r.date || '')
      const db = b.src === 'app' ? (b.o.order_date || '') : (b.r.date || '')
      return String(db).localeCompare(String(da))
    })
  }, [filtered, erp.rows])

  const jesOnly = merged.length - filtered.length

  // "Duplicate" — matches how CuiLing actually works in JES: copy a repeat
  // customer's previous order rather than re-entering their details, then edit
  // the product codes. The one thing this deliberately does NOT copy is the
  // UC# — a carried-over UC is the exact, repeatable slip that workflow
  // produces there (confirmed against the registry: UC4657 duplicated onto
  // SI240240, which then had no registry row of its own). A fresh UC is
  // allocated instead; everything else copies through, same as her habit.
  async function handleDuplicate(o) {
    if (duplicatingId) return
    setDuplicatingId(o.id); setDupError('')
    try {
      const [src, lines] = await Promise.all([getOrder(o.id), getOrderLines(o.id)])
      if (!src) throw new Error('Order not found.')
      const uc = await allocateOrderUc({ customer_name: src.customer_name, currency: src.currency })
      const newOrderData = {
        source: 'duplicated',
        customer_id: src.customer_id, customer_name: src.customer_name,
        currency: src.currency, incoterm: src.incoterm,
        destination: src.destination, notes: src.notes,
        uc_no: uc.full,
        // JES references and totals belong to the source document, not the
        // copy — order_date resets too, since a duplicate is naturally today's.
        erp_so_no: '', order_date: '', status: 'draft',
        subtotal: null, discount_pct: null, discount_amount: null, total_amount: null,
      }
      const newLines = lines.map((l, i) => ({ ...l, line_no: i + 1 }))
      // Allocated fresh here (bug-fix pack B-02) — a duplicate used to leave
      // erp_so_no blank entirely rather than either copying the source's
      // number (wrong — see the UC# comment above for the exact same failure
      // mode) or getting its own, so it silently fell out of step with every
      // other order-creation path, which already allocates on create.
      const { id: newId } = await createOrderWithLinesAllocatingSo(newOrderData, newLines, { allocateSo: true })
      navigate(`/shipments/${newId}`)
    } catch (err) {
      setDupError(err.message || 'Could not duplicate this order.')
      setDuplicatingId(null)
    }
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {merged.length} order{merged.length === 1 ? '' : 's'}
          {jesOnly > 0 && <span className="text-gray-400"> · {filtered.length} in the app, {jesOnly} from JES</span>}
          {erp.loading && <span className="text-gray-400"> · loading JES history…</span>}
        </p>
        <div className="flex items-center gap-2">
          {/* An order can be entered directly now, not only imported from a PDF.
              Without this button the only way in was Import PI, which is why the
              app could parse an order but never originate one. */}
          <Link to="/shipments/new" className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-1.5">
            <Plus size={15} /> New Order
          </Link>
          {/* Same destination — that page now offers both paths (type the
              lines, or drop a PI). Kept as a separate button because "Import PI"
              is what the team looks for. */}
          <Link to="/shipments/new" className="btn-secondary text-sm whitespace-nowrap inline-flex items-center gap-1.5">
            <FileInput size={15} /> Import PI
          </Link>
        </div>
      </div>

      <input type="text" placeholder="Search by customer, PI no, SO no, destination…"
        className="input w-full mb-4" value={search} onChange={e => setSearch(e.target.value)} />
      {erp.error && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          JES history unavailable — {erp.error}
        </p>
      )}
      {dupError && <p className="text-sm text-red-600 mb-3">{dupError}</p>}
      {erpDoc && <ErpDocModal of="sales_order" doc={erpDoc} onClose={() => setErpDoc(null)} />}

      {merged.length === 0 && !loading && !erp.loading ? (
        <div className="text-center py-20 text-gray-400">
          {orders.length === 0
            ? <><Link to="/shipments/new" className="text-brand-600 hover:underline">Import a proforma invoice</Link> to get started.</>
            : 'No shipments match your search.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Order Date</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">UC#</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">SO #</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Currency</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Order Value</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {merged.map(row => {
                if (row.src === 'jes') return <JesOrderRow key={row.key} r={row.r} onOpen={() => setErpDoc(row.r)} />
                const o = row.o
                const st = orderStatusOf(o.status)
                const needsReconcile = (o._raw?.lines_unreconciled ?? 0) > 0
                const value = o.total_amount ?? o.subtotal
                return (
                  <tr key={row.key} className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/shipments/${o.id}`)}>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtOrderDate(o.order_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{orderUc(o) || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{orderSoDisplay(o) || '—'}</td>
                    <td className="px-4 py-3 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 truncate">{o.customer_name || 'Unnamed customer'}</span>
                        {erpCodeByCustomerId[o.customer_id] && (
                          <span className="text-xs text-gray-400 font-mono">{erpCodeByCustomerId[o.customer_id]}</span>
                        )}
                        {o.uc_no && <span className="text-xs text-gray-400">{o.uc_no}</span>}
                        {needsReconcile && (
                          <span title="Needs reconcile" className="inline-flex items-center text-amber-600">
                            <ClipboardCheck size={12} />
                          </span>
                        )}
                      </div>
                      {(o.destination?.country || o.destination?.city) && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <MapPin size={11} />{[o.destination.city, o.destination.country].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{o.currency}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">
                      {value != null ? fmtValue(value) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                        {/* An order that has been invoiced is easy to mistake for
                            one still awaiting invoice — the two look identical in
                            this list otherwise, so an already-issued SI reads as a
                            proforma still sitting here (Cindy, 2026-07-31). Show the
                            SI so "this has become a Sales Invoice" is visible at a
                            glance. Not hidden from the list: a wholesale order is
                            invoiced at confirmation but still ships from here. */}
                        {orderSi(o) && (
                          <span title={`Invoiced — ${orderSi(o)}. Also listed under Sales Invoices.`}
                            className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 whitespace-nowrap">
                            {orderSi(o)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => handleDuplicate(o)} disabled={duplicatingId === o.id}
                              title="Duplicate this order — allocates a fresh UC#"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors">
                        <Copy size={14} className={duplicatingId === o.id ? 'animate-pulse' : ''} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// A JES sales order: visible and searchable, but not editable or duplicable —
// the app cannot re-issue a document JES produced, and duplicating one would
// silently create an app order claiming a JES SO number.
function JesOrderRow({ r, onOpen }) {
  const void_ = (r.status || '').trim().toUpperCase() === 'VOID'
  return (
    <tr onClick={onOpen}
        className={`transition-colors cursor-pointer hover:bg-gray-50 ${void_ ? 'opacity-60' : ''}`}>
      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtOrderDate(r.date)}</td>
      <td className="px-4 py-3 whitespace-nowrap text-gray-500">{(r.ref || '').trim() || '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-xs">{(r.code || '').trim()}</td>
      <td className="px-4 py-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 truncate">{r.customer || 'Unnamed customer'}</span>
          {r.customer_code && <span className="text-xs text-gray-400 font-mono">{r.customer_code}</span>}
          {r.customer_po && <span className="text-xs text-gray-400">{r.customer_po}</span>}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-gray-500">{r.currency}</td>
      <td className="px-4 py-3 whitespace-nowrap text-right tabular-nums text-gray-800">
        {r.amount != null ? fmtValue(r.amount) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs text-gray-500">{(r.status || '').trim() || '—'}</span>
      </td>
      <td className="px-2 py-3 whitespace-nowrap text-right">
        <span title="Historical order from JES — read-only archive"
              className="text-[10px] font-medium text-ink-60 inline-flex items-center gap-1 border border-ivory-dark rounded-full px-2 py-0.5">
          <Database size={10} /> JES
        </span>
      </td>
    </tr>
  )
}

function fmtOrderDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtValue(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

function LogisticsList() {
  const { vendors, loading } = useVendors()
  const [search, setSearch] = useState('')
  const [mode, setMode]     = useState('')

  const filtered = vendors.filter(v => {
    const hay = `${v.name} ${v.name_cn} ${v.coverage.map(c => c.region).join(' ')}`.toLowerCase()
    return (!search || hay.includes(search.toLowerCase())) && (!mode || v.modes.includes(mode))
  })

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{filtered.length} of {vendors.length} forwarders</p>
        <Link to="/logistics/new" className="btn-primary text-sm whitespace-nowrap">+ New Vendor</Link>
      </div>

      <input type="text" placeholder="Search by name or coverage…"
        className="input w-full mb-3" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="flex gap-2 flex-wrap mb-4">
        <button onClick={() => setMode('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!mode ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          All modes
        </button>
        {FREIGHT_MODES.map(m => {
          const count = vendors.filter(v => v.modes.includes(m.value)).length
          if (!count) return null
          return (
            <button key={m.value} onClick={() => setMode(mode === m.value ? '' : m.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${mode === m.value ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {m.label} <span className="opacity-60 ml-0.5">({count})</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {vendors.length === 0 ? 'No logistics vendors yet — add your first forwarder.' : 'No vendors match your filter.'}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {filtered.map(v => (
            <Link key={v.id} to={`/logistics/${v.id}`} className="block px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm">{v.name}</p>
                    {v.name_cn && <span className="text-xs text-gray-500">{v.name_cn}</span>}
                    {v.reliability_rating != null && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                        <Star size={12} className="fill-amber-400 stroke-amber-500" />{v.reliability_rating}
                      </span>
                    )}
                  </div>
                  {v.modes.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {v.modes.map(m => (
                        <span key={m} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          <Truck size={11} />{modeLabel(m)}
                        </span>
                      ))}
                    </div>
                  )}
                  {v.coverage.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {v.coverage.slice(0, 6).map((c, i) => {
                        const s = strengthOf(c.strength)
                        return (
                          <span key={i} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${s.style}`}>
                            <MapPin size={11} />{c.region}
                          </span>
                        )
                      })}
                      {v.coverage.length > 6 && <span className="text-[11px] text-gray-400 self-center">+{v.coverage.length - 6}</span>}
                    </div>
                  )}
                  {v.contacts[0] && (v.contacts[0].wechat || v.contacts[0].name) && (
                    <div className="flex gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                      {v.contacts[0].name && <span>{v.contacts[0].name}</span>}
                      {v.contacts[0].wechat && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />{v.contacts[0].wechat}</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 ml-3">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
