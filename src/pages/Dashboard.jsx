import { useState, useEffect } from 'react'
import { collection, collectionGroup, query, onSnapshot, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import CustomerWorkspace from '../components/CustomerWorkspace'
import { useCustomerWorkItems } from '../domain/customerWorkItems'
import { combineWorkItems, dateOnly, hasOpenWork } from '../customerWorkItems'
import { normalizeCustomer, RETAIL_TAG } from '../domain/customer'
import { generateWeeklySummary } from '../domain/weeklySummary'
import { orderStatusOf, orderUc } from '../shipping'

// Orders in these statuses are "in production" — committed and being made, but
// not yet shipped. Closing out = set the order to Shipped (it then drops off).
const IN_PRODUCTION_ORDER_STATUSES = ['confirmed', 'packing', 'ready']
import {
  AlertTriangle, ClipboardList, Factory, Trophy, Calendar, Check,
  Store, ShoppingCart, Gift, Sparkles, Smartphone, X, RefreshCw, ChevronUp, ShoppingBag, Mail,
} from 'lucide-react'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isOverdue(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d < new Date(new Date().setHours(0, 0, 0, 0))
}

function isToday(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const today = new Date()
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
}

function isWithinDays(ts, days) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const now = new Date()
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return d >= new Date(now.setHours(0, 0, 0, 0)) && d <= end
}

// Last-30-days window for an order_date stored as a 'YYYY-MM-DD' string.
function isDateStrLast30Days(s) {
  if (!s) return false
  const d = new Date(s)
  if (isNaN(d)) return false
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return d >= start && d <= now
}

const CHANNEL_BADGE = {
  'Email':             'bg-purple-100 text-purple-700',
  'WhatsApp Business': 'bg-green-100 text-green-700',
  'Alibaba':           'bg-orange-100 text-orange-700',
  'Personal WhatsApp': 'bg-amber-100 text-amber-700',
}

const QUOTE_STATUS_BADGE = {
  draft: 'bg-ivory-dark text-ink-70',
  sent:  'bg-blue-100 text-blue-700',
}

export default function Dashboard() {
  const [customers, setCustomers]       = useState([])
  const [quotes, setQuotes]             = useState([])
  const [orders, setOrders]             = useState([])
  const [allEnquiries, setAllEnquiries] = useState([])
  const [loading, setLoading]           = useState(true)
  const [refreshKey, setRefreshKey]     = useState(0)
  const [refreshing, setRefreshing]     = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [activeFilter, setActiveFilter]     = useState(null) // 'overdue' | 'open' | 'quotes' | 'won'
  const [categoryFilter, setCategoryFilter] = useState(null) // customer category pill
  const [retailFilter, setRetailFilter] = useState(false) // Retail-tagged-only toggle — independent of category
  const [weeklySummary, setWeeklySummary] = useState(null) // { generatedAt, weekStart, items[] } | null (never generated yet)
  const [weeklyLoading, setWeeklyLoading] = useState(true)
  const [weeklyGenerating, setWeeklyGenerating] = useState(false)
  const [weeklyError, setWeeklyError] = useState('')

  function refresh() { setRefreshKey(k => k + 1); setRefreshing(true) }

  function toggleFilter(f) { setActiveFilter(prev => prev === f ? null : f) }

  useEffect(() => {
    const unsubCustomers = onSnapshot(query(collection(db, 'customers')), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...normalizeCustomer(d.data()) })))
    })
    const unsubQuotes = onSnapshot(query(collection(db, 'client_quotes')), snap => {
      setQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const unsubOrders = onSnapshot(query(collection(db, 'orders')), snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => { unsubCustomers(); unsubQuotes(); unsubOrders() }
  }, [])

  // Both views subscribe to the same interaction records: legacy task edits
  // become visible without waiting for a focus refresh or summary generation.
  useEffect(() => {
    if (!customers.length) { setAllEnquiries([]); setLoading(false); return }
    const customerById = new Map(customers.map(c => [c.id, c]))
    return onSnapshot(collectionGroup(db, 'enquiries'), snap => {
      setAllEnquiries(snap.docs.filter(d => d.ref.parent.parent?.parent.id === 'customers' && customerById.has(d.ref.parent.parent.id)).map(d => {
        const c = customerById.get(d.ref.parent.parent.id)
        return {...d.data(), id:d.id, customerId:c.id, customerName:c.contact_name || '', companyName:c.company_name || ''}
      }))
      setLoading(false); setRefreshing(false)
    }, () => { setWeeklyError('Interaction history could not load. Refresh or check your access.'); setLoading(false); setRefreshing(false) })
  }, [customers, refreshKey])

  const work = useCustomerWorkItems(customers.map(c => c.id))
  useEffect(() => {
    function handleFocus() { setRefreshKey(k => k + 1) }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // On-demand only (V8.15) — load whatever was cached from the last time
  // someone clicked "Refresh" below; never auto-generates on its own.
  useEffect(() => onSnapshot(doc(db, 'dashboard_cache', 'weekly_summary'), snap => {
    setWeeklySummary(snap.exists() ? snap.data() : null); setWeeklyLoading(false)
  }, () => { setWeeklyError('The summary could not load. Refresh or check your access.'); setWeeklyLoading(false) }), [])

  async function handleGenerateWeeklySummary() {
    setWeeklyGenerating(true)
    setWeeklyError('')
    try {
      const result = await generateWeeklySummary()
      setWeeklySummary({ ...result, generatedAt: { toDate: () => new Date() }, weekStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() })
    } catch (e) {
      setWeeklyError(e.message || 'Could not generate the weekly summary.')
    } finally {
      setWeeklyGenerating(false)
    }
  }

  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))

  // Dedupe a list to one enquiry per customer — the most recent by date.
  // Applied *within* a single status class (see below), never globally.
  function latestPerCustomer(list) {
    return Object.values(
      list.reduce((acc, e) => {
        const ex = acc[e.customerId]
        if (!ex || (e.date?.seconds || 0) > (ex.date?.seconds || 0)) acc[e.customerId] = e
        return acc
      }, {})
    )
  }

  // Apply category + Retail-tag filters to any enquiry list (both independent
  // axes, AND'd together — e.g. "Small B2B" + Retail-only at once).
  function byCat(list) {
    return list.filter(e => {
      const c = customerMap[e.customerId]
      return (!categoryFilter || c?.crm_category === categoryFilter) &&
             (!retailFilter || c?.tags?.includes(RETAIL_TAG))
    })
  }

  // Same, for orders (which key on customer_id, not customerId)
  function byCatOrder(list) {
    return list.filter(o => {
      const c = customerMap[o.customer_id]
      return (!categoryFilter || c?.crm_category === categoryFilter) &&
             (!retailFilter || c?.tags?.includes(RETAIL_TAG))
    })
  }

  // Pipeline / New Orders are enquiry-based, each derived from the FULL enquiry
  // set and deduped within its own status class — so a customer with a live
  // production order AND a separate new-order enquiry appears independently in
  // each. (Previously every customer was collapsed to a single "latest" enquiry
  // first, which hid whichever thread wasn't the most recent.)
  const pipelineList = latestPerCustomer(byCat(allEnquiries.filter(e => e.status === 'Open' || e.status === 'Quoted')))

  // In Production and New Orders are both ORDER-based, not enquiry-based.
  // Production/shipment is an order lifecycle (Confirmed → Packing → Ready →
  // Shipped), updated in place on the order in the Shipping module — not a dated
  // log entry you rewrite. An order drops off In Production the moment it's
  // marked Shipped/Delivered.
  const inProductionOrders = byCatOrder(
    orders.filter(o => IN_PRODUCTION_ORDER_STATUSES.includes(o.status))
  ).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))

  // New Orders = actual orders received (by PI date) in the last 30 days — the
  // real order record, not the enquiry's "Confirmed" pipeline signal.
  const newOrdersList = byCatOrder(
    orders.filter(o => isDateStrLast30Days(o.order_date))
  ).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))

  // Follow-ups are task-driven: any thread with an outstanding follow-up date is
  // a distinct actionable item, so these are NOT collapsed per customer — a
  // customer chasing two threads shows both. Filtering on follow_up_date first
  // also means a follow-up on a non-latest thread is no longer hidden.
  const groupedWork = new Map(customers.map(c => [c.id, combineWorkItems(
    allEnquiries.filter(e => e.customerId === c.id), work.items.filter(i => i.customerId === c.id))]))
  const today = dateOnly(new Date())
  const overdueList = [] // native tasks and carried follow-ups, without a recency cutoff
  for (const c of customers) {
    if ((categoryFilter && c.crm_category !== categoryFilter) || (retailFilter && !c.tags?.includes(RETAIL_TAG))) continue
    for (const item of groupedWork.get(c.id) || []) {
      if (item.kind === 'task' && item.state !== 'done' && item.due_on && item.due_on < today) overdueList.push({ ...item, customerId: c.id })
    }
  }
  const digestByCustomer = new Map((weeklySummary?.items || []).map(i => [i.customerId, i]))
  const workspaceCustomers = customers.filter(c =>
    (!categoryFilter || c.crm_category === categoryFilter) && (!retailFilter || c.tags?.includes(RETAIL_TAG)) &&
    (activeFilter === 'overdue'
      ? overdueList.some(i => i.customerId === c.id)
      : c.id === selectedCustomer || digestByCustomer.has(c.id) || hasOpenWork(groupedWork.get(c.id) || []))
  ).sort((a,b) => {
    const due = c => (groupedWork.get(c.id) || []).filter(i => i.kind === 'task' && i.state !== 'done' && i.due_on).map(i => i.due_on).sort()[0] || '9999'
    return due(a).localeCompare(due(b)) || (a.company_name || '').localeCompare(b.company_name || '')
  })

  // Filtered list panel config
  const filterConfig = {
    overdue: {
      title: 'Overdue Follow-ups', Icon: AlertTriangle,
      empty: 'No overdue follow-ups',
      items: overdueList.sort((a, b) => (a.follow_up_date?.seconds || 0) - (b.follow_up_date?.seconds || 0)),
      type: 'enquiry',
    },
    open: {
      title: 'Pipeline — Open & Quoted', Icon: ClipboardList,
      empty: 'No open or quoted enquiries',
      items: pipelineList.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0)),
      type: 'enquiry',
    },
    quotes: {
      title: 'In Production', Icon: Factory,
      empty: 'No orders currently in production',
      items: inProductionOrders,
      type: 'order',
    },
    won: {
      title: 'New Orders — Last 30 Days', Icon: Trophy,
      empty: 'No orders received in the last 30 days',
      items: newOrdersList,
      type: 'order',
    },
  }

  const personalWaCustomers = customers.filter(c => c.is_personal_wa)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {loading && <LoadingBar />}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl text-ink">Dashboard</h1>
          <p className="text-sm text-ink-60 mt-0.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-sm text-brand-600 hover:text-brand-800 font-medium flex items-center gap-1.5 mt-1"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Follow-ups Due"
          value={overdueList.length}
          colour="red"
          note="overdue"
          active={activeFilter === 'overdue'}
          onClick={() => toggleFilter('overdue')}
        />
        <StatCard
          label="Pipeline"
          value={pipelineList.length}
          colour="amber"
          note="open + quoted"
          active={activeFilter === 'open'}
          onClick={() => toggleFilter('open')}
        />
        <StatCard
          label="In Production"
          value={inProductionOrders.length}
          colour="blue"
          note="active orders"
          active={activeFilter === 'quotes'}
          onClick={() => toggleFilter('quotes')}
        />
        <StatCard
          label="New Orders"
          value={newOrdersList.length}
          colour="green"
          note="last 30 days"
          active={activeFilter === 'won'}
          onClick={() => toggleFilter('won')}
        />
      </div>

      <div className="card mb-6">
        <div className="p-4 border-b border-warm-grey flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base">Customer Summary &amp; To-do</h2><p className="text-xs text-ink-60 mt-1">Recent conversations and your saved tasks. Unfinished work stays here until done.</p></div>
          <button onClick={handleGenerateWeeklySummary} disabled={weeklyGenerating} className="btn-secondary text-xs">{weeklyGenerating ? 'Refreshing…' : 'Refresh summaries'}</button>
          <label className="text-sm w-full">Find a customer to add a task or note
            <select className="input mt-1" value={selectedCustomer} onChange={e => { setSelectedCustomer(e.target.value); setActiveFilter(null) }}>
              <option value="">Choose customer…</option>{[...customers].sort((a,b) => (a.company_name || '').localeCompare(b.company_name || '')).map(c => <option key={c.id} value={c.id}>{c.company_name || c.contact_name || c.id}</option>)}
            </select>
          </label>
        </div>
        {(weeklyError || work.error) && <p role="alert" className="text-sm text-brand-600 p-4">{weeklyError || work.error}</p>}
        {(weeklyLoading || work.loading || loading) && <p className="text-sm text-ink-60 p-4">Loading summaries and tasks…</p>}
        {workspaceCustomers.map(c => <CustomerWorkspace key={c.id} customerId={c.id} customerName={c.company_name || c.contact_name || 'Customer'}
          digest={digestByCustomer.get(c.id)?.digest} items={groupedWork.get(c.id) || []} showLink
          generatedAt={weeklySummary?.generatedAt?.toDate?.().toLocaleString('en-GB')} />)}
        {!loading && !work.loading && !workspaceCustomers.length && <p className="text-sm text-ink-60 p-4">{activeFilter === 'overdue' ? 'No overdue tasks.' : 'No recent summaries or outstanding tasks. Choose a customer above to get started.'}</p>}
      </div>

      {/* Customer Type filter pills — Retail Customer sits alongside
          Distributor/Small B2B/Gift-OEM/Crystal Fabric as a peer type
          (owner, 2026-08-13: same visual row, not a separate toggle below),
          but stays functionally independent under the hood — it's a tag,
          not a value of crm_category, so it can combine with any of the
          other four (a trade-bucket customer, e.g. shared ERP code C13,
          can also buy retail sometimes; see domain/customer.js's
          RETAIL_TAG comment). Clicking it toggles retailFilter, the others
          set categoryFilter — both AND together in byCat()/byCatOrder(). */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { label: 'Distributor',   value: 'Distributor',   Icon: Store },
          { label: 'Small B2B',     value: 'Small B2B',     Icon: ShoppingCart },
          { label: 'Gift / OEM',    value: 'Gift / OEM',    Icon: Gift },
          { label: 'Crystal Fabric', value: 'Crystal Fabric', Icon: Sparkles },
        ].map(({ label, value, Icon }) => (
          <button
            key={value}
            onClick={() => setCategoryFilter(f => f === value ? null : value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
 categoryFilter === value
                ? 'bg-ink border-ink text-white'
                : 'bg-white border-warm-grey text-ink-70 hover:border-ink-60'
            }`}
          >
            {Icon && <Icon size={13} className="inline align-[-2px] mr-1" />}{label}
          </button>
        ))}
        <button
          onClick={() => setRetailFilter(v => !v)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
 retailFilter
              ? 'bg-ink border-ink text-white'
              : 'bg-white border-warm-grey text-ink-70 hover:border-ink-60'
          }`}
        >
          <ShoppingBag size={13} className="inline align-[-2px] mr-1" />{RETAIL_TAG}
        </button>
        {(categoryFilter || retailFilter) && (
          <button
            onClick={() => { setCategoryFilter(null); setRetailFilter(false) }}
            className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-warm-grey text-ink-60 hover:text-ink-70 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Filtered panel — shown when a stat card is active */}
      {activeFilter && activeFilter !== 'overdue' && (
        <div className="card mb-6 ring-2 ring-brand-200">
          <div className="px-5 py-4 border-b border-warm-grey flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm text-ink-80">
              {(() => { const I = filterConfig[activeFilter].Icon; return I ? <I size={15} /> : null })()}
              {filterConfig[activeFilter].title}
              {(categoryFilter || retailFilter) && (
                <span className="ml-2 text-xs font-normal text-ink-60">
                  · {[categoryFilter, retailFilter ? RETAIL_TAG : null].filter(Boolean).join(' · ')}
                </span>
              )}
            </h2>
            <button onClick={() => setActiveFilter(null)} className="text-ink-60 hover:text-ink-70 leading-none"><X size={18} /></button>
          </div>
          {filterConfig[activeFilter].items.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-8">{filterConfig[activeFilter].empty}</p>
          ) : filterConfig[activeFilter].type === 'order' ? (
            <div className="divide-y divide-warm-grey">
              {filterConfig[activeFilter].items.map(o => {
                const cust = customerMap[o.customer_id]
                const st = orderStatusOf(o.status)
                const dateStr = o.order_date
                  ? new Date(o.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—'
                return (
                  <Link
                    key={o.id}
                    to={`/shipments/${o.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-ivory transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-ink">{cust?.company_name || o.customer_name || '—'}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                      </div>
                      <p className="text-xs text-ink-60 mt-0.5">{orderUc(o) || o.id}</p>
                    </div>
                    <p className="text-xs text-ink-60 shrink-0">{dateStr}</p>
                  </Link>
                )
              })}
            </div>
          ) : filterConfig[activeFilter].type === 'quote' ? (
            <div className="divide-y divide-warm-grey">
              {filterConfig[activeFilter].items.map(q => {
                const cust = customerMap[q.customer_id]
                return (
                  <Link
                    key={q.id}
                    to={`/quotes/${q.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-ivory transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-ink">{cust?.company_name || q.customer_name || '—'}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${QUOTE_STATUS_BADGE[q.status] || 'bg-ivory-dark text-ink-60'}`}>
                          {q.status}
                        </span>
                      </div>
                      <p className="text-xs text-ink-60 mt-0.5">{q.title || q.id}</p>
                    </div>
                    <p className="text-xs text-ink-60 shrink-0">{fmtDate(q.createdAt)}</p>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="divide-y divide-warm-grey">
              {filterConfig[activeFilter].items.map(enq => {
                const overdue = enq.follow_up_date && isOverdue(enq.follow_up_date)
                const today   = enq.follow_up_date && isToday(enq.follow_up_date)
                return (
                  <div key={`${enq.customerId}-${enq.id}`} className="px-5 py-3.5">
                    <div className="flex items-start gap-3">
                      <Link to={`/customers/${enq.customerId}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-ink">{enq.companyName}</p>
                          {enq.customerName && <p className="text-xs text-ink-60">{enq.customerName}</p>}
                          {enq.channel && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CHANNEL_BADGE[enq.channel] || 'bg-ivory-dark text-ink-60'}`}>
                              {enq.channel}
                            </span>
                          )}
                          {enq.status && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-ivory-dark text-ink-60">
                              {enq.status}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-70 mt-0.5">
                          {enq.description?.slice(0, 100)}{enq.description?.length > 100 ? '…' : ''}
                        </p>
                        {enq.follow_up_date && (
                          <p className={`text-xs font-semibold mt-1 ${overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-ink-60'}`}>
                            {overdue ? <AlertTriangle size={11} className="inline align-[-1px] mr-1" /> : today ? <Calendar size={11} className="inline align-[-1px] mr-1" /> : null}Follow-up: {fmtDate(enq.follow_up_date)}
                          </p>
                        )}
                        {enq.date && !enq.follow_up_date && (
                          <p className="text-xs text-ink-60 mt-1">{fmtDate(enq.date)}</p>
                        )}
                      </Link>

                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Personal WhatsApp panel */}
      {personalWaCustomers.length > 0 && (
        <div className="card mb-4">
          <div className="px-5 py-4 border-b border-warm-grey">
            <h2 className="flex items-center gap-1.5 text-sm text-ink-80"><Smartphone size={15} />Personal WhatsApp Contacts</h2>
            <p className="text-xs text-ink-60 mt-0.5">These contacts use personal WhatsApp — check your personal phone</p>
          </div>
          <ul className="divide-y divide-warm-grey">
            {personalWaCustomers.map(c => (
              <li key={c.id}>
                <Link
                  to={`/customers/${c.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-ivory transition-colors"
                >
                  <span className="text-sm text-ink">
                    <span className="font-medium">{c.contact_name || c.company_name}</span>
                    {c.contact_name && c.company_name && <span className="text-ink-60"> · {c.company_name}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, colour, note, active, onClick }) {
  const colours = {
    red:   { bg: 'bg-red-50',   border: 'border-red-100',  activeBorder: 'border-red-400',  num: 'text-red-600',   label: 'text-red-700' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100',activeBorder: 'border-amber-400',num: 'text-amber-600', label: 'text-amber-700' },
    blue:  { bg: 'bg-blue-50',  border: 'border-blue-100', activeBorder: 'border-blue-400', num: 'text-blue-600',  label: 'text-blue-700' },
    green: { bg: 'bg-green-50', border: 'border-green-100',activeBorder: 'border-green-400',num: 'text-green-600', label: 'text-green-700' },
  }
  const c = colours[colour] || colours.blue

  return (
    <button
      onClick={onClick}
      className={`${c.bg} border-2 ${active ? c.activeBorder : c.border} rounded-none p-4 text-left w-full transition-all hover:shadow-sm ${active ? 'shadow-sm' : ''}`}
    >
      <p className={`text-3xl font-bold ${c.num}`}>{value}</p>
      <p className={`text-xs font-semibold mt-1 leading-tight ${c.label}`}>{label}</p>
      {note && <p className="text-xs text-ink-60 mt-0.5 leading-tight">{note}</p>}
      {active && <p className={`inline-flex items-center gap-1 text-xs mt-1 font-medium ${c.label} opacity-70`}><ChevronUp size={12} />filtered</p>}
    </button>
  )
}
