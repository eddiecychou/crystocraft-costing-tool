import { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
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

// Two groups on this page: real portal customers, and everyone else who
// signs in through the same door — staff (admin / production roles) and
// internal test logins (account_type === 'internal'), lumped together as
// "internal". Staff DO carry GA4 app_uid sessions, so they show under the
// Internal / All filters; the headline "customer" stats never count them.
const roleGroupOf = u =>
  (u?.role === 'admin' || u?.role === 'production' || u?.account_type === 'internal') ? 'internal' : 'customer'

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

  // GA4 traffic (V8.11) — see ga-portal-activity.js's own comment. `rows` is
  // site-wide daily traffic (everyone, staff included) — a cross-check on
  // the roster's trend, not a merge. `byUid` IS a real per-account merge,
  // keyed by Firebase uid (== each row's own doc id below) — only for
  // sessions after useAuthState.js started tagging app_uid, so a quiet
  // account here may just predate that, not actually be inactive.
  const [traffic, setTraffic] = useState(null)   // null = loading, [] = loaded empty
  const [gaByUid, setGaByUid] = useState({})
  const [gaUnmatched, setGaUnmatched] = useState(0)
  const [trafficError, setTrafficError] = useState('')
  useEffect(() => {
    fetchPortalTraffic()
      .then(({ rows, byUid, unmatched }) => { setTraffic(rows); setGaByUid(byUid); setGaUnmatched(unmatched) })
      .catch(e => { setTrafficError(e.message || 'Could not load GA4 traffic.'); setTraffic([]) })
  }, [])

  // How much of GA4's per-account matching has actually landed — shown under
  // the panel so a table full of "—" reads as "no traffic yet", not "broken".
  const gaMatched = useMemo(() => {
    const uids = Object.keys(gaByUid)
    return { accounts: uids.length, sessions: uids.reduce((s, k) => s + (gaByUid[k].sessions || 0), 0) }
  }, [gaByUid])

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

  // Every account that reaches the portal — customers, internal test logins,
  // and staff. The default "Customers" chip keeps the view focused on real
  // customers; "Staff" / "All" surface the admin & production logins, which
  // are the ones that actually carry GA4 sessions right now.
  const accounts = users

  const rows = useMemo(() => {
    let list = accounts
    if (typeFilter !== 'all') list = list.filter(u => roleGroupOf(u) === typeFilter)
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

  // Counted over real customer accounts only, so internal test logins and
  // staff don't flatter the numbers.
  const stats = useMemo(() => {
    const real = accounts.filter(u => roleGroupOf(u) === 'customer')
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
          <TrendingUp size={14} className="text-ink-60" />
          <h2 className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Site traffic (Google Analytics)</h2>
        </div>
        {trafficError ? (
          <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={14} />{trafficError}</p>
        ) : traffic === null ? (
          <p className="text-sm text-ink-60">Loading…</p>
        ) : !trafficSummary ? (
          <p className="text-sm text-ink-60">No GA4 data for the last 30 days.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.sessions7d.toLocaleString()}</p>
                <p className="text-xs text-ink-60">Sessions, last 7 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.users7d.toLocaleString()}</p>
                <p className="text-xs text-ink-60">Active users, last 7 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">{trafficSummary.sessions30d.toLocaleString()}</p>
                <p className="text-xs text-ink-60">Sessions, last 30 days</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">
                  {trafficSummary.peak?.sessions.toLocaleString()}
                  <span className="text-xs font-normal text-ink-60 ml-1">
                    on {trafficSummary.peak && `${trafficSummary.peak.date.slice(4,6)}/${trafficSummary.peak.date.slice(6,8)}`}
                  </span>
                </p>
                <p className="text-xs text-ink-60">Busiest day, last 30 days</p>
              </div>
            </div>
            <p className="text-2xs text-ink-60 mt-3 pt-2 border-t border-ivory-dark">
              These totals are every visitor to the whole site — staff included, not matched to any account.
              The "GA sessions (30d)" column in the table below IS matched per account, via a Firebase-uid
              tag added 2026-08-27 — use these totals to sanity-check the overall trend, the column for a
              real per-account number.
              {(gaMatched.sessions > 0 || gaUnmatched > 0) && (
                <>
                  {' '}So far <strong className="text-ink-60">{gaMatched.sessions.toLocaleString()}</strong>{' '}
                  session{gaMatched.sessions === 1 ? '' : 's'} across{' '}
                  <strong className="text-ink-60">{gaMatched.accounts}</strong>{' '}
                  account{gaMatched.accounts === 1 ? '' : 's'} matched;{' '}
                  <strong className="text-ink-60">{gaUnmatched.toLocaleString()}</strong>{' '}
                  not yet attributed (signed-out visits, or from before the tag shipped) — a blank column is
                  "no traffic yet", not an error.
                </>
              )}
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
          ['Never signed in', stats.never, stats.never ? 'text-red-600' : 'text-ink-60'],
        ].map(([label, n, cls]) => (
          <div key={label} className="min-w-[92px]">
            <div className={`text-lg font-semibold ${cls}`}>{n}</div>
            <div className="text-2xs text-ink-60 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-60" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email, name, customer…"
            className="pl-8 pr-3 py-1.5 text-sm border border-ivory-dark rounded-none w-64 focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
        </div>
        <div className="flex gap-1.5">
          {chip('customer', 'Customers', null, typeFilter, setTypeFilter)}
          {chip('internal', 'Staff & internal', null, typeFilter, setTypeFilter)}
          {chip('all', 'All', null, typeFilter, setTypeFilter)}
        </div>
        <div className="flex gap-1.5 md:ml-2">
          {chip('all', 'Any time', null, seenFilter, setSeenFilter)}
          {chip('recent', 'Last 30 days', null, seenFilter, setSeenFilter)}
          {chip('quiet', 'Quiet', null, seenFilter, setSeenFilter)}
          {chip('never', 'Never', null, seenFilter, setSeenFilter)}
        </div>
      </div>

      <div className="border border-ivory-dark rounded-none overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink-60 border-b border-ivory-dark bg-ivory/50">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Last sign-in</th>
                <th className="px-3 py-2 font-medium text-right">Sign-ins</th>
                <th className="px-3 py-2 font-medium text-right" title="Sessions GA4 actually matched to this account — only from 2026-08-27 onward, see the page's own note below.">GA sessions (30d)</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-60">No accounts match.</td></tr>
              )}
              {rows.map(u => {
                const cust = customersById.get(u.customer_id)
                const d = daysSince(u.last_login_at)
                const status = u.status === 'approved' ? 'approved' : u.status === 'suspended' ? 'suspended' : 'pending'
                const ga = gaByUid[u.id]
                return (
                  <tr key={u.id} className="border-b border-ivory last:border-0 hover:bg-ivory/40">
                    <td className="px-3 py-2.5">
                      <div className="text-ink">{u.name || u.email || u.id}</div>
                      {u.name && u.email && <div className="text-2xs text-ink-60">{u.email}</div>}
                      {roleGroupOf(u) === 'internal' && (
                        <span className="text-2xs px-1.5 py-0.5 rounded-none bg-ivory-dark text-ink-60 uppercase tracking-wide">
                          {u.role === 'admin' || u.role === 'production' ? u.role : 'internal'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-70">
                      {cust?.company_name || <span className="text-ink-60">— not linked</span>}
                    </td>
                    <td className="px-3 py-2.5" title={fmtExact(u.last_login_at)}>
                      <span className={d === null ? 'text-red-600' : d > 30 ? 'text-amber-700' : 'text-ink-70'}>
                        {fmtAgo(u.last_login_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-70">{u.login_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {ga ? <span className="text-ink-70">{ga.sessions}</span> : <span className="text-ink-60">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-2xs px-1.5 py-0.5 rounded-none ${STATUS_STYLE[status]}`}>{status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link to={`/portal/accounts/${u.id}`} className="text-ink-60 hover:text-brand-600 inline-flex">
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

      <p className="text-2xs text-ink-60 mt-2">
        "Sign-ins" comes from each account's own record, updated on sign-in — so this is the last time someone
        signed in, not a history of every visit. "GA sessions" is a real per-account match from Google Analytics,
        but only counts from 2026-08-27 onward (when session tagging shipped) — a "—" there can mean either no
        recent GA activity or simply that it predates the tagging, not necessarily an inactive account.
      </p>
    </div>
  )
}
