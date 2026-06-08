import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

function toArray(val) {
  if (Array.isArray(val)) return val.length ? val : ['']
  if (val && typeof val === 'string') return [val]
  return ['']
}

function MultiInput({ label, values, onChange, type = 'text', placeholder }) {
  function update(i, v) { onChange(values.map((x, j) => j === i ? v : x)) }
  function add() { onChange([...values, '']) }
  function remove(i) { onChange(values.filter((_, j) => j !== i)) }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              type={type}
              value={v}
              onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
            />
            {values.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-1.5 text-xs text-brand-600 hover:text-brand-800">+ Add another</button>
    </div>
  )
}

const COUNTRIES = [
  'Argentina', 'Australia', 'Austria',
  'Belgium', 'Brazil', 'Bulgaria',
  'Cambodia', 'Canada', 'China (Mainland)', 'Czech Republic',
  'Denmark',
  'Finland', 'France',
  'Germany',
  'Hong Kong', 'Hungary',
  'India', 'Indonesia', 'Italy',
  'Japan',
  'Kenya',
  'Macau', 'Malaysia', 'Mexico', 'Moldova', 'Morocco', 'Myanmar',
  'Netherlands', 'New Zealand', 'Nigeria', 'Norway',
  'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia',
  'Saudi Arabia', 'Singapore', 'Slovakia', 'South Africa', 'South Korea', 'Spain', 'Sweden', 'Switzerland',
  'Taiwan', 'Thailand',
  'United Arab Emirates', 'United Kingdom', 'United States',
  'Vietnam',
  'Other',
]

const CRM_CATEGORIES = ['Distributor', 'Small B2B', 'Gift / OEM', 'Crystal Fabric']
const CATEGORY_ICON  = { 'Distributor': '🏪', 'Small B2B': '🛒', 'Gift / OEM': '🎁', 'Crystal Fabric': '✨' }
const CHANNELS = ['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp']
const SOURCES  = ['Alibaba', 'Website', 'Email Marketing', 'Referral', 'Trade Show', 'BNI', 'Direct']
const CRM_STATUSES = ['Active', 'Prospect', 'Dormant', 'Inactive']

const TAG_GROUPS = [
  {
    label: 'Industry',
    tags: ['Banking & Finance', 'Insurance', 'Property & Real Estate', 'Retail', 'Hospitality & Hotel', 'F&B', 'Healthcare', 'Education', 'Government & Public Sector', 'NGO & Charity', 'Technology', 'Legal & Professional', 'Media & Entertainment', 'Luxury & Jewellery', 'Theme Park & Attractions'],
  },
  {
    label: 'Client Type',
    tags: ['VIP', 'Agency', 'Event Organiser', 'OEM / White Label', 'Referral', 'BNI'],
  },
  {
    label: 'Order Profile',
    tags: ['High Volume', 'Repeat Buyer', 'Sample Only', 'Custom Design', 'Urgent'],
  },
  {
    label: 'Geography',
    tags: ['Local HK', 'Asia Pacific', 'Europe', 'Middle East', 'Australia / NZ'],
  },
]

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const tagInputRef = useRef(null)

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    whatsapp: '',
    website: '',
    country: 'Hong Kong',
    address: '',
    notes: '',
    // CRM fields
    crm_category: '',
    primary_channel: '',
    source: '',
    crm_status: 'Prospect',
  })
  const [emails, setEmails]           = useState([''])
  const [phones, setPhones]           = useState([''])
  const [whatsapps, setWhatsapps]     = useState([''])
  const [wechats, setWechats]         = useState([''])
  const [tags, setTags]               = useState([])
  const [tagInput, setTagInput]       = useState('')
  const [isPersonalWa, setIsPersonalWa] = useState(false)
  const [isVip, setIsVip]             = useState(false)
  const [loading, setLoading]         = useState(false)
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
          contact_name:    d.contact_name    || '',
          whatsapp:        d.whatsapp        || '',
          website:         d.website         || '',
          country:         d.country || d.region || 'Hong Kong',
          address:         d.address         || '',
          notes:           d.notes           || '',
          crm_category:    d.crm_category    || '',
          primary_channel: d.primary_channel || '',
          source:          d.source          || '',
          crm_status:      d.crm_status      || 'Prospect',
        }))
        setEmails(toArray(d.contact_emails ?? d.contact_email))
        setPhones(toArray(d.contact_phones ?? d.contact_phone))
        setWhatsapps(toArray(d.contact_whatsapps))
        setWechats(toArray(d.contact_wechats))
        setTags(d.tags || [])
        setIsPersonalWa(d.is_personal_wa || false)
        setIsVip(d.is_vip || false)
      }
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  function handleChannelChange(e) {
    const val = e.target.value
    setForm(f => ({ ...f, primary_channel: val }))
    if (val === 'Personal WhatsApp') setIsPersonalWa(true)
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
    try {
      const payload = {
        ...form,
        tags,
        is_personal_wa: isPersonalWa,
        is_vip: isVip,
        contact_emails: emails.filter(Boolean),
        contact_phones: phones.filter(Boolean),
        contact_whatsapps: whatsapps.filter(Boolean),
        contact_wechats: wechats.filter(Boolean),
        contact_email: emails.filter(Boolean)[0] || '',
        contact_phone: phones.filter(Boolean)[0] || '',
        updatedAt: serverTimestamp(),
      }
      if (isEdit) {
        await updateDoc(doc(db, 'customers', id), payload)
        navigate(`/customers/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'customers'), { ...payload, createdAt: serverTimestamp() })
        navigate(`/customers/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-4 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="mb-6">
        <Link to={isEdit ? `/customers/${id}` : '/customers'} className="text-sm text-brand-600 hover:underline">
          ← {isEdit ? 'Customer' : 'Customers'}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Edit Customer' : 'New Customer'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Company */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</p>
          <div>
            <label className="label">Company / Client Name *</label>
            <input className="input" value={form.company_name} onChange={set('company_name')} required placeholder="e.g. Manulife HK" />
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
              <div className="absolute z-20 left-0 right-0 mt-1 border border-gray-200 rounded-lg bg-white shadow-lg max-h-52 overflow-y-auto">
                {COUNTRIES.filter(c => c.toLowerCase().includes(countrySearch.toLowerCase())).map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={() => { set('country')({ target: { value: c } }); setCountryOpen(false) }}
                    className={`w-full text-left text-sm px-3 py-2 hover:bg-gray-50 transition-colors ${form.country === c ? 'text-brand-600 font-medium' : 'text-gray-700'}`}
                  >
                    {form.country === c ? '✓ ' : ''}{c}
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

        {/* Tags */}
        <div className="card p-5 space-y-4">
          <div>
            <label className="label mb-0">Tags</label>
            <p className="text-xs text-gray-400 mt-0.5">Tap to select · tap again to remove</p>
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

          {/* Grouped toggle pills */}
          {TAG_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.tags.map(tag => {
                  const selected = tags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => selected ? removeTag(tag) : addTag(tag)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-brand-50 border-brand-400 text-brand-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {selected ? '✓ ' : ''}{tag}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Custom tag input */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Custom</p>
            <div className="flex gap-2">
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Type a custom tag…"
                className="input text-sm flex-1"
              />
              {tagInput.trim() && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); addTag(tagInput) }}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
                >
                  + Add
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Primary Contact</p>
          <div>
            <label className="label">Contact Name</label>
            <input className="input" value={form.contact_name} onChange={set('contact_name')} placeholder="e.g. Sarah Chan" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MultiInput label="Email" values={emails} onChange={setEmails} type="email" placeholder="e.g. sarah@company.com" />
            <MultiInput label="Phone" values={phones} onChange={setPhones} placeholder="e.g. +852 1234 5678" />
            <MultiInput label="WhatsApp" values={whatsapps} onChange={setWhatsapps} placeholder="e.g. +852 9876 5432" />
            <MultiInput label="WeChat ID" values={wechats} onChange={setWechats} placeholder="e.g. wechat_username" />
          </div>
          <div>
            <label className="label">WhatsApp Number</label>
            <input className="input" value={form.whatsapp} onChange={set('whatsapp')} placeholder="e.g. +852 9123 4567" />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" type="url" value={form.website} onChange={set('website')} placeholder="https://www.example.com" />
          </div>
        </div>

        {/* CRM */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">CRM</p>

          <div>
            <label className="label">Customer Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {CRM_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, crm_category: cat }))}
                  className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors text-left ${
                    form.crm_category === cat
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {CATEGORY_ICON[cat]} {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Primary Channel</label>
              <select className="input" value={form.primary_channel} onChange={handleChannelChange}>
                <option value="">— Select —</option>
                {CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">CRM Status</label>
              <select className="input" value={form.crm_status} onChange={set('crm_status')}>
                <option value="">— Select —</option>
                {CRM_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              <select className="input" value={form.source} onChange={set('source')}>
                <option value="">— Select —</option>
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-brand-600"
                checked={isPersonalWa}
                onChange={e => setIsPersonalWa(e.target.checked)}
              />
              <span>Communicates via <strong>personal WhatsApp</strong> (not WA Business)</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-brand-600"
                checked={isVip}
                onChange={e => setIsVip(e.target.checked)}
              />
              <span>⭐ VIP customer</span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="card p-5">
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} placeholder="Preferences, key occasions, gifting history, special requirements…" />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
