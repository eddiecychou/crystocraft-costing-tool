import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useCustomers, getCustomer, saveCustomer } from '../domain/customer'
import { CUSTOMER_CURRENCIES, useRates, fromUSD } from '../currency'
import { CustomerPicker, TypeBadge } from './CustomerAccounts'
import ContactPicker from '../components/ContactPicker'
import { notifyEmail } from '../notify'
import LoadingBar from '../components/LoadingBar'
import { ArrowLeft } from 'lucide-react'

const fmtDate = ts => {
  const d = ts?.toDate?.() || (ts instanceof Date ? ts : null)
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

// A portal login IS a real email — if it matches one of the linked customer's
// contacts, that's almost certainly the same person, so there's no reason to
// make an admin pick it by hand.
function autoMatchContact(customer, email) {
  if (!customer || !email) return ''
  const hit = (customer.contacts || []).find(c => c.email && c.email.toLowerCase() === email.toLowerCase())
  return hit?.id || ''
}

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
  const [contactId, setContactId] = useState('')
  const [contactsVersion, setContactsVersion] = useState(0)   // bumped to force ContactPicker to re-fetch after quick-add
  const [addingContact, setAddingContact] = useState(false)
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [enquiries, setEnquiries] = useState([])

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
        setContactId(d.contact_id || '')
      }
      setLoading(false)
    })
    // Enquiry activity for this login. Equality-only query (no orderBy) so it
    // needs no composite index; sort newest-first client-side.
    getDocs(query(collection(db, 'enquiries'), where('uid', '==', id)))
      .then(snap => setEnquiries(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      ))
      .catch(() => {})
  }, [id])

  // One-shot auto-match by email for accounts LINKED before contact_id
  // existed, or linked elsewhere without a contact chosen. Only fires once —
  // an admin explicitly clearing the picker afterwards must stay cleared, not
  // get silently reset back by this effect re-running.
  const autoMatchedRef = useRef(false)
  useEffect(() => {
    if (autoMatchedRef.current || !u || contactId || !customerId || !customers.length) return
    const match = autoMatchContact(customers.find(c => c.id === customerId), u.email)
    if (match) { setContactId(match); autoMatchedRef.current = true }
  }, [u, customers, customerId, contactId])

  if (loading) return <LoadingBar />
  if (!u) return <div className="p-6 text-ink-60">Account not found. <Link to="/portal" className="text-brand-600">Back to Portal</Link></div>

  const isSelf   = auth.currentUser?.uid === id
  const isAdmin  = u.role === 'admin'
  const isPending   = u.role === 'customer' && u.status !== 'approved' && u.status !== 'suspended'
  const isApproved  = u.role === 'customer' && u.status === 'approved'
  const isSuspended = u.role === 'customer' && u.status === 'suspended'
  const canDelete = !isSelf   // any account but your own (deliberate, confirmed)

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
    contact_id: contactId || null,
    // Mirrors the linked customer's sensitive flag onto this account (see
    // domain/customer.js's mirrorSensitiveToLinkedAccounts for why — a
    // customer can't read their own customers/ doc to check it themselves).
    // Covers the "link happens after the flag was already set" order; saving
    // the customer record itself covers the reverse order.
    sensitive: linked?.sensitive || false,
    base_currency: cur,
    ws_discount_pct: Number(disc) > 0 ? Number(disc) : 100,
    fx_rate: fxRate === '' ? 0 : Number(fxRate) || 0,
    corp_markup_override: override === '' ? 0 : Number(override) || 0,
  })

  // "The person genuinely isn't in this customer's contacts yet" shortcut —
  // seeds a new contact from the login's own email/name straight from here,
  // instead of leaving the Customer edit page as the only way to add one.
  // Reads the FULL customer first: saveCustomer writes the whole document
  // shape it's given, so sending only { contacts } would blank out every
  // other field (company_name, address, ...) on this customer.
  async function quickAddContact() {
    if (!customerId || !u?.email) return
    setAddingContact(true)
    setStatus('saving')
    try {
      const full = await getCustomer(customerId)
      if (!full) throw new Error('Customer not found')
      const newId = `c_${crypto.randomUUID().slice(0, 8)}`
      const newContact = {
        id: newId, name: u.contact_name || u.company_name || '', title: '',
        email: u.email, phone: '', whatsapp: '', wechat: '', address: '',
        is_primary: (full.contacts || []).length === 0,
      }
      const res = await saveCustomer(customerId, { ...full, contacts: [...(full.contacts || []), newContact] })
      if (!res.ok) throw new Error(res.result.errors?.[0]?.message || 'Could not save contact')
      setContactId(newId)
      setContactsVersion(v => v + 1)   // force ContactPicker to re-fetch the customer it already loaded
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not add contact'))
    } finally {
      setAddingContact(false)
    }
  }

  // Prospect signs up on the portal before any customer record exists for
  // them — this creates one straight from what they gave us at signup
  // (Login.jsx captures company_name/contact_name/email) and links this
  // login to it immediately, same shape as an ordinary new customer.
  async function quickCreateCustomer() {
    if (!u?.company_name?.trim() && !u?.contact_name?.trim()) return
    setCreatingCustomer(true)
    setStatus('saving')
    try {
      const newContact = {
        id: `c_${crypto.randomUUID().slice(0, 8)}`, name: u.contact_name || '', title: '',
        email: u.email || '', phone: '', whatsapp: '', wechat: '', address: '', is_primary: true,
      }
      const res = await saveCustomer(null, {
        company_name: u.company_name?.trim() || u.contact_name?.trim() || u.email || 'New customer',
        country: 'Hong Kong',
        contacts: [newContact],
        crm_status: 'Prospect',
        source: 'Website',
      })
      if (!res.ok) throw new Error(res.result.errors?.[0]?.message || 'Could not create customer')
      setCustomerId(res.id)
      setContactId(newContact.id)
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not create customer'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function del() {
    if (!confirm(`Delete the portal login for ${displayName}${isAdmin ? ' (ADMIN)' : ''}? This removes their portal access and settings. Note: their sign-in credential still exists (it can only be fully removed from the Firebase console), but they will have no access here.`)) return
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

      {/* Activity */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Activity</h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Registered" value={fmtDate(u.createdAt)} />
          <Stat label="Last sign-in" value={fmtDate(u.last_login_at)} />
          <Stat label="Sign-ins" value={u.login_count ?? 0} />
        </div>
        <p className="text-[10px] uppercase tracking-wide text-ink-40 mb-2">Enquiries ({enquiries.length})</p>
        {enquiries.length === 0 ? (
          <p className="text-sm text-ink-50">{isAdmin ? 'No enquiries.' : 'No enquiries yet — a good candidate to follow up with.'}</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {enquiries.slice(0, 8).map(e => (
              <div key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-70">
                  {fmtDate(e.createdAt)} · {e.items?.length || 0} item{(e.items?.length || 0) === 1 ? '' : 's'}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {e.estimated_total != null && <span className="text-ink-90">{e.currency || ''} {Number(e.estimated_total).toLocaleString()}</span>}
                  {e.status && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 uppercase tracking-wide">{e.status}</span>}
                </span>
              </div>
            ))}
            {enquiries.length > 8 && <p className="text-xs text-ink-40 pt-2">…and {enquiries.length - 8} more.</p>}
          </div>
        )}
      </div>

      {/* Linked customer */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Linked customer</h2>
        <p className="text-xs text-ink-60 mb-3">
          Link this login to a customer record so the account shows that customer's name and country.
          Edit the name itself on the <Link to="/customers" className="text-brand-600 hover:underline">Customers</Link> page.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <CustomerPicker customers={customers} value={customerId}
                          onChange={cid => {
                            setCustomerId(cid)
                            setContactId(autoMatchContact(customers.find(c => c.id === cid), u?.email))
                          }} />
          {!customerId && (u.company_name?.trim() || u.contact_name?.trim()) && (
            <button type="button" onClick={quickCreateCustomer} disabled={creatingCustomer}
                    className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50">
              {creatingCustomer ? 'Creating…' : `+ Create new customer from this signup`}
            </button>
          )}
        </div>
        {customerId && (
          <div className="mt-3">
            <ContactPicker key={contactsVersion} customerId={customerId} value={contactId} onChange={setContactId}
                           label="This login is (optional)" />
            {u.email && (
              <button type="button" onClick={quickAddContact} disabled={addingContact}
                      className="mt-1.5 text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50">
                {addingContact ? 'Adding…' : `+ Add "${u.email}" as a new contact on this customer`}
              </button>
            )}
          </div>
        )}
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
            <button className="btn-primary text-sm"
              onClick={() => { notifyEmail('account_approved', { email: u.email, company_name: displayName, contact_name: u.contact_name }); apply({ status: 'approved' }, { back: true }) }}>
              Approve
            </button>
          )}
          {isApproved && (
            <>
              <button className="btn-secondary text-sm"
                onClick={() => { if (confirm('Suspend this customer? They lose pricing access and move to the Suspended tab. You can restore them anytime.')) apply({ status: 'suspended' }, { back: true }) }}>
                Suspend
              </button>
              <button className="text-sm text-red-600 border border-red-200 rounded px-2.5 py-1 hover:bg-red-50"
                onClick={() => {
                  const ans = prompt(`⚠️ Make ${displayName} a FULL ADMIN?\n\nAn admin can see EVERYTHING in the costing tool — costs, margins, suppliers, every customer, and all your trade secrets. Only do this for your own staff.\n\nType  MAKE ADMIN  to confirm.`)
                  if ((ans || '').trim().toUpperCase() === 'MAKE ADMIN') apply({ role: 'admin' }, { back: true })
                }}>
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
            <button className="btn-secondary text-sm"
              onClick={() => { if (confirm('Remove admin access? They revert to a normal (approved) customer — they keep shopping/pricing access but can no longer see any costing data.')) apply({ role: 'customer', status: 'approved' }, { back: true }) }}>
              Revoke admin — back to normal account
            </button>
          )}
          {isAdmin && isSelf && <span className="text-sm text-ink-50">This is your own admin account.</span>}

          {canDelete && (
            <button className="text-sm text-ink-60 hover:text-red-600 sm:ml-auto" onClick={del}>Delete account</button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink-40">{label}</p>
      <p className="text-sm text-ink-90 mt-0.5">{value}</p>
    </div>
  )
}
