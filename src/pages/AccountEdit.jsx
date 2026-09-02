import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp, collection, getDocs, query, where, addDoc } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useCustomers, getCustomer, saveCustomer, CUSTOMER_COUNTRIES, CRM_CATEGORIES, CUSTOMER_SOURCES } from '../domain/customer'
import { CUSTOMER_CURRENCIES, useRates, fromUSD } from '../currency'
import { CustomerPicker, TypeBadge } from './CustomerAccounts'
import ContactPicker from '../components/ContactPicker'
import { notifyEmail } from '../notify'
import { approveInvitation, deleteAccount } from '../portalInviteApi'
import LoadingBar from '../components/LoadingBar'
import { MODULE_GROUPS, resolveModules } from '../access'
import { ArrowLeft } from 'lucide-react'

const sameSet = (a = [], b = []) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

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
  const [showCreatePanel, setShowCreatePanel] = useState(false)
  const [newCountry, setNewCountry] = useState('Hong Kong')
  const [newType, setNewType] = useState(CRM_CATEGORIES[0])
  const [newSource, setNewSource] = useState('Website')
  const [enquiries, setEnquiries] = useState([])
  const [mods, setMods] = useState([])   // staff module checklist, editable

  useEffect(() => {
    getDoc(doc(db, 'users', id)).then(s => {
      if (s.exists()) {
        const d = { id: s.id, ...s.data() }
        setU(d)
        setMods(Array.isArray(d.modules) ? d.modules : resolveModules(d))
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
  const isStaffRole = u.role === 'staff'
  const isLegacyStaff = u.role === 'production' || u.role === 'sales'   // pre-V8.14, not yet migrated
  const isStaff  = isAdmin || isStaffRole || isLegacyStaff   // any internal login
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
    const before = u   // captured before the write, for the audit diff
    try {
      await updateDoc(doc(db, 'users', id), { ...patch, updatedAt: serverTimestamp() })
      // Audit every role / status / account_type transition. L-01 (admin
      // silently demoted to `pending`, TWICE) is exactly what this trail
      // exists to catch. Best-effort and non-blocking — a failed audit
      // write must never fail the account change itself.
      const changed = ['role', 'status', 'account_type', 'modules', 'ui_lang'].filter(k => {
        if (!(k in patch)) return false
        if (k === 'modules') return !sameSet(patch[k] || [], before?.modules || [])
        return patch[k] !== before?.[k]
      })
      if (changed.length) {
        addDoc(collection(db, 'audit_logs'), {
          kind: 'account',
          target_uid: id,
          target_email: before?.email || '',
          changes: changed.map(k => ({ field: k, from: before?.[k] ?? null, to: patch[k] ?? null })),
          actor_uid: auth.currentUser?.uid || null,
          actor_email: auth.currentUser?.email || null,
          at: serverTimestamp(),
        }).catch(() => {})
      }
      setU(prev => ({ ...prev, ...patch }))
      if (back) { navigate('/portal'); return }
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not save'))
    }
  }

  // Role change (V8.14). `staff` carries a `modules[]` list — seed it from the
  // checklist below (or the legacy shim, if converting an old production/sales
  // account). admin/customer clear it.
  function changeRole(next) {
    if (next === u.role) return
    if (next === 'admin') {
      const ans = prompt(`⚠️ Make ${displayName} a FULL ADMIN?\n\nAn admin sees EVERYTHING — costs, margins, every customer, all trade secrets. Only for your own trusted staff.\n\nType  MAKE ADMIN  to confirm.`)
      if ((ans || '').trim().toUpperCase() !== 'MAKE ADMIN') return
      apply({ role: 'admin', modules: [] }, { back: true })
    } else if (next === 'staff') {
      const seed = mods.length ? mods : (resolveModules({ role: u.role }).length ? resolveModules({ role: u.role }) : ['dashboard'])
      if (!confirm(`Make ${displayName} STAFF?\n\nThey get an operation-center login limited to the modules you tick below. Tick nothing sensitive by mistake — ⚠ items reveal costs, margins or trade data.`)) return
      setMods(seed)
      apply({ role: 'staff', status: 'approved', modules: seed })
    } else { // customer
      if (!confirm(`Revert ${displayName} to a normal customer? They lose all operation-center access — Storefront only.`)) return
      apply({ role: 'customer', status: 'approved', modules: [] }, { back: true })
    }
  }
  const toggleMod = (key) =>
    setMods(m => m.includes(key) ? m.filter(x => x !== key) : [...m, key])

  // SU-07A (2026-08-19 fix): an account created via the invitation/self-apply
  // flow (u.invitation_id set) has NO password on its Auth record at all —
  // approving it the OLD way (just flip status + send the old generic
  // "account_approved" sign-in-link email) leaves the customer with an
  // account they structurally cannot sign into, and no way to set a
  // password. Found live: eddiecychou@icloud.com was approved through this
  // exact button, got the old email, and "Sign in" just went back to the
  // login form with nothing to enter. Now routes through the same secure
  // portal-invite Node function PortalInvitations.jsx uses — requires a
  // customer link first (same requirement that page enforces), then sends
  // a REAL generatePasswordResetLink email instead of the old one.
  async function handleApprove() {
    if (u.invitation_id) {
      // Fall back to the persisted customer_id too — covers picking a
      // customer, clicking "Save changes" first, then Approve (customerId
      // local state and u.customer_id should usually agree by then, but
      // this avoids a false rejection if they don't for any reason).
      const linkCustomerId = customerId || u.customer_id
      // Internal (staff/test) accounts skip the customer-link requirement —
      // approveInvitation's own server-side check reads account_type
      // straight off the Firestore doc (never trusts a client claim), so
      // persist the toggle first in case it was just flipped and not yet
      // saved — otherwise the server would still see the old value and
      // reject exactly like a real customer account would.
      if (type === 'internal') await apply({ account_type: type })
      if (!linkCustomerId && type !== 'internal') {
        setStatus('Error: link this account to a customer (above) before approving — an invitation-based account needs one to be approved.')
        return
      }
      setStatus('saving')
      try {
        await approveInvitation(u.invitation_id, linkCustomerId)
        navigate('/portal')
      } catch (e) {
        setStatus('Error: ' + (e?.message || 'could not approve'))
      }
      return
    }
    notifyEmail('account_approved', { uid: id })
    apply({ status: 'approved' }, { back: true })
  }

  const saveForm = () => apply({
    account_type: type,
    customer_id: customerId || null,
    contact_id: contactId || null,
    // Mirrors the linked customer's sensitive flag + erp_code onto this
    // account (see domain/customer.js's mirrorToLinkedAccounts for why — a
    // customer can't read their own customers/ doc to check it themselves).
    // Covers the "link happens after the flag/code was already set" order;
    // saving the customer record itself covers the reverse order.
    sensitive: linked?.sensitive || false,
    erp_code: linked?.erp_code || '',
    erp_code_shared: linked?.erp_code_shared || false,
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
        country: newCountry,
        contacts: [newContact],
        crm_status: 'Prospect',
        crm_category: newType,
        source: newSource,
      })
      if (!res.ok) throw new Error(res.result.errors?.[0]?.message || 'Could not create customer')
      setCustomerId(res.id)
      setContactId(newContact.id)
      setShowCreatePanel(false)
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? null : s)), 2500)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'could not create customer'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function del() {
    // Deleting a fellow admin's login is what silently locked Eddie out of
    // his own account (2026-08-10) — the click-through confirm() gave no real
    // friction. canDelete already blocks deleting your OWN account; this adds
    // a typed confirmation on top, same pattern as "Make admin" above, for
    // the one case that guard doesn't cover: deleting SOMEONE ELSE'S admin login.
    //
    // Deletes the Firebase Auth user too, not just this Firestore doc — the
    // old deleteDoc-only version left the sign-in credential behind forever
    // (the client SDK has no way to reach Auth for another user at all),
    // which meant re-registering the same email later kept hitting
    // already_registered against a login that no longer had any doc or
    // portal presence. See portal-invite.js's deleteAccount.
    if (isStaff) {
      const ans = prompt(`⚠️ Delete the STAFF login for ${displayName}?\n\nThis removes their access to the operation center, AND deletes their sign-in credential entirely — they would need a brand-new invitation to come back.\n\nType the account's email (${u.email}) to confirm.`)
      if ((ans || '').trim().toLowerCase() !== (u.email || '').trim().toLowerCase()) return
    } else if (!confirm(`Delete the portal login for ${displayName}? This removes their portal access and settings, AND deletes their sign-in credential entirely — the email becomes free to register again from scratch.`)) {
      return
    }
    setStatus('saving')
    try { await deleteAccount(id); navigate('/portal') }
    catch (e) { setStatus('Error: ' + (e?.message || 'could not delete')) }
  }

  const roleStatusLabel = isAdmin ? 'Admin'
    : isStaffRole ? `Staff · ${(u.modules || []).length} module${(u.modules || []).length === 1 ? '' : 's'}`
    : isLegacyStaff ? `${u.role} (legacy)`
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
          {!isStaff && <TypeBadge type={type} />}
          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 uppercase tracking-wide">{roleStatusLabel}</span>
        </div>
        <p className="text-sm text-ink-70 break-all">{u.email || '—'}</p>
        {u.contact_name && <p className="text-sm text-ink-60">{u.contact_name}</p>}
        {linked?.country && <p className="text-sm text-ink-60">{linked.country}</p>}
        <p className="text-2xs text-ink-60 mt-1 font-mono break-all" title="Account (users doc) ID — matches the User UID in Firebase Console → Authentication for a real login. An orphaned/hand-made duplicate won't match any Auth user.">ID: {u.id}</p>
      </div>

      {/* Activity */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm text-ink-80 mb-3">Activity</h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Registered" value={fmtDate(u.createdAt)} />
          <Stat label="Last sign-in" value={fmtDate(u.last_login_at)} />
          <Stat label="Sign-ins" value={u.login_count ?? 0} />
        </div>
        <p className="text-2xs uppercase tracking-wide text-ink-60 mb-2">Enquiries ({enquiries.length})</p>
        {enquiries.length === 0 ? (
          <p className="text-sm text-ink-60">{isAdmin ? 'No enquiries.' : 'No enquiries yet — a good candidate to follow up with.'}</p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {enquiries.slice(0, 8).map(e => (
              <div key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-70">
                  {fmtDate(e.createdAt)} · {e.items?.length || 0} item{(e.items?.length || 0) === 1 ? '' : 's'}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {e.estimated_total != null && <span className="text-ink">{e.currency || ''} {Number(e.estimated_total).toLocaleString()}</span>}
                  {e.status && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 uppercase tracking-wide">{e.status}</span>}
                </span>
              </div>
            ))}
            {enquiries.length > 8 && <p className="text-xs text-ink-60 pt-2">…and {enquiries.length - 8} more.</p>}
          </div>
        )}
      </div>

      {/* Linked customer */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm text-ink-80 mb-1">Linked customer</h2>
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
          {!customerId && !showCreatePanel && (u.company_name?.trim() || u.contact_name?.trim()) && (
            <button type="button" onClick={() => setShowCreatePanel(true)}
                    className="text-xs text-brand-600 hover:text-brand-800">
              + Create new customer from this signup
            </button>
          )}
        </div>
        {!customerId && showCreatePanel && (
          <div className="mt-3 p-3 rounded-none bg-ivory-light border border-ivory-dark space-y-2.5">
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-2xs uppercase tracking-wide text-ink-60">Country</span>
                <select className="input text-xs" value={newCountry} onChange={e => setNewCountry(e.target.value)}>
                  {CUSTOMER_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-2xs uppercase tracking-wide text-ink-60">Customer type</span>
                <select className="input text-xs" value={newType} onChange={e => setNewType(e.target.value)}>
                  {CRM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-2xs uppercase tracking-wide text-ink-60">Source</span>
                <select className="input text-xs" value={newSource} onChange={e => setNewSource(e.target.value)}>
                  {CUSTOMER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={quickCreateCustomer} disabled={creatingCustomer}
                      className="text-xs btn-primary py-1 px-3 disabled:opacity-50">
                {creatingCustomer ? 'Creating…' : 'Create customer'}
              </button>
              <button type="button" onClick={() => setShowCreatePanel(false)} disabled={creatingCustomer}
                      className="text-xs text-ink-60 hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        )}
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
          <h2 className="text-sm text-ink-80 mb-1">Account category</h2>
          <p className="text-xs text-ink-60 mb-3">Mark internal test / checking logins so they can be told apart from real customers.</p>
          <div className="inline-flex rounded-none border border-ivory-dark overflow-hidden">
            {[['customer', 'Customer'], ['internal', 'Internal']].map(([v, label]) => (
              <button key={v} onClick={() => setType(v)}
                className={`px-4 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors ${
 type === v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory-dark'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pricing */}
      {!isAdmin && (
        <div className="card p-5 mb-5">
          <h2 className="text-sm text-ink-80 mb-3">Pricing</h2>
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
        <h2 className="text-sm text-ink-80 mb-3">Account status</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isPending && (
            <button className="btn-primary text-sm" onClick={handleApprove}>
              {u.invitation_id ? 'Approve & send setup email' : 'Approve'}
            </button>
          )}
          {isApproved && (
            <button className="btn-secondary text-sm"
              onClick={() => { if (confirm('Suspend this customer? They lose pricing access and move to the Suspended tab. You can restore them anytime.')) apply({ status: 'suspended' }, { back: true }) }}>
              Suspend
            </button>
          )}
          {isSuspended && (
            <button className="btn-secondary text-sm"
              onClick={() => { if (confirm('Restore this customer to active? Their saved currency and pricing settings are kept.')) apply({ status: 'approved' }, { back: true }) }}>
              Restore
            </button>
          )}
          {isStaff && isSelf && <span className="text-sm text-ink-60">This is your own {isAdmin ? 'admin' : 'staff'} account.</span>}
          {canDelete && (
            <button className="text-sm text-ink-60 hover:text-red-600 sm:ml-auto" onClick={del}>Delete account</button>
          )}
        </div>
      </div>

      {/* Role & access (V8.14) */}
      {!isSelf && (isApproved || isSuspended || isStaff) && (
        <div className="card p-5 mt-4">
          <h2 className="text-sm text-ink-80 mb-3">Role &amp; access</h2>
          {isLegacyStaff && (
            <p className="text-xs text-amber-700 mb-3">
              This is a legacy <strong>{u.role}</strong> account. It still works via a fallback; switch it to
              <strong> Staff</strong> and confirm its module ticks to finish the migration.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { r: 'customer', label: 'Customer — storefront only' },
              { r: 'staff', label: 'Staff — pick modules below' },
              { r: 'admin', label: 'Admin — everything' },
            ].map(({ r, label }) => (
              <button key={r} onClick={() => changeRole(r)}
                className={`text-sm px-3 py-1.5 rounded-none border transition-colors ${
                  u.role === r ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-warm-grey text-ink-70 hover:border-ink-60'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {u.role === 'staff' && (
            <div className="border border-warm-grey p-3">
              <p className="text-2xs uppercase tracking-wide text-ink-60 mb-2">What this staff account can open</p>
              {MODULE_GROUPS.map(g => (
                <div key={g.group} className="mb-2.5">
                  <p className="text-2xs font-semibold text-ink-70 mb-1">{g.group}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {g.keys.map(k => (
                      <label key={k.key} className="text-xs inline-flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" className="w-3.5 h-3.5 rounded-sm border-warm-grey text-brand-600"
                          checked={mods.includes(k.key)} onChange={() => toggleMod(k.key)} />
                        <span className={k.sensitive ? 'text-amber-700' : 'text-ink-70'}>
                          {k.label}{k.sensitive ? ' ⚠' : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-2xs text-ink-60 mt-2">⚠ = reveals costs, margins or trade data — grant deliberately.</p>
              <div className="flex items-center gap-2 mt-3">
                <button className="btn-primary text-xs py-1 px-3" disabled={status === 'saving' || sameSet(mods, u.modules || [])}
                  onClick={() => apply({ modules: mods })}>
                  Save access
                </button>
                <span className={`text-2xs ${sameSet(mods, u.modules || []) ? 'text-ink-60' : 'text-amber-600'}`}>
                  {sameSet(mods, u.modules || []) ? 'no unsaved changes' : 'unsaved'}
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-warm-grey">
                <p className="text-2xs uppercase tracking-wide text-ink-60 mb-1.5">Interface language</p>
                <p className="text-2xs text-ink-60 mb-2">
                  Simplified Chinese covers the supply &amp; inventory pages (Components, Suppliers,
                  Purchase Orders, Inventory, Production dashboard). The rest of the app stays English.
                </p>
                <select
                  className="input text-xs w-auto"
                  value={u.ui_lang === 'zh-Hans' ? 'zh-Hans' : 'en'}
                  onChange={(e) => apply({ ui_lang: e.target.value })}
                  disabled={status === 'saving'}
                >
                  <option value="en">English</option>
                  <option value="zh-Hans">简体中文 (Simplified Chinese)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wide text-ink-60">{label}</p>
      <p className="text-sm text-ink mt-0.5">{value}</p>
    </div>
  )
}
