import { useState, useEffect } from 'react'
import { collection, query, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'

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

function isThisMonth(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const now = new Date()
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

const CHANNEL_BADGE = {
  'Email':             'bg-purple-100 text-purple-700',
  'WhatsApp Business': 'bg-green-100 text-green-700',
  'Alibaba':           'bg-orange-100 text-orange-700',
  'Personal WhatsApp': 'bg-amber-100 text-amber-700',
}

export default function Dashboard() {
  const [customers, setCustomers]   = useState([])
  const [quotes, setQuotes]         = useState([])
  const [allEnquiries, setAllEnquiries] = useState([]) // [{...enquiry, customerId, customerName, companyName}]
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    // Load customers + quotes in parallel
    const unsubCustomers = onSnapshot(query(collection(db, 'customers')), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const unsubQuotes = onSnapshot(query(collection(db, 'client_quotes')), snap => {
      setQuotes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => { unsubCustomers(); unsubQuotes() }
  }, [])

  // Batch-fetch all enquiry subcollections once customers are loaded
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
            channel:      d.data().channel || c.primary_channel || '',
          }))
        )
      )
    ).then(results => {
      if (!cancelled) {
        setAllEnquiries(results.flat())
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [customers])

  // Stat card calculations
  const followUpsDue   = allEnquiries.filter(e => e.follow_up_date && isOverdue(e.follow_up_date)).length
  const openEnquiries  = allEnquiries.filter(e => e.status === 'Open').length
  const activeQuotes   = quotes.filter(q => q.status === 'draft' || q.status === 'sent').length
  const wonThisMonth   = quotes.filter(q => q.status === 'won' && isThisMonth(q.createdAt)).length

  // Priority follow-ups: within next 7 days, sorted ascending
  const priorityFollowUps = allEnquiries
    .filter(e => e.follow_up_date && isWithinDays(e.follow_up_date, 7))
    .sort((a, b) => (a.follow_up_date?.seconds || 0) - (b.follow_up_date?.seconds || 0))
    .slice(0, 10)

  // Personal WhatsApp customers
  const personalWaCustomers = customers.filter(c => c.is_personal_wa)

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {loading && <LoadingBar />}

      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overview · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Follow-ups Due"
          value={followUpsDue}
          colour="red"
          note="overdue"
        />
        <StatCard
          label="Open Enquiries"
          value={openEnquiries}
          colour="amber"
          note="active"
        />
        <StatCard
          label="Active Quotes"
          value={activeQuotes}
          colour="blue"
          note="draft / sent"
        />
        <StatCard
          label="Won This Month"
          value={wonThisMonth}
          colour="green"
          note={new Date().toLocaleDateString('en-GB', { month: 'short' })}
        />
      </div>

      {/* Priority actions */}
      <div className="card mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Priority Follow-ups (next 7 days)</h2>
        </div>
        {priorityFollowUps.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No follow-ups due in the next 7 days 🎉</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {priorityFollowUps.map(enq => {
              const overdue = isOverdue(enq.follow_up_date)
              const today   = isToday(enq.follow_up_date)
              return (
                <Link
                  key={`${enq.customerId}-${enq.id}`}
                  to={`/customers/${enq.customerId}`}
                  className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900">{enq.companyName}</p>
                      {enq.customerName && <p className="text-xs text-gray-400">{enq.customerName}</p>}
                      {enq.channel && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CHANNEL_BADGE[enq.channel] || 'bg-gray-100 text-gray-500'}`}>
                          {enq.channel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">
                      {enq.description?.slice(0, 80)}{enq.description?.length > 80 ? '…' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xs font-semibold ${overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-gray-500'}`}>
                      {overdue ? '⚠️ ' : today ? '📅 ' : ''}{fmtDate(enq.follow_up_date)}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Personal WhatsApp panel */}
      {personalWaCustomers.length > 0 && (
        <div className="card mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">📱 Personal WhatsApp Contacts</h2>
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

function StatCard({ label, value, colour, note }) {
  const colours = {
    red:   { bg: 'bg-red-50',   border: 'border-red-100',  num: 'text-red-600',   label: 'text-red-700' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100',num: 'text-amber-600', label: 'text-amber-700' },
    blue:  { bg: 'bg-blue-50',  border: 'border-blue-100', num: 'text-blue-600',  label: 'text-blue-700' },
    green: { bg: 'bg-green-50', border: 'border-green-100',num: 'text-green-600', label: 'text-green-700' },
  }
  const c = colours[colour] || colours.blue

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
      <p className={`text-3xl font-bold ${c.num}`}>{value}</p>
      <p className={`text-xs font-semibold mt-1 ${c.label}`}>{label}</p>
      {note && <p className="text-xs text-gray-400 mt-0.5">{note}</p>}
    </div>
  )
}
