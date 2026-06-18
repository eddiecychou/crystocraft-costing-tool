import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { CUSTOMER_CURRENCIES } from '../currency'
import LoadingBar from '../components/LoadingBar'
import { ShieldCheck, Clock, UserCheck } from 'lucide-react'

export default function CustomerAccounts() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const set = (id, patch) => updateDoc(doc(db, 'users', id), { ...patch, updatedAt: serverTimestamp() })

  const pending  = users.filter(u => u.role === 'customer' && u.status !== 'approved')
  const approved = users.filter(u => u.role === 'customer' && u.status === 'approved')
  const admins   = users.filter(u => u.role === 'admin')

  const tabs = [
    { v: 'pending',  label: 'Pending',  Icon: Clock,       n: pending.length },
    { v: 'approved', label: 'Customers', Icon: UserCheck,  n: approved.length },
    { v: 'admins',   label: 'Admins',   Icon: ShieldCheck, n: admins.length },
  ]
  const rows = tab === 'pending' ? pending : tab === 'approved' ? approved : admins

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <h1 className="text-xl md:text-2xl mb-1">Customer Accounts</h1>
      <p className="text-sm text-ink-60 mb-4">Approve sign-ups, set base currency and wholesale discount, and manage admins.</p>

      <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden mb-5">
        {tabs.map(t => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors flex items-center gap-1.5
              ${tab === t.v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
            <t.Icon size={14} /> {t.label} <span className="opacity-60">{t.n}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-ink-60">Nothing here.</div>
      ) : (
        <div className="space-y-2">
          {rows.map(u => <Row key={u.id} u={u} tab={tab} set={set} />)}
        </div>
      )}
    </div>
  )
}

function Row({ u, tab, set }) {
  const [cur, setCur] = useState(u.base_currency || 'USD')
  const [disc, setDisc] = useState(u.ws_discount_pct ?? 0)
  const [override, setOverride] = useState(u.corp_markup_override ?? '')
  const [status, setStatus] = useState(null) // 'saving' | 'saved' | error string

  // Corp pricing is driven by a per-customer markup for now (no groups UI).
  const pricingPatch = {
    corp_markup_override: override === '' ? 0 : Number(override) || 0,
  }

  async function save(extra = {}) {
    setStatus('saving')
    try {
      await set(u.id, { base_currency: cur, ws_discount_pct: Number(disc) || 0, ...pricingPatch, ...extra })
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not save'))
    }
  }

  return (
    <div className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink truncate">{u.company_name || '—'}</p>
        <p className="text-xs text-ink-60 truncate">{u.contact_name ? `${u.contact_name} · ` : ''}{u.email}</p>
      </div>

      {tab !== 'admins' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="text-xs text-ink-60">Currency
            <select className="input py-1 ml-1 w-24 inline-block" value={cur} onChange={e => setCur(e.target.value)}>
              {CUSTOMER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>

          {/* Figurine Gift Catalogue — wholesale list price less a discount % */}
          <div className="flex items-center gap-2 pl-3 border-l border-ivory-dark">
            <span className="text-[10px] uppercase tracking-wide text-ink-40">Figurine Gift Catalogue</span>
            <label className="text-xs text-ink-60">WS %
              <input type="number" min="0" max="100" step="0.5" className="input py-1 ml-1 w-20 inline-block"
                value={disc} onChange={e => setDisc(e.target.value)} />
            </label>
          </div>

          {/* Corp Gift Catalogue — made-to-order, priced as cost × markup */}
          <div className="flex items-center gap-2 pl-3 border-l border-ivory-dark">
            <span className="text-[10px] uppercase tracking-wide text-ink-40">Corp Gift Catalogue</span>
            <label className="text-xs text-ink-60" title="Sell price = product cost × this markup (e.g. 2.0 = cost doubled).">Markup ×
              <input type="number" min="0" step="0.05" placeholder="2.0" className="input py-1 ml-1 w-20 inline-block"
                value={override} onChange={e => setOverride(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {tab === 'pending' && (
          <button className="btn-primary text-sm" disabled={status === 'saving'}
            onClick={() => save({ status: 'approved' })}>
            {status === 'saving' ? 'Approving…' : 'Approve'}
          </button>
        )}
        {tab === 'approved' && (
          <>
            <button className="btn-secondary text-sm" disabled={status === 'saving'} onClick={() => save()}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button className="text-xs text-ink-50 hover:text-amber-600"
              onClick={() => { if (confirm('Suspend this customer? They will lose pricing access.')) set(u.id, { status: 'pending' }) }}>
              Suspend
            </button>
            <button className="text-xs text-ink-50 hover:text-brand-600"
              onClick={() => { if (confirm('Promote this customer to ADMIN? They get full access to the costing tool.')) set(u.id, { role: 'admin' }) }}>
              Make admin
            </button>
          </>
        )}
        {tab === 'admins' && (
          <button className="text-xs text-ink-50 hover:text-red-600"
            onClick={() => { if (confirm('Remove admin access? They become a pending customer.')) set(u.id, { role: 'customer', status: 'pending' }) }}>
            Revoke admin
          </button>
        )}
        {status && status !== 'saving' && (
          <span className={`text-xs ${status === 'saved' ? 'text-green-600' : 'text-red-600'}`}>
            {status === 'saved' ? 'Saved ✓' : status}
          </span>
        )}
      </div>
    </div>
  )
}
