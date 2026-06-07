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
  'Hong Kong', 'China (Mainland)', 'Macau', 'Taiwan',
  'Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines', 'Myanmar', 'Cambodia',
  'Japan', 'South Korea',
  'India',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar',
  'Australia', 'New Zealand',
  'United Kingdom', 'Germany', 'France', 'Netherlands', 'Switzerland', 'Italy', 'Spain',
  'Belgium', 'Poland', 'Czech Republic', 'Austria', 'Sweden', 'Denmark', 'Norway', 'Finland',
  'Portugal', 'Romania', 'Hungary', 'Slovakia',
  'South Africa', 'Nigeria', 'Kenya',
  'United States', 'Canada', 'Mexico',
  'Brazil', 'Argentina',
  'Other',
]

const CRM_CATEGORIES = ['Distributor', 'Small B2B', 'Gift / OEM', 'Crystal Fabric']
const CATEGORY_ICON  = { 'Distributor': '🏪', 'Small B2B': '🛒', 'Gift / OEM': '🎁', 'Crystal Fabric': '✨' }
const CHANNELS = ['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp']
const SOURCES  = ['Alibaba', 'Website', 'Email Marketing', 'Referral', 'Trade Show', 'BNI', 'Direct']
const CRM_STATUSES = ['Active', 'Prospect', 'Dormant', 'Inactive']

const TAG_SUGGESTIONS = [
  'Banking', 'Insurance', 'Finance', 'Retail', 'Property', 'Hospitality', 'Hotel',
  'Healthcare', 'Education', 'Government', 'NGO', 'Charity', 'Technology',
  'Professional Services', 'Legal', 'Accounting', 'Consulting', 'Media', 'Luxury',
  'VIP Client', 'Agency', 'Event', 'Corporate', 'SME',
  'Distributor', 'OEM', 'Alibaba', 'Theme Park', 'Disney',
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
    segment: '',
    crm_status: 'Prospect',
    folder_path: '',
  })
  const [emails, setEmails]           = useState([''])
  const [phones, setPhones]           = useState([''])
  const [tags, setTags]               = useState([])
  const [tagInput, setTagInput]       = useState('')
  const [isPersonalWa, setIsPersonalWa] = useState(false)
  const [isVip, setIsVip]             = useState(false)
  const [loading, setLoading]         = useState(false)
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
          segment:         d.segment         || '',
          crm_status:      d.crm_status      || 'Prospect',
          folder_path:     d.folder_path     || '',
        }))
        setEmails(toArray(d.contact_emails ?? d.contact_email))
        setPhones(toArray(d.contact_phones ?? d.contact_phone))
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

  const suggestions = TAG_SUGGESTIONS.filter(s =>
    !tags.includes(s) && s.toLowerCase().includes(tagInput.toLowerCase())
  ).slice(0, 8)

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
          <div>
            <label className="label">Country</label>
            <select className="input" value={form.country} onChange={set('country')}>
              {COUNTRIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="Office address" />
          </div>
        </div>

        {/* Tags */}
        <div className="card p-5">
          <label className="label">Tags</label>
          <div
            className="input flex flex-wrap gap-1.5 min-h-[42px] cursor-text"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
                {tag}
                <button type="button" onClick={() => removeTag(tag)} className="hover:text-brand-900 leading-none">×</button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => { if (tagInput.trim()) addTag(tagInput) }}
              placeholder={tags.length === 0 ? 'Type a tag and press Enter…' : ''}
              className="outline-none text-sm flex-1 min-w-24 bg-transparent"
            />
          </div>
          {tagInput && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map(s => (
                <button key={s} type="button" onClick={() => addTag(s)}
                  className="px-2 py-0.5 rounded-full border border-gray-200 text-xs text-gray-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors">
                  + {s}
                </button>
              ))}
            </div>
          )}
          {!tagInput && tags.length === 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TAG_SUGGESTIONS.slice(0, 10).map(s => (
                <button key={s} type="button" onClick={() => addTag(s)}
                  className="px-2 py-0.5 rounded-full border border-gray-200 text-xs text-gray-500 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
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
            <div>
              <label className="label">Segment</label>
              <input className="input" value={form.segment} onChange={set('segment')} placeholder="e.g. Distributor — Poland (VIP)" />
            </div>
          </div>

          <div>
            <label className="label">Folder Path</label>
            <input className="input" value={form.folder_path} onChange={set('folder_path')} placeholder="e.g. Europe/Widdop" />
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
