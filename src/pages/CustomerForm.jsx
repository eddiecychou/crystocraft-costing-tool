import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Store, ShoppingCart, Gift, Sparkles, ShoppingBag, Check, Star, AlertCircle, AlertTriangle, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { saveCustomer, contactsOf, loadAllTagNames, CRM_STATUSES, CRM_CATEGORIES, CHANNELS, NO_API_CHANNELS, CUSTOMER_SOURCES, CUSTOMER_COUNTRIES, RETAIL_TAG, updateCustomerAiSummary, AI_CONTEXT_SUMMARY_MAX_WORDS } from '../domain/customer'
import { authedUser } from '../firebase'

const blankContact = (isPrimary = false) => ({
  id: null, name: '', title: '', email: '', phone: '',
  whatsapp: '', whatsapp_personal: '', whatsapp_business: '', wechat: '', address: '', is_primary: isPrimary,
})

// Several real, separate people within one company (owner, 2026-08-05) — not
// one contact_name plus a pile of un-attributed emails. Each card is one
// person; exactly one is Primary (the quote/PI default, and what print pages
// fall back to when a document isn't addressed to anyone specific).
function ContactsEditor({ contacts, onChange }) {
  function update(i, field, value) {
    onChange(contacts.map((c, j) => j === i ? { ...c, [field]: value } : c))
  }
  function add() { onChange([...contacts, blankContact(contacts.length === 0)]) }
  function remove(i) {
    const next = contacts.filter((_, j) => j !== i)
    if (next.length && !next.some(c => c.is_primary)) next[0].is_primary = true
    onChange(next)
  }
  function setPrimary(i) { onChange(contacts.map((c, j) => ({ ...c, is_primary: j === i }))) }
  // Display order is just array order — CustomerDetail and ContactPicker both
  // render contacts in the order they're stored, so moving a card here is the
  // whole feature; nothing else needs to change.
  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= contacts.length) return
    const next = [...contacts]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {contacts.map((c, i) => (
        <div key={i} className="rounded-none border border-warm-grey p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-ink-70 cursor-pointer select-none">
              <input type="radio" name="primary-contact" checked={c.is_primary} onChange={() => setPrimary(i)}
                     className="w-3.5 h-3.5 text-brand-600" />
              Primary contact
            </label>
            <div className="flex items-center gap-2">
              {contacts.length > 1 && (
                <div className="flex items-center">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                          className="text-ink-60 hover:text-ink-70 disabled:opacity-30 disabled:hover:text-ink-60" title="Move up">
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === contacts.length - 1}
                          className="text-ink-60 hover:text-ink-70 disabled:opacity-30 disabled:hover:text-ink-60" title="Move down">
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}
              {contacts.length > 1 && (
                <button type="button" onClick={() => remove(i)} className="text-ink-60 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input" value={c.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Name, e.g. Sarah Chan" />
            <input className="input" value={c.title} onChange={e => update(i, 'title', e.target.value)} placeholder="Title (optional)" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input" type="email" value={c.email} onChange={e => update(i, 'email', e.target.value)} placeholder="Email" />
            <input className="input" value={c.phone} onChange={e => update(i, 'phone', e.target.value)} placeholder="Phone" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input" value={c.whatsapp} onChange={e => update(i, 'whatsapp', e.target.value)} placeholder="WhatsApp — unclassified (optional)" />
            <input className="input" value={c.wechat} onChange={e => update(i, 'wechat', e.target.value)} placeholder="WeChat ID (optional)" />
          </div>
          {/* Only fill these in when Personal vs Business is actually known —
              Draft Daily shows a neutral "WhatsApp" action for the field
              above, and only shows labelled Personal/Business actions once
              one of these is set. Leaving both blank is fine and common. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input" value={c.whatsapp_personal} onChange={e => update(i, 'whatsapp_personal', e.target.value)} placeholder="WhatsApp Personal (optional)" />
            <input className="input" value={c.whatsapp_business} onChange={e => update(i, 'whatsapp_business', e.target.value)} placeholder="WhatsApp Business (optional)" />
          </div>
          <input className="input" value={c.address} onChange={e => update(i, 'address', e.target.value)}
                 placeholder="Address override — leave blank to use the company address" />
        </div>
      ))}
      <button type="button" onClick={add} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
        <Plus size={13} /> Add another contact
      </button>
    </div>
  )
}

// Canonical list lives in domain/customer.js (CUSTOMER_COUNTRIES) — this used to
// be a second, independently-maintained copy that had already drifted from the
// one in Customers.jsx (missing Cyprus, Israel, Pakistan, and 30-odd others a
// real customer or contact is actually in).

// Enum vocabularies (CRM_CATEGORIES / CHANNELS / CRM_STATUSES / CUSTOMER_SOURCES)
// are the canonical lists imported from the domain module so the form and the
// validator never drift.
const CATEGORY_ICON  = { 'Distributor': Store, 'Small B2B': ShoppingCart, 'Gift / OEM': Gift, 'Crystal Fabric': Sparkles }

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const tagInputRef = useRef(null)

  const [form, setForm] = useState({
    company_name: '',
    erp_code: '',
    website: '',
    country: 'Hong Kong',
    address: '',
    notes: '',
    ai_context_summary: '',
    // CRM fields
    crm_category: '',
    source: '',
    crm_status: 'Prospect',
  })
  const [channels, setChannels] = useState([])
  const [contacts, setContacts] = useState([blankContact(true)])
  const [tags, setTags]               = useState([])
  const [tagInput, setTagInput]       = useState('')
  const [tagSuggestions, setTagSuggestions] = useState([]) // every tag already in use, most-used first
  const [tagInputFocused, setTagInputFocused] = useState(false)
  const [isPersonalWa, setIsPersonalWa] = useState(false)
  const [isVip, setIsVip]             = useState(false)
  const [isSensitive, setIsSensitive] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [issues, setIssues]           = useState(null)   // validation result on failed save
  const [countrySearch, setCountrySearch] = useState('')
  const [countryOpen, setCountryOpen]     = useState(false)
  const [fetching, setFetching]       = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'customers', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm(f => ({
          ...f,
          company_name:    d.company_name    || '',
          erp_code:        d.erp_code        || '',
          website:         d.website         || '',
          country:         d.country || d.region || 'Hong Kong',
          address:         d.address         || '',
          notes:           d.notes           || '',
          ai_context_summary: d.ai_context_summary || '',
          crm_category:    d.crm_category    || '',
          source:          d.source          || '',
          crm_status:      d.crm_status      || 'Prospect',
        }))
        // Backwards compat: old single primary_channel → array
        setChannels(d.channels?.length ? d.channels : d.primary_channel ? [d.primary_channel] : [])
        // contactsOf() folds any legacy contact_name/contact_email(s)/etc into
        // one synthesized contact for a record saved before contacts[]
        // existed — same logic the read path (normalizeCustomer) uses.
        const existingContacts = contactsOf(d)
        setContacts(existingContacts.length ? existingContacts : [blankContact(true)])
        setTags(d.tags || [])
        setIsPersonalWa(d.is_personal_wa || false)
        setIsVip(d.is_vip || false)
        setIsSensitive(d.sensitive || false)
      }
      setFetching(false)
    })
  }, [id, isEdit])

  // Tag autocomplete source — every tag already in use across customers,
  // most-used first (Mailchimp-style: pick an existing one, or type a new
  // one). Fetched once; the fixed Industry/Client Type/Order Profile/
  // Geography picklist this replaced (owner, 2026-08-12: hard to use, and
  // Geography duplicated the Country field) is gone.
  useEffect(() => { loadAllTagNames().then(setTagSuggestions) }, [])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  // New customer only, one-time nudge: picking Source = Website suggests the
  // Retail Customer tag (the online shop is a reliable retail signal — see
  // domain/customer.js's RETAIL_TAG comment). Just a suggestion via the
  // normal tag toggle, not a locked binding — plenty of real retail
  // customers (e.g. a cash/FPS-invoiced walk-in under a shared trade code)
  // never touch Source = Website at all, and this never removes the tag
  // again if the admin picks a different Source afterwards.
  useEffect(() => {
    if (isEdit || form.source !== 'Website' || tags.includes(RETAIL_TAG)) return
    setTags(t => [...t, RETAIL_TAG])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.source, isEdit])

  // Retail Customer — a tile in the same Customer Type grid, same styling,
  // but NOT mutually exclusive with Distributor/Small B2B/Gift-OEM/Crystal
  // Fabric (owner, 2026-08-12: an existing trade-bucket customer, e.g.
  // shared ERP code C13, can ALSO buy cash/retail sometimes). Backed by the
  // same tags[] as everything else — see RETAIL_TAG in domain/customer.js.
  const isRetail = tags.includes(RETAIL_TAG)
  function toggleRetail() { setTags(t => isRetail ? t.filter(x => x !== RETAIL_TAG) : [...t, RETAIL_TAG]) }

  function toggleChannel(ch) {
    setChannels(prev => {
      const next = prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
      if (ch === 'Personal WhatsApp') setIsPersonalWa(!prev.includes(ch))
      return next
    })
  }

  // Tags
  function addTag(value) {
    const v = value.trim()
    if (v && !tags.includes(v)) setTags(t => [...t, v])
    setTagInput('')
  }
  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
    if (e.key === 'Backspace' && !tagInput) setTags(t => t.slice(0, -1))
  }
  function removeTag(tag) { setTags(t => t.filter(x => x !== tag)) }


  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setIssues(null)
    try {
      // All shaping (canonical fields + denormalized mirrors) and validation lives
      // in saveCustomer — the form just hands over its raw state.
      const input = {
        ...form,
        tags,
        channels,
        is_personal_wa: isPersonalWa,
        is_vip: isVip,
        sensitive: isSensitive,
        // Drop fully-blank cards (e.g. an unused "+ Add another contact" left
        // empty) — saveCustomer/toCustomerDoc re-normalizes whatever's left.
        contacts: contacts.filter(c => c.name || c.email || c.phone || c.whatsapp || c.whatsapp_personal || c.whatsapp_business || c.wechat),
      }
      const res = await saveCustomer(isEdit ? id : null, input)
      if (!res.ok) { setIssues(res.result); return }
      // Draft Memory Layer (V8.9) — separate write from saveCustomer's
      // whitelisted patch (own 120-word validation, own updatedAt/By
      // stamp), same pattern as MarketingContacts.jsx's EditContactModal.
      // Skipped on a brand-new customer with nothing typed, so creating a
      // customer never fires an extra write for an empty field.
      if (form.ai_context_summary.trim() || isEdit) {
        const user = await authedUser()
        await updateCustomerAiSummary(res.id, form.ai_context_summary, user?.uid)
      }
      navigate(`/customers/${res.id}`)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-4 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="mb-6">
        <Link to={isEdit ? `/customers/${id}` : '/customers'} className="text-sm text-brand-600 hover:underline">
          ← {isEdit ? 'Customer' : 'Customers'}
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-1">{isEdit ? 'Edit Customer' : 'New Customer'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Company */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Company</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Company / Client Name *</label>
              <input className="input" value={form.company_name} onChange={set('company_name')} required placeholder="e.g. Manulife HK" />
            </div>
            <div>
              <label className="label">ERP Code <span className="text-ink-60 font-normal">(optional)</span></label>
              <input className="input" value={form.erp_code} onChange={set('erp_code')} placeholder="e.g. C-00123" />
            </div>
          </div>
          <div className="relative">
            <label className="label">Country</label>
            <input
              className="input"
              value={countryOpen ? countrySearch : (form.country || '')}
              placeholder="Search country…"
              onFocus={() => { setCountryOpen(true); setCountrySearch('') }}
              onBlur={() => setTimeout(() => setCountryOpen(false), 150)}
              onChange={e => setCountrySearch(e.target.value)}
            />
            {countryOpen && (
              <div className="absolute z-20 left-0 right-0 mt-1 border border-warm-grey rounded-none bg-white shadow-lg max-h-52 overflow-y-auto">
                {CUSTOMER_COUNTRIES.filter(c => c.toLowerCase().includes(countrySearch.toLowerCase())).map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={() => { set('country')({ target: { value: c } }); setCountryOpen(false) }}
                    className={`w-full text-left text-sm px-3 py-2 hover:bg-ivory transition-colors ${form.country === c ? 'text-brand-600 font-medium' : 'text-ink-80'}`}
                  >
                    {form.country === c && <Check size={13} className="inline align-[-2px] mr-1" />}{c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="Office address" />
          </div>
        </div>

        {/* Tags — free-typed with autocomplete over tags already in use
            elsewhere (Mailchimp-style), not a fixed picklist. Manage/clean
            up the vocabulary that builds up over time from /customers/tags. */}
        <div className="card p-5 space-y-3">
          <div>
            <label className="label mb-0">Tags</label>
            <p className="text-xs text-ink-60 mt-0.5">Pick an existing tag or type a new one.</p>
          </div>

          {/* Selected tags summary */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-600 text-white text-xs font-medium">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-brand-200 leading-none ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onFocus={() => setTagInputFocused(true)}
              onBlur={() => setTimeout(() => setTagInputFocused(false), 150)}
              placeholder="Search or add a tag…"
              className="input text-sm"
            />
            {tagInputFocused && (() => {
              const q = tagInput.trim().toLowerCase()
              const matches = tagSuggestions
                .filter(t => !tags.includes(t) && (!q || t.toLowerCase().includes(q)))
                .slice(0, 8)
              if (!matches.length) return null
              return (
                <div className="absolute z-20 left-0 right-0 mt-1 border border-warm-grey rounded-none bg-white shadow-lg max-h-52 overflow-y-auto">
                  {matches.map(t => (
                    <button
                      key={t}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); addTag(t) }}
                      className="w-full text-left text-sm px-3 py-2 hover:bg-ivory transition-colors text-ink-80"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>

        {/* Contacts */}
        <div className="card p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Contacts</p>
            <p className="text-xs text-ink-60 mt-0.5">
              Separate real people — quotes, orders and the interaction log can each be addressed to a specific one.
            </p>
          </div>
          <ContactsEditor contacts={contacts} onChange={setContacts} />
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" value={form.website} onChange={set('website')} placeholder="https://www.example.com" />
          </div>
        </div>

        {/* CRM */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">CRM</p>

          <div>
            <label className="label">Customer Type *</label>
            <p className="text-xs text-ink-60 mt-0.5">
              Retail Customer isn't exclusive with the others — a trade-bucket customer can also buy retail sometimes.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {CRM_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, crm_category: cat }))}
                  className={`px-3 py-2.5 rounded-none border text-sm font-medium transition-colors text-left ${
                    form.crm_category === cat
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-warm-grey text-ink-70 hover:border-warm-grey hover:bg-ivory'
                  }`}
                >
                  {(() => { const I = CATEGORY_ICON[cat]; return I ? <I size={14} className="inline align-[-2px] mr-1" /> : null })()}{cat}
                </button>
              ))}
              <button
                type="button"
                onClick={toggleRetail}
                className={`px-3 py-2.5 rounded-none border text-sm font-medium transition-colors text-left ${
                  isRetail
                    ? 'border-pink-500 bg-pink-50 text-pink-700'
                    : 'border-warm-grey text-ink-70 hover:border-warm-grey hover:bg-ivory'
                }`}
              >
                <ShoppingBag size={14} className="inline align-[-2px] mr-1" />{RETAIL_TAG}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Channels <span className="text-ink-60 font-normal">(select all that apply)</span></label>
            <p className="text-xs text-ink-60 mt-0.5">
              Channels marked <span className="text-ink-60">manual</span> have no API integration — the app can't see messages on them; interactions are logged by hand.
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              {CHANNELS.map(ch => {
                const selected = channels.includes(ch)
                const manual = NO_API_CHANNELS.includes(ch)
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-ink-70 border-warm-grey hover:border-brand-400'
                    }`}
                  >
                    {selected && <Check size={13} className="inline align-[-2px] mr-1" />}{ch}
                    {manual && <span className={`ml-1 ${selected ? 'text-brand-100' : 'text-ink-60'}`}>· manual</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label">CRM Status</label>
            <select className="input" value={form.crm_status} onChange={set('crm_status')}>
              <option value="">— Select —</option>
              {CRM_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              {/* Retail Customer segment (2026-08-22): a WooCommerce-sourced
                  customer's Source is set by the sync/link action, not typed
                  in here — read-only so an admin edit elsewhere on this form
                  can't accidentally blur which channel this record actually
                  came from. */}
              <select className="input" value={form.source} onChange={set('source')}
                disabled={form.source === 'WooCommerce'}
                title={form.source === 'WooCommerce' ? 'Set by the WooCommerce sync — not manually editable' : undefined}>
                <option value="">— Select —</option>
                {CUSTOMER_SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 text-sm text-ink-80 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded-none border-warm-grey text-brand-600"
                checked={isPersonalWa}
                onChange={e => setIsPersonalWa(e.target.checked)}
              />
              <span>Communicates via <strong>personal WhatsApp</strong> (not WA Business)</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink-80 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded-none border-warm-grey text-brand-600"
                checked={isVip}
                onChange={e => setIsVip(e.target.checked)}
              />
              <span className="inline-flex items-center gap-1"><Star size={14} className="fill-current text-yellow-500" />VIP customer</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink-80 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded-none border-warm-grey text-brand-600"
                checked={isSensitive}
                onChange={e => setIsSensitive(e.target.checked)}
              />
              <span>
                <strong>Sensitive</strong> — never show storefront photos tagged "Branded for" another customer
              </span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="card p-5">
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} placeholder="Preferences, key occasions, gifting history, special requirements…" />
        </div>

        {/* AI writing preferences (Draft Memory Layer, V8.9) */}
        <div className="card p-5">
          <label className="label">
            AI writing preferences (Daily Drafts memory) — max {AI_CONTEXT_SUMMARY_MAX_WORDS} words
          </label>
          <textarea className="input" rows={2} value={form.ai_context_summary} onChange={set('ai_context_summary')}
            placeholder="e.g. Prefers WhatsApp over email. Distributor, price-sensitive, replies slowly." />
          <span className={`text-2xs ${
            form.ai_context_summary.trim().split(/\s+/).filter(Boolean).length > AI_CONTEXT_SUMMARY_MAX_WORDS ? 'text-red-600' : 'text-ink-60'
          }`}>
            {form.ai_context_summary.trim() ? form.ai_context_summary.trim().split(/\s+/).filter(Boolean).length : 0} / {AI_CONTEXT_SUMMARY_MAX_WORDS} words —
            fed into every Daily Drafts email to this customer.
          </span>
        </div>

        {issues && (issues.errors.length > 0 || issues.warnings.length > 0) && (
          <div className="card p-4 border border-red-200 bg-red-50/50 space-y-1.5">
            {issues.errors.map((it, i) => (
              <p key={`e${i}`} className="text-sm text-red-700 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" /> {it.message}
              </p>
            ))}
            {issues.warnings.map((it, i) => (
              <p key={`w${i}`} className="text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {it.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
