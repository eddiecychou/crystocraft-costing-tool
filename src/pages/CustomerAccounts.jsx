import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { ShieldCheck, Clock, UserCheck, Building2, Ban, X, ChevronRight } from 'lucide-react'

// Account category — accounts default to real "customer"; "internal" is for
// our own test / checking logins so they can be told apart at a glance.
export const accountTypeOf = u => (u?.account_type === 'internal' ? 'internal' : 'customer')

export default function CustomerAccounts({ embedded = false }) {
  const [users, setUsers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('approved')
  const [typeFilter, setTypeFilter] = useState('all') // all | customer | internal
  const [search, setSearch] = useState('')

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    return onSnapshot(collection(db, 'customers'), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
  }, [])

  const customersById = new Map(customers.map(c => [c.id, c]))

  // Flag accounts whose login email is shared by more than one users doc —
  // these are usually orphaned/hand-made duplicates that need reconciling
  // (the real one's doc ID matches the uid in Firebase Console → Authentication).
  const emailCount = new Map()
  for (const usr of users) {
    const e = (usr.email || '').trim().toLowerCase()
    if (e) emailCount.set(e, (emailCount.get(e) || 0) + 1)
  }
  const isDup = usr => {
    const e = (usr.email || '').trim().toLowerCase()
    return !!e && emailCount.get(e) > 1
  }

  const pending   = users.filter(u => u.role === 'customer' && u.status !== 'approved' && u.status !== 'suspended')
  const approved  = users.filter(u => u.role === 'customer' && u.status === 'approved')
  const suspended = users.filter(u => u.role === 'customer' && u.status === 'suspended')
  // Internal staff — admins, production (V8.12) AND sales (V8.13) logins.
  // Without these here, a staff login would appear in no tab at all.
  const staff     = users.filter(u => u.role === 'admin' || u.role === 'production' || u.role === 'sales')

  const tabs = [
    { v: 'pending',   label: 'Pending',   Icon: Clock,       n: pending.length },
    { v: 'approved',  label: 'Customers', Icon: UserCheck,   n: approved.length },
    { v: 'suspended', label: 'Suspended', Icon: Ban,         n: suspended.length },
    { v: 'admins',    label: 'Staff',     Icon: ShieldCheck, n: staff.length },
  ]
  let rows = tab === 'pending' ? pending
    : tab === 'approved' ? approved
    : tab === 'suspended' ? suspended
    : staff

  const showTypeFilter = tab !== 'admins'
  if (showTypeFilter && typeFilter !== 'all') rows = rows.filter(u => accountTypeOf(u) === typeFilter)

  // Search by name, email, or country — 37 customers and growing was already
  // enough to make "find one account" a real scroll (owner, 2026-08-27).
  const searchLower = search.trim().toLowerCase()
  if (searchLower) {
    rows = rows.filter(u => {
      const linked = u.customer_id ? customersById.get(u.customer_id) : null
      const name = linked?.company_name || u.company_name || ''
      const country = linked?.country || linked?.region || u.country || ''
      return name.toLowerCase().includes(searchLower) ||
        (u.email || '').toLowerCase().includes(searchLower) ||
        country.toLowerCase().includes(searchLower)
    })
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      {!embedded && <h1 className="text-xl md:text-2xl mb-1">Customer Accounts</h1>}
      <p className="text-sm text-ink-60 mb-4">Approve sign-ups and manage portal logins. Click an account to edit its currency, pricing and category.</p>

      <div className="overflow-x-auto overflow-y-hidden mb-4">
        <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden">
          {tabs.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0
                ${tab === t.v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
              <t.Icon size={14} /> {t.label} <span className="opacity-60">{t.n}</span>
            </button>
          ))}
        </div>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search name, email, or country…"
        className="input w-full mb-4"
      />

      {showTypeFilter && (
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className="uppercase tracking-wide text-ink-40">Show</span>
          {[['all', 'All'], ['customer', 'Customers'], ['internal', 'Internal']].map(([v, label]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                typeFilter === v ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-ivory-dark text-ink-60 hover:bg-ivory'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-16 text-ink-60">{searchLower ? 'No accounts match your search.' : 'Nothing here.'}</div>
      ) : (
        <div className="space-y-2">
          {rows.map(u => <Row key={u.id} u={u} linked={u.customer_id ? customersById.get(u.customer_id) : null} dup={isDup(u)} />)}
        </div>
      )}
    </div>
  )
}

// Compact, clickable summary — name (from linked customer when available),
// login email, country, and category. Editing happens on the account page.
function Row({ u, linked, dup }) {
  const name    = linked?.company_name || u.company_name || '—'
  const country = linked?.country || linked?.region || u.country || ''
  const type    = accountTypeOf(u)

  return (
    <Link to={`/portal/accounts/${u.id}`}
      className="card p-4 flex items-center gap-3 hover:bg-ivory/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-ink truncate">{name}</p>
          {u.role === 'customer' && <TypeBadge type={type} />}
          {dup && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 uppercase tracking-wide" title="Another account uses this same email — likely an orphaned or duplicate login to reconcile">Duplicate email</span>}
          {!linked && <span className="text-[10px] uppercase tracking-wide text-amber-600">Not linked</span>}
        </div>
        <p className="text-xs text-ink-70 break-all">{u.email || '—'}</p>
        <p className="text-xs text-ink-50">{country || <span className="text-ink-30">No country</span>}</p>
      </div>
      <ChevronRight size={18} className="text-ink-30 shrink-0" />
    </Link>
  )
}

export function TypeBadge({ type }) {
  return type === 'internal' ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase tracking-wide">Internal</span>
  ) : (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 uppercase tracking-wide">Customer</span>
  )
}

// Searchable picker that links this login account to a CRM customer record.
// One customer can be linked to many accounts (the link lives on the account).
export function CustomerPicker({ customers, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const selected = customers.find(c => c.id === value)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const matches = search
    ? customers.filter(c => (c.company_name || '').toLowerCase().includes(search.toLowerCase())).slice(0, 30)
    : customers.slice(0, 30)

  if (selected) {
    return (
      <div className="inline-flex items-center gap-1 text-sm">
        <Building2 size={14} className="text-ink-40" />
        <Link to={`/customers/${selected.id}`} className="text-brand-600 hover:underline truncate max-w-[220px]">
          {selected.company_name}
        </Link>
        <button onClick={() => onChange('')} className="text-ink-30 hover:text-red-500" title="Unlink"><X size={13} /></button>
      </div>
    )
  }

  return (
    <div className="relative inline-block" ref={ref}>
      {open ? (
        <div className="relative">
          <input
            autoFocus
            className="input py-1 text-sm w-64"
            placeholder="Search customer to link…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="absolute z-20 mt-1 w-72 max-h-56 overflow-auto bg-white border border-ivory-dark rounded-lg shadow-lg">
            {matches.length === 0 ? (
              <p className="text-xs text-ink-40 px-3 py-2">No customers found.</p>
            ) : matches.map(c => (
              <button key={c.id}
                onClick={() => { onChange(c.id); setOpen(false); setSearch('') }}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ivory border-b border-ivory-dark last:border-0">
                {c.company_name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-sm text-ink-40 hover:text-brand-600 inline-flex items-center gap-1">
          <Building2 size={14} /> Link to customer
        </button>
      )}
    </div>
  )
}
