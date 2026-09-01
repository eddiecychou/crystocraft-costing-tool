import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db, authedUser } from '../firebase'
import { ArrowLeft, AlertCircle, Trash2, Users } from 'lucide-react'
import {
  normalizeContact, saveContact, deleteContact, contactName,
  MC_STATUSES, MC_AUDIENCES, MC_CATEGORIES,
  linkContactToCustomer, unlinkContactFromCustomer,
  updateContactAiSummary, AI_CONTEXT_SUMMARY_MAX_WORDS,
} from '../domain/marketingContact'
import { useCustomers, customerName } from '../domain/customer'
import { CustomerPicker } from './CustomerAccounts'
import { EmailThreads, WhatsAppThreads, AlibabaThreads, InteractionLog } from './MarketingContacts'

// Full-page marketing-contact detail view (V8.10) — replaces the earlier
// EditContactModal overlay. The owner explicitly asked for this to match
// how Customers' second page works: a real page you land on, with the
// fields editable inline and a Save button, not a popup blocking the list
// behind it. Field set, save/delete behaviour, and the three thread viewers
// (Email/WhatsApp/Alibaba) + Interaction Log are carried over unchanged from
// the old modal — see git history for that version if something here needs
// to be cross-checked against it.
export default function MarketingContactDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { customers } = useCustomers()

  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError('')
    getDoc(doc(db, 'marketing_contacts', id))
      .then(snap => {
        if (cancelled) return
        if (!snap.exists()) { setLoadError('This contact no longer exists.'); return }
        setContact(normalizeContact(snap.id, snap.data()))
      })
      .catch(e => !cancelled && setLoadError(e.message || 'Could not load this contact.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [id])

  if (loading) return <div className="p-4 md:p-6 text-sm text-ink-60">Loading…</div>
  if (loadError || !contact) {
    return (
      <div className="p-4 md:p-6">
        <Link to="/marketing" className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Back to Marketing Contacts
        </Link>
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2">
          <AlertCircle size={16} /> {loadError || 'Contact not found.'}
        </div>
      </div>
    )
  }

  return (
    <ContactDetailForm
      contact={contact}
      customers={customers}
      onPatched={(patch) => setContact(prev => ({ ...prev, ...patch }))}
      onDeleted={() => navigate('/marketing')}
    />
  )
}

function ContactDetailForm({ contact, customers, onPatched, onDeleted }) {
  const [f, setF] = useState({
    first_name: contact.first_name, last_name: contact.last_name, email: contact.email,
    company: contact.company, country: contact.country, phone: contact.phone,
    whatsapp: contact.whatsapp || '', wechat: contact.wechat || '',
    status: contact.status, audiences: contact.audiences,
    is_customer: contact.is_customer,
    tags: contact.tags.join(', '), app_notes: contact.app_notes,
    ai_context_summary: contact.ai_context_summary || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Same optimistic-write posture as the old modal — a direct Firestore
  // write, not deferred to the page-wide Save button.
  const [match, setMatch] = useState(contact.possible_customer_match || null)
  const [linkState, setLinkState] = useState(null)   // null | 'saving' | 'saved'
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const toggleAudience = a => setF(s => ({
    ...s, audiences: s.audiences.includes(a) ? s.audiences.filter(x => x !== a) : [...s.audiences, a],
  }))

  async function doLink(customerId) {
    if (!customerId) { doUnlink(); return }
    const c = customers.find(x => x.id === customerId)
    const prev = match
    const newMatch = { customer_id: customerId, company_name: customerName(c) }
    setMatch(newMatch); setF(s => ({ ...s, is_customer: true }))
    onPatched({ possible_customer_match: newMatch, is_customer: true })
    setLinkState('saving'); setError('')
    try {
      await linkContactToCustomer(contact.id, customerId, customerName(c))
      setLinkState('saved'); setTimeout(() => setLinkState(s => s === 'saved' ? null : s), 2000)
    } catch (e) {
      setMatch(prev)
      onPatched({ possible_customer_match: prev })
      setLinkState(null); setError(e.message || 'Could not link this contact.')
    }
  }
  async function doUnlink() {
    const prev = match
    setMatch(null)
    onPatched({ possible_customer_match: null })
    setLinkState('saving'); setError('')
    try {
      await unlinkContactFromCustomer(contact.id)
      setLinkState('saved'); setTimeout(() => setLinkState(s => s === 'saved' ? null : s), 2000)
    } catch (e) {
      setMatch(prev)
      onPatched({ possible_customer_match: prev })
      setLinkState(null); setError(e.message || 'Could not unlink this contact.')
    }
  }

  async function save() {
    setBusy(true); setError(''); setSaved(false)
    try {
      const tags = [...new Set(f.tags.split(/[,|]/).map(t => t.trim().toLowerCase()).filter(Boolean))]
      const newId = await saveContact(contact.id, { ...f, tags })
      if (f.ai_context_summary.trim() !== (contact.ai_context_summary || '').trim()) {
        const user = await authedUser()
        await updateContactAiSummary(newId, f.ai_context_summary, user?.uid)
      }
      onPatched({ ...f, tags, emailable: f.status === 'subscribed' })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  async function del() {
    if (!window.confirm(`Delete ${contact.email} permanently? This cannot be undone.`)) return
    setBusy(true); setError('')
    try { await deleteContact(contact.id); onDeleted() }
    catch (e) { setError(e.message || 'Could not delete.'); setBusy(false) }
  }

  const field = (label, k, type = 'text') => (
    <label className="block">
      <span className="text-xs text-ink-60">{label}</span>
      <input type={type} className="input w-full mt-0.5" value={f[k]} onChange={set(k)} />
    </label>
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <Link to="/marketing" className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1 mb-3">
        <ArrowLeft size={14} /> Back to Marketing Contacts
      </Link>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink flex items-center gap-2">
            <Users size={22} className="text-brand-600" /> {contactName(contact)}
          </h1>
          <p className="text-sm text-ink-60 mt-0.5">Marketing Contact</p>
        </div>
        <button onClick={del} disabled={busy}
          className="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0">
          <Trash2 size={15} /> Delete
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2 mb-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {field('First name', 'first_name')}
          {field('Last name', 'last_name')}
        </div>
        {field('Email', 'email', 'email')}
        <div className="grid grid-cols-2 gap-3">
          {field('Company', 'company')}
          {field('Country', 'country')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field('Phone', 'phone')}
          {field('WhatsApp', 'whatsapp')}
          {field('WeChat', 'wechat')}
        </div>
        <p className="text-[11px] text-ink-60 -mt-2">At least one of email / phone / WhatsApp / WeChat is required to save.</p>
        <label className="block">
          <span className="text-xs text-ink-60">Status</span>
          <select className="input w-full mt-0.5" value={f.status} onChange={set('status')}>
            {MC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="block">
          <span className="text-xs text-ink-60">Audience</span>
          <div className="flex gap-3 mt-1">
            {MC_AUDIENCES.map(a => (
              <label key={a} className="flex items-center gap-1.5 text-sm text-ink-80">
                <input type="checkbox" checked={f.audiences.includes(a)} onChange={() => toggleAudience(a)}
                       className="rounded-none border-warm-grey text-brand-600 focus:ring-brand-500" />
                {a}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-xs text-ink-60">Tags (comma-separated)</span>
          <input className="input w-full mt-0.5" value={f.tags} onChange={set('tags')} placeholder="distributor, exhibition contact" />
          <span className="text-[11px] text-ink-60">Category tags ({MC_CATEGORIES.slice(0, 5).join(', ')}…) show highlighted.</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-70">
          <input type="checkbox" checked={f.is_customer} onChange={set('is_customer')}
                 className="rounded-none border-warm-grey text-brand-600 focus:ring-brand-500" />
          Likely customer
        </label>
        <div className="block border-t border-warm-grey pt-3">
          <span className="text-xs text-ink-60">Linked app customer</span>
          <p className="text-[11px] text-ink-60 mb-1.5">
            {match ? `Currently linked to "${match.company_name}".` : 'Not linked — pick a customer if you know this contact is already in the app.'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <CustomerPicker customers={customers} value={match?.customer_id || ''} onChange={doLink} />
            {linkState === 'saving' && <span className="text-[11px] text-ink-60">Saving…</span>}
            {linkState === 'saved' && <span className="text-[11px] text-green-600">Saved ✓</span>}
            {match && (
              <button type="button" onClick={doUnlink} className="text-[11px] text-ink-60 hover:text-red-600">Unlink</button>
            )}
          </div>
        </div>

        <EmailThreads contactId={contact.id} emailSummary={contact.email_summary}
          onSummaryUpdated={onPatched} />
        <WhatsAppThreads contactId={contact.id} phone={contact.phone} whatsappSummary={contact.whatsapp_summary}
          onSummaryUpdated={onPatched} />
        <AlibabaThreads contactId={contact.id} alibabaSummary={contact.alibaba_summary}
          onSummaryUpdated={onPatched} />
        <InteractionLog contactId={contact.id} />

        <label className="block">
          <span className="text-xs text-ink-60">Notes</span>
          <textarea className="input w-full mt-0.5" rows={2} value={f.app_notes} onChange={set('app_notes')} />
        </label>
        <label className="block">
          <span className="text-xs text-ink-60">
            AI writing preferences (Daily Drafts memory) — max {AI_CONTEXT_SUMMARY_MAX_WORDS} words
          </span>
          <textarea className="input w-full mt-0.5" rows={2} value={f.ai_context_summary} onChange={set('ai_context_summary')}
            placeholder="e.g. Prefers WhatsApp over email. Distributor, price-sensitive, replies slowly." />
          <span className={`text-[11px] ${
            f.ai_context_summary.trim().split(/\s+/).filter(Boolean).length > AI_CONTEXT_SUMMARY_MAX_WORDS ? 'text-red-600' : 'text-ink-60'
          }`}>
            {f.ai_context_summary.trim() ? f.ai_context_summary.trim().split(/\s+/).filter(Boolean).length : 0} / {AI_CONTEXT_SUMMARY_MAX_WORDS} words —
            fed into every Daily Drafts email to this contact.
          </span>
        </label>
        <p className="text-[11px] text-ink-60">
          Status drives emailability automatically (only "subscribed" is emailable). Changing the email moves the record.
        </p>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={busy} className="btn-primary text-sm">{busy ? 'Saving…' : 'Save'}</button>
        {saved && <span className="text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  )
}
