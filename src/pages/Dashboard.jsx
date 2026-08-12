import { useState, useEffect } from 'react'
import { collection, query, getDocs, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import EnquiryForm from './EnquiryForm'
import { normalizeCustomer, SALES_TYPES, effectiveSalesType } from '../domain/customer'
import { orderStatusOf, orderUc } from '../shipping'

// Orders in these statuses are "in production" — committed and being made, but
// not yet shipped. Closing out = set the order to Shipped (it then drops off).
const IN_PRODUCTION_ORDER_STATUSES = ['confirmed', 'packing', 'ready']
import {
  AlertTriangle, ClipboardList, Factory, Trophy, Calendar, Check,
  Store, ShoppingCart, Gift, Sparkles, Smartphone, X, RefreshCw, ChevronUp,
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
  draft: 'bg-gray-100 text-gray-600',
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
  const [logTarget, setLogTarget]       = useState(null)
  const [dismissing, setDismissing]     = useState(null)
  const [activeFilter, setActiveFilter]     = useState(null) // 'overdue' | 'open' | 'quotes' | 'won'
  const [categoryFilter, setCategoryFilter] = useState(null) // customer category pill
  const [salesTypeFilter, setSalesTypeFilter] = useState(null) // Retail/Wholesale pill — independent axis from category

  function refresh() { setRefreshKey(k => k + 1); setRefreshing(true) }

  function toggleFilter(f) { setActiveFilter(prev => prev === f ? null : f) }

  async function handleDone(enq, e) {
    e.preventDefault()
    e.stopPropagation()
    setDismissing(enq.id)
    try {
      await updateDoc(doc(db, 'customers', enq.customerId, 'enquiries', enq.id), {
        follow_up_date: null,
        updatedAt: serverTimestamp(),
      })
      setAllEnquiries(prev => prev.map(x =>
        x.id === enq.id ? { ...x, follow_up_date: null } : x
      ))
    } finally {
      setDismissing(null)
    }
  }

  function handleLog(enq, e) {
    e.preventDefault()
    e.stopPropagation()
    setLogTarget({ customerId: enq.customerId, companyName: enq.companyName })
  }

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

  useEffect(() => {
    if (customers.length === 0) { setLoading(false); return }
    let cancelled = false
    Promise.all(
      customers.map(c =>
        getDocs(collection(db, 'customers', c.id, 'enquiries')).then(snap =>
          snap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            customerId:   c.id,
            customerName: c.contact_name || '',
            companyName:  c.company_name || '',
            channel:      d.data().channel || c.channels?.[0] || '',
          }))
        )
      )
    ).then(results => {
      if (!cancelled) {
        setAllEnquiries(results.flat())
        setLoading(false)
        setRefreshing(false)
      }
    })
    return () => { cancelled = true }
  }, [customers, refreshKey])

  useEffect(() => {
    function handleFocus() { setRefreshKey(k => k + 1) }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

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

  // Apply category + sales-type filters to any enquiry list (both independent
  // axes, AND'd together — e.g. "Small B2B" + "Retail" at once).
  function byCat(list) {
    return list.filter(e => {
      const c = customerMap[e.customerId]
      return (!categoryFilter || c?.crm_category === categoryFilter) &&
             (!salesTypeFilter || effectiveSalesType(c) === salesTypeFilter)
    })
  }

  // Same, for orders (which key on customer_id, not customerId)
  function byCatOrder(list) {
    return list.filter(o => {
      const c = customerMap[o.customer_id]
      return (!categoryFilter || c?.crm_category === categoryFilter) &&
             (!salesTypeFilter || effectiveSalesType(c) === salesTypeFilter)
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
  const overdueList = byCat(allEnquiries.filter(e => e.follow_up_date && isOverdue(e.follow_up_date)))

  // Default follow-up list (overdue + next 7 days, per thread, category-filtered)
  const priorityFollowUps = byCat(allEnquiries
    .filter(e => e.follow_up_date && (isOverdue(e.follow_up_date) || isWithinDays(e.follow_up_date, 7))))
    .sort((a, b) => (a.follow_up_date?.seconds || 0) - (b.follow_up_date?.seconds || 0))
    .slice(0, 10)

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
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
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

      {/* Category filter pills */}
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
                ? 'bg-gray-800 border-gray-800 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {Icon && <Icon size={13} className="inline align-[-2px] mr-1" />}{label}
          </button>
        ))}
        {categoryFilter && (
          <button
            onClick={() => setCategoryFilter(null)}
            className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Sales Type filter pills — Retail vs Wholesale, independent of the
          Customer Type row above (both can be active at once). Unset
          customers fall back to a Source-derived guess via effectiveSalesType. */}
      <div className="flex flex-wrap gap-2 mb-4">
        {SALES_TYPES.map(value => (
          <button
            key={value}
            onClick={() => setSalesTypeFilter(f => f === value ? null : value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              salesTypeFilter === value
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {value} <span className={salesTypeFilter === value ? 'text-white/70' : 'text-gray-400'}>
              {customers.filter(c => effectiveSalesType(c) === value).length}
            </span>
          </button>
        ))}
        {salesTypeFilter && (
          <button
            onClick={() => setSalesTypeFilter(null)}
            className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Filtered panel — shown when a stat card is active */}
      {activeFilter && (
        <div className="card mb-6 ring-2 ring-brand-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              {(() => { const I = filterConfig[activeFilter].Icon; return I ? <I size={15} /> : null })()}
              {filterConfig[activeFilter].title}
              {(categoryFilter || salesTypeFilter) && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  · {[categoryFilter, salesTypeFilter].filter(Boolean).join(' · ')}
                </span>
              )}
            </h2>
            <button onClick={() => setActiveFilter(null)} className="text-gray-400 hover:text-gray-600 leading-none"><X size={18} /></button>
          </div>
          {filterConfig[activeFilter].items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{filterConfig[activeFilter].empty}</p>
          ) : filterConfig[activeFilter].type === 'order' ? (
            <div className="divide-y divide-gray-100">
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
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{cust?.company_name || o.customer_name || '—'}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{orderUc(o) || o.id}</p>
                    </div>
                    <p className="text-xs text-gray-400 shrink-0">{dateStr}</p>
                  </Link>
                )
              })}
            </div>
          ) : filterConfig[activeFilter].type === 'quote' ? (
            <div className="divide-y divide-gray-100">
              {filterConfig[activeFilter].items.map(q => {
                const cust = customerMap[q.customer_id]
                return (
                  <Link
                    key={q.id}
                    to={`/quotes/${q.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{cust?.company_name || q.customer_name || '—'}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${QUOTE_STATUS_BADGE[q.status] || 'bg-gray-100 text-gray-500'}`}>
                          {q.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{q.title || q.id}</p>
                    </div>
                    <p className="text-xs text-gray-400 shrink-0">{fmtDate(q.createdAt)}</p>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filterConfig[activeFilter].items.map(enq => {
                const overdue = enq.follow_up_date && isOverdue(enq.follow_up_date)
                const today   = enq.follow_up_date && isToday(enq.follow_up_date)
                return (
                  <div key={`${enq.customerId}-${enq.id}`} className="px-5 py-3.5">
                    <div className="flex items-start gap-3">
                      <Link to={`/customers/${enq.customerId}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{enq.companyName}</p>
                          {enq.customerName && <p className="text-xs text-gray-400">{enq.customerName}</p>}
                          {enq.channel && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CHANNEL_BADGE[enq.channel] || 'bg-gray-100 text-gray-500'}`}>
                              {enq.channel}
                            </span>
                          )}
                          {enq.status && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                              {enq.status}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {enq.description?.slice(0, 100)}{enq.description?.length > 100 ? '…' : ''}
                        </p>
                        {enq.follow_up_date && (
                          <p className={`text-xs font-semibold mt-1 ${overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-gray-400'}`}>
                            {overdue ? <AlertTriangle size={11} className="inline align-[-1px] mr-1" /> : today ? <Calendar size={11} className="inline align-[-1px] mr-1" /> : null}Follow-up: {fmtDate(enq.follow_up_date)}
                          </p>
                        )}
                        {enq.date && !enq.follow_up_date && (
                          <p className="text-xs text-gray-400 mt-1">{fmtDate(enq.date)}</p>
                        )}
                      </Link>
                      {(activeFilter === 'overdue') && (
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={e => handleLog(enq, e)}
                            className="px-2.5 py-1 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition-colors"
                          >
                            + Log
                          </button>
                          <button
                            onClick={e => handleDone(enq, e)}
                            disabled={dismissing === enq.id}
                            className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs font-medium hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors"
                          >
                            {dismissing === enq.id ? '…' : <span className="inline-flex items-center gap-1"><Check size={12} />Done</span>}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Priority follow-ups (default, hidden when filter active) */}
      {!activeFilter && (
        <div className="card mb-6">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Priority Follow-ups</h2>
          </div>
          {priorityFollowUps.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              {(categoryFilter || salesTypeFilter)
                ? `No follow-ups for ${[categoryFilter, salesTypeFilter].filter(Boolean).join(' · ')} in the next 7 days`
                : 'No follow-ups due in the next 7 days'}
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {priorityFollowUps.map(enq => {
                const overdue = isOverdue(enq.follow_up_date)
                const today   = isToday(enq.follow_up_date)
                return (
                  <div key={`${enq.customerId}-${enq.id}`} className="px-5 py-3.5">
                    <div className="flex items-start gap-3">
                      <Link to={`/customers/${enq.customerId}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{enq.companyName}</p>
                          {enq.customerName && <p className="text-xs text-gray-400">{enq.customerName}</p>}
                          {enq.channel && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CHANNEL_BADGE[enq.channel] || 'bg-gray-100 text-gray-500'}`}>
                              {enq.channel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {enq.description?.slice(0, 100)}{enq.description?.length > 100 ? '…' : ''}
                        </p>
                        <p className={`text-xs font-semibold mt-1 ${overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-gray-400'}`}>
                          {overdue ? <AlertTriangle size={11} className="inline align-[-1px] mr-1" /> : today ? <Calendar size={11} className="inline align-[-1px] mr-1" /> : null}{fmtDate(enq.follow_up_date)}
                        </p>
                      </Link>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          onClick={e => handleLog(enq, e)}
                          className="px-2.5 py-1 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition-colors"
                        >
                          + Log
                        </button>
                        <button
                          onClick={e => handleDone(enq, e)}
                          disabled={dismissing === enq.id}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs font-medium hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors"
                        >
                          {dismissing === enq.id ? '…' : <span className="inline-flex items-center gap-1"><Check size={12} />Done</span>}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Log interaction drawer */}
      {logTarget && (
        <EnquiryForm
          customerId={logTarget.customerId}
          customerQuotes={quotes.filter(q => q.customer_id === logTarget.customerId)}
          onSave={() => refresh()}
          onClose={() => setLogTarget(null)}
        />
      )}

      {/* Personal WhatsApp panel */}
      {personalWaCustomers.length > 0 && (
        <div className="card mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Smartphone size={15} />Personal WhatsApp Contacts</h2>
            <p className="text-xs text-gray-400 mt-0.5">These contacts use personal WhatsApp — check your personal phone</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {personalWaCustomers.map(c => (
              <li key={c.id}>
                <Link
                  to={`/customers/${c.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm text-gray-800">
                    <span className="font-medium">{c.contact_name || c.company_name}</span>
                    {c.contact_name && c.company_name && <span className="text-gray-400"> · {c.company_name}</span>}
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
      className={`${c.bg} border-2 ${active ? c.activeBorder : c.border} rounded-xl p-4 text-left w-full transition-all hover:shadow-sm ${active ? 'shadow-sm' : ''}`}
    >
      <p className={`text-3xl font-bold ${c.num}`}>{value}</p>
      <p className={`text-xs font-semibold mt-1 leading-tight ${c.label}`}>{label}</p>
      {note && <p className="text-xs text-gray-400 mt-0.5 leading-tight">{note}</p>}
      {active && <p className={`inline-flex items-center gap-1 text-xs mt-1 font-medium ${c.label} opacity-70`}><ChevronUp size={12} />filtered</p>}
    </button>
  )
}
