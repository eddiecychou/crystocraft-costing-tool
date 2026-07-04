import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useCustomers } from '../domain/customer'
import { CUSTOMER_CURRENCIES, useRates, fromUSD } from '../currency'
import { CustomerPicker, TypeBadge } from './CustomerAccounts'
import LoadingBar from '../components/LoadingBar'
import { ArrowLeft } from 'lucide-react'

export default function AccountEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const rates = useRates()
  const { customers } = useCustomers()

  const [u, setU] = useState(null)         // raw account doc (role/status/email)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null) // 'saving' | 'saved' | error string

  // Editable form state (seeded once from the doc).
  const [cur, setCur]           = useState('USD')
  const [fxRate, setFxRate]     = useState('')
  const [disc, setDisc]         = useState(100)
  const [override, setOverride] = useState('')
  const [type, setType]         = useState('customer')
  const [customerId, setCustomerId] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'users', id)).then(s => {
      if (s.exists()) {
        const d = { id: s.id, ...s.data() }
        setU(d)
        setCur(d.base_currency || 'USD')
        setFxRate(d.fx_rate ?? '')
        setDisc(Number(d.ws_discount_pct) > 0 ? d.ws_discount_pct : 100)
        setOverride(d.corp_markup_override ?? '')
        setType(d.account_type === 'internal' ? 'internal' : 'customer')
        setCustomerId(d.customer_id || '')
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return <LoadingBar />
  if (!u) return <div className="p-6 text-ink-60">Account not found. <Link to="/portal" className="text-brand-600">Back to Portal</Link></div>

  const isSelf   = auth.currentUser?.uid === id
  const isAdmin  = u.role === 'admin'
  const isPending   = u.role === 'customer' && u.status !== 'approved' && u.status !== 'suspended'
  const isApproved  = u.role === 'customer' && u.status === 'approved'
  const isSuspended = u.role === 'customer' && u.status === 'suspended'
  const canDelete = !isSelf && u.role === 'customer' && (isPending || isSuspended)

  const linked = customerId ? customers.find(c => c.id === customerId) : null
  const displayName = linked?.company_name || u.company_name || u.email || '—'
  const liveRate = cur === 'USD' ? 1 : fromUSD(1, cur, rates)

  // Persist a small patch immediately (lifecycle actions + link).
  async function apply(patch, { back = false } = {}) {
    setStatus('saving')
    try {
      await updateDoc(doc(db, 'users', id), { ...patch, updatedAt: serverTimestamp() })
      setU(prev => ({ ...prev, ...patch }))
      if (back) { navigate('/portal'); return }
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not save'))
    }
  }

  const saveForm = () => apply({
    account_type: type,
    customer_id: customerId || null,
    base_currency: cur,
    ws_discount_pct: Number(disc) > 0 ? Number(disc) : 100,
    fx_rate: fxRate === '' ? 0 : Number(fxRate) || 0,
    corp_markup_override: override === '' ? 0 : Number(override) || 0,
  })

  async function del() {
    if (!confirm(`Delete the portal login for ${displayName}? This removes their access and settings. Note: their sign-in credential still exists (it can only be fully removed from the Firebase console), but they will have no access until re-approved.`)) return
    setStatus('saving')
    try { await deleteDoc(doc(db, 'users', id)); navigate('/portal') }
    catch (e) { setStatus('Error: ' + (e?.message || 'could not delete')) }
  }

  const roleStatusLabel = isAdmin ? 'Admin'
    : isApproved ? 'Approved customer'
    : isSuspended ? 'Suspended'
    : 'Pending approval'

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to Portal
      </Link>

      {/* Identity */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="text-xl">{displayName}</h1>
          {!isAdmin && <TypeBadge type={type} />}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 uppercase tracking-wide">{roleStatusLabel}</span>
        </div>
        <p className="text-sm text-ink-70 break-all">{u.email || '—'}</p>
        {u.contact_name && <p className="text-sm text-ink-50">{u.contact_name}</p>}
        {linked?.country && <p className="text-sm text-ink-50">{linked.country}</p>}
        <p className="text-[11px] text-ink-40 mt-1 font-mono break-all" title="Account (users doc) ID — matches the User UID in Firebase Console → Authentication for a real login. An orphaned/hand-made duplicate won't match any Auth user.">ID: {u.id}</p>
      </div>

      {/* Linked customer */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Linked customer</h2>
        <p className="text-xs text-ink-60 mb-3">
          Link this login to a customer record so the account shows that customer's name and country.
          Edit the name itself on the <Link to="/customers" className="text-brand-600 hover:underline">Customers</Link> page.
        </p>
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
      </div>

      {/* Category */}
      {!isAdmin && (
        <div className="card p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Account category</h2>
          <p className="text-xs text-ink-60 mb-3">Mark internal test / checking logins so they can be told apart from real customers.</p>
          <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden">
            {[['customer', 'Customer'], ['internal', 'Internal']].map(([v, label]) => (
              <button key={v} onClick={() => setType(v)}
                className={`px-4 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors ${
                  type === v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pricing */}
      {!isAdmin && (
        <div className="card p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Pricing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs text-ink-60">Base currency
              <select className="input py-1.5 mt-1 w-full" value={cur} onChange={e => setCur(e.target.value)}>
                {CUSTOMER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>

            {cur !== 'USD' && (
              <label className="text-xs text-ink-60"
                title={`Fixed rate: how many ${cur} per 1 USD. Locks this customer's prices regardless of daily rates. Leave blank to use the live rate (currently ≈ ${liveRate.toFixed(4)}).`}>
                Fixed {cur}/USD rate
                <input type="number" min="0" step="0.0001" placeholder={liveRate ? liveRate.toFixed(4) : 'live'}
                  className="input py-1.5 mt-1 w-full" value={fxRate} onChange={e => setFxRate(e.target.value)} />
              </label>
            )}

            <label className="text-xs text-ink-60" title="Percentage of the list (ex-factory) price this customer pays. 100 = list price, 130 = +30% markup, 90 = 10% discount.">
              Figurine Gift Catalogue — WS %
              <input type="number" min="1" step="0.5" placeholder="100" className="input py-1.5 mt-1 w-full"
                value={disc} onChange={e => setDisc(e.target.value)} />
            </label>

            <label className="text-xs text-ink-60" title="Sell price = product cost × this markup (e.g. 2.0 = cost doubled).">
              Corp Gift Catalogue — Markup ×
              <input type="number" min="0" step="0.05" placeholder="2.0" className="input py-1.5 mt-1 w-full"
                value={override} onChange={e => setOverride(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {/* Save + status */}
      <div className="flex items-center gap-3 mb-6">
        <button className="btn-primary text-sm" disabled={status === 'saving'} onClick={saveForm}>
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {status && status !== 'saving' && (
          <span className={`text-sm ${status === 'saved' ? 'text-green-600' : 'text-red-600'}`}>
            {status === 'saved' ? 'Saved ✓' : status}
          </span>
        )}
      </div>

      {/* Lifecycle */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Account status</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isPending && (
            <button className="btn-primary text-sm" onClick={() => apply({ status: 'approved' }, { back: true })}>Approve</button>
          )}
          {isApproved && (
            <>
              <button className="btn-secondary text-sm"
                onClick={() => { if (confirm('Suspend this customer? They lose pricing access and move to the Suspended tab. You can restore them anytime.')) apply({ status: 'suspended' }, { back: true }) }}>
                Suspend
              </button>
              <button className="text-sm text-ink-60 hover:text-brand-600"
                onClick={() => { if (confirm('Promote this customer to ADMIN? They get full access to the costing tool.')) apply({ role: 'admin' }, { back: true }) }}>
                Make admin
              </button>
            </>
          )}
          {isSuspended && (
            <button className="btn-secondary text-sm"
              onClick={() => { if (confirm('Restore this customer to active? Their saved currency and pricing settings are kept.')) apply({ status: 'approved' }, { back: true }) }}>
              Restore
            </button>
          )}
          {isAdmin && !isSelf && (
            <button className="text-sm text-ink-60 hover:text-brand-600"
              onClick={() => { if (confirm('Remove admin access? They become a pending customer.')) apply({ role: 'customer', status: 'pending' }, { back: true }) }}>
              Revoke admin
            </button>
          )}
          {isAdmin && isSelf && <span className="text-sm text-ink-50">This is your own admin account.</span>}

          {canDelete ? (
            <button className="text-sm text-ink-60 hover:text-red-600 sm:ml-auto" onClick={del}>Delete account</button>
          ) : (!isSelf && u.role === 'customer' && (
            <span className="text-xs text-ink-40 sm:ml-auto">Suspend before deleting.</span>
          ))}
        </div>
      </div>
    </div>
  )
}
