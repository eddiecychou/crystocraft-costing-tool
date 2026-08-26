import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { accountTypeOf } from './CustomerAccounts'
import { fetchPortalTraffic } from '../gaPortalActivityApi'
import { ChevronRight, Search, TrendingUp, AlertTriangle } from 'lucide-react'

// Portal sign-in overview — every account's login state on one page, so the
// question "who has actually been using the portal?" doesn't mean opening
// accounts one at a time.
//
// WHAT THIS IS, AND IS NOT. `users` docs carry `last_login_at` and
// `login_count`, stamped via authActivity.js's stampLogin() on each
// successful sign-in — both Login.jsx's normal sign-in and SetPassword.jsx's
// post-setup sign-in (new-account approval, password reset) call it. That is a
// LAST-SEEN ROSTER, not an event log: only the most recent timestamp survives,
// so this can say "Karina last signed in on 14 July, 23 times in total" but
// never "she signed in on the 3rd, 9th and 14th". A true chronological log
// needs a row written per sign-in, and would only cover from the day it ships.
// This works retroactively over every login ever recorded, which is why it is
// built first.

const toDate = ts => ts?.toDate?.() || (ts instanceof Date ? ts : null)

const fmtExact = ts => {
  const d = toDate(ts)
  return d ? d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'never signed in'
}

// "3 days ago" reads faster than a date when scanning for who has gone quiet.
const fmtAgo = ts => {
  const d = toDate(ts)
  if (!d) return 'never'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years > 1 ? 's' : ''} ago`
}

// Buckets for the summary strip and the row tint. Deliberately coarse — the
// useful question is "active / gone quiet / never", not an exact age.
const daysSince = ts => {
  const d = toDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null
}

const STATUS_STYLE = {
  approved:  'bg-emerald-50 text-emerald-700',
  suspended: 'bg-red-50 text-red-600',
  pending:   'bg-amber-50 text-amber-700',
}

export default function PortalLogins({ embedded = false }) {
  const [users, setUsers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('customer')  // customer | internal | all
  const [seenFilter, setSeenFilter] = useState('all')       // all | recent | quiet | never

  useEffect(() => onSnapshot(collection(db, 'users'), snap => {
    setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }), [])

  useEffect(() => onSnapshot(collection(db, 'customers'), snap => {
    setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }), [])

  // GA4 traffic (V8.11) — see ga-portal-activity.js's own comment for the
  // real limitation: this is EVERY visitor to the site (staff included),
  // not matched to a specific account, because nothing in this app ever
  // calls gtag('set', {user_id}). It's a cross-check on the roster below —
  // "does the trend roughly agree" — not a merge of the two.
  const [traffic, setTraffic] = useState(null)   // null = loading, [] = loaded empty
  const [trafficError, setTrafficError] = useState('')
  useEffect(() => {
    fetchPortalTraffic()
      .then(setTraffic)
      .catch(e => { setTrafficError(e.message || 'Could not load GA4 traffic.'); setTraffic([]) })
  }, [])

  const trafficSummary = useMemo(() => {
    if (!traffic?.length) return null
    const last7 = traffic.slice(-7)
    const sumSessions = arr => arr.reduce((s, r) => s + r.sessions, 0)
    const sumUsers = arr => arr.reduce((s, r) => s + r.activeUsers, 0)
    return {
      sessions7d: sumSessions(last7),
      users7d: sumUsers(last7),
      sessions30d: sumSessions(traffic),
      users30d: sumUsers(traffic),
      peak: [...traffic].sort((a, b) => b.sessions - a.sessions)[0],
    }
  }, [traffic])

  const customersById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])

  // Portal accounts only. Admins sign in through the same door but they are
  // not what "customer login status" is asking about.
  const accounts = useMemo(() => users.filter(u => u.role === 'customer'), [users])

  const rows = useMemo(() => {
    let list = accounts
    if (typeFilter !== 'all') list = list.filter(u => accountTypeOf(u) === typeFilter)
    if (seenFilter !== 'all') {
      list = list.filter(u => {
        const d = daysSince(u.last_login_at)
        if (seenFilter === 'never')  return d === null
        if (seenFilter === 'recent') return d !== null && d <= 30
        return d !== null && d > 30                    // quiet
      })
    }
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(u => {
        const cust = customersById.get(u.customer_id)
        return `${u.email || ''} ${u.name || ''} ${cust?.company_name || ''}`.toLowerCase().includes(needle)
      })
    }
    // Most recent first; never-signed-in sink to the bottom rather than the top,
    // which is where a null date would otherwise sort.
    return [...list].sort((a, b) => {
      const da = toDate(a.last_login_at)?.getTime() ?? -Infinity
      const dbb = toDate(b.last_login_at)?.getTime() ?? -Infinity
      return dbb - da
    })
  }, [accounts, typeFilter, seenFilter, q, customersById])

  // Counted over real customer accounts only, so internal test logins don't
  // flatter the numbers.
  const stats = useMemo(() => {
    const real = accounts.filter(u => accountTypeOf(u) === 'customer')
    const d = real.map(u => daysSince(u.last_login_at))
    return {
      total:  real.length,
      week:   d.filter(x => x !== null && x <= 7).length,
      month:  d.filter(x => x !== null && x <= 30).length,
      quiet:  d.filter(x => x !== null && x > 30).length,
      never:  d.filter(x => x === null).length,
    }
  }, [accounts])

  const chip = (v, label, n, cur, set) => (
    <button key={v} type="button" onClick={() => set(v)}
      className={`px-2.5 py-1 text-xs rounded-full border transition ${
        cur === v ? 'bg-ink text-white border-ink' : 'bg-white text-ink-60 border-ivory-dark hover:bg-ivory'
      }`}>
      {label}{n != null && <span className="opacity-60"> {n}</span>}
    </button>
  )

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      {!embedded && <h1 className="text-xl md:text-2xl mb-1">Portal Logins</h1>}
      <p className="text-sm text-ink-60 mb-4">
        Sign-in status for every portal account, most recent first. Click through to the account to change access.
      </p>

      {/* GA4 cross-check — not a merge, see the fetch effect's own comment. */}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp size={14} className="text-ink-40" />
          <h2 className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Site traffic (Google Analytics)</h2>
        </div>
        {trafficError ? (
          <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={14} />{trafficError}</p>
        ) : traffic === null ? (
          <p className="text-sm text-ink-40">Loading…</p>
        ) : !trafficSummary ? (
          <p className="text-sm text-ink-40">No GA4 data for the last 30 days.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.sessions7d.toLocaleString()}</p>
                <p className="text-xs text-ink-40">Sessions, last 7 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.users7d.toLocaleString()}</p>
                <p className="text-xs text-ink-40">Active users, last 7 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.sessions30d.toLocaleString()}</p>
                <p className="text-xs text-ink-40">Sessions, last 30 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">
                  {trafficSummary.peak?.sessions.toLocaleString()}
                  <span className="text-xs font-normal text-ink-40 ml-1">
                    on {trafficSummary.peak && `${trafficSummary.peak.date.slice(4,6)}/${trafficSummary.peak.date.slice(6,8)}`}
                  </span>
                </p>
                <p className="text-xs text-ink-40">Busiest day, last 30 days</p>
              </div>
            </div>
            <p className="text-[11px] text-ink-40 mt-3 pt-2 border-t border-ivory-dark">
              Every visitor to the whole site — staff included — not matched to a specific account below.
              Use it to sanity-check the roster's trend, not as a per-customer count.
            </p>
          </>
        )}
      </div>

      {/* Summary. "Never" is the number worth watching — an approved account
          that has never signed in usually means the welcome email never landed. */}
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        {[
          ['Accounts', stats.total, 'text-ink'],
          ['Signed in this week', stats.week, 'text-emerald-700'],
          ['This month', stats.month, 'text-emerald-700'],
          ['Quiet 30 days+', stats.quiet, 'text-amber-700'],
          ['Never signed in', stats.never, stats.never ? 'text-red-600' : 'text-ink-40'],
        ].map(([label, n, cls]) => (
          <div key={label} className="min-w-[92px]">
            <div className={`text-lg font-semibold ${cls}`}>{n}</div>
            <div className="text-[11px] text-ink-50 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-40" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email, name, customer…"
            className="pl-8 pr-3 py-1.5 text-sm border border-ivory-dark rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
        </div>
        <div className="flex gap-1.5">
          {chip('customer', 'Customers', null, typeFilter, setTypeFilter)}
          {chip('internal', 'Internal', null, typeFilter, setTypeFilter)}
          {chip('all', 'All', null, typeFilter, setTypeFilter)}
        </div>
        <div className="flex gap-1.5 md:ml-2">
          {chip('all', 'Any time', null, seenFilter, setSeenFilter)}
          {chip('recent', 'Last 30 days', null, seenFilter, setSeenFilter)}
          {chip('quiet', 'Quiet', null, seenFilter, setSeenFilter)}
          {chip('never', 'Never', null, seenFilter, setSeenFilter)}
        </div>
      </div>

      <div className="border border-ivory-dark rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink-50 border-b border-ivory-dark bg-ivory/50">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-3 py-2 font-medium text-right">Sign-ins</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-40">No accounts match.</td></tr>
              )}
              {rows.map(u => {
                const cust = customersById.get(u.customer_id)
                const d = daysSince(u.last_login_at)
                const status = u.status === 'approved' ? 'approved' : u.status === 'suspended' ? 'suspended' : 'pending'
                return (
                  <tr key={u.id} className="border-b border-ivory last:border-0 hover:bg-ivory/40">
                    <td className="px-3 py-2.5">
                      <div className="text-ink">{u.name || u.email || u.id}</div>
                      {u.name && u.email && <div className="text-[11px] text-ink-50">{u.email}</div>}
                      {accountTypeOf(u) === 'internal' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">Internal</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-70">
                      {cust?.company_name || <span className="text-ink-30">— not linked</span>}
                    </td>
                    <td className="px-3 py-2.5" title={fmtExact(u.last_login_at)}>
                      <span className={d === null ? 'text-red-600' : d > 30 ? 'text-amber-700' : 'text-ink-70'}>
                        {fmtAgo(u.last_login_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-70">{u.login_count ?? 0}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_STYLE[status]}`}>{status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link to={`/portal/accounts/${u.id}`} className="text-ink-40 hover:text-brand-600 inline-flex">
                        <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-ink-40 mt-2">
        Counts come from each account's own record, updated on sign-in — so this is the last time someone
        signed in, not a history of every visit.
      </p>
    </div>
  )
}
