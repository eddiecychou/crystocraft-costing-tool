import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const COUNTRIES = [
  // Greater China & HK region first
  'Hong Kong', 'China (Mainland)', 'Macau', 'Taiwan',
  // Southeast Asia
  'Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines', 'Myanmar', 'Cambodia',
  // Northeast Asia
  'Japan', 'South Korea',
  // South Asia
  'India',
  // Middle East
  'United Arab Emirates', 'Saudi Arabia', 'Qatar',
  // Oceania
  'Australia', 'New Zealand',
  // Europe
  'United Kingdom', 'Germany', 'France', 'Netherlands', 'Switzerland', 'Italy', 'Spain',
  // North America
  'United States', 'Canada',
  // Others
  'Other',
]

const TAG_SUGGESTIONS = [
  'Banking', 'Insurance', 'Finance', 'Retail', 'Property', 'Hospitality', 'Hotel',
  'Healthcare', 'Education', 'Government', 'NGO', 'Charity', 'Technology',
  'Professional Services', 'Legal', 'Accounting', 'Consulting', 'Media', 'Luxury',
  'VIP Client', 'Agency', 'Event', 'Corporate', 'SME',
]

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const tagInputRef = useRef(null)

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    whatsapp: '',
    country: 'Hong Kong',
    address: '',
    notes: '',
  })
  const [tags, setTags]         = useState([])
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'customers', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm(f => ({
          ...f,
          company_name:  d.company_name  || '',
          contact_name:  d.contact_name  || '',
          contact_email: d.contact_email || '',
          contact_phone: d.contact_phone || '',
          whatsapp:      d.whatsapp      || '',
          country:       d.country || d.region || 'Hong Kong',
          address:       d.address || '',
          notes:         d.notes   || '',
        }))
        setTags(d.tags || [])
      }
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

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
      const payload = { ...form, tags, updatedAt: serverTimestamp() }
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
          {/* Suggestions */}
          {tagInput && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map(s => (
                <button
                  key={s} type="button"
                  onClick={() => addTag(s)}
                  className="px-2 py-0.5 rounded-full border border-gray-200 text-xs text-gray-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
          {/* Quick-add suggestions when empty */}
          {!tagInput && tags.length === 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TAG_SUGGESTIONS.slice(0, 10).map(s => (
                <button
                  key={s} type="button"
                  onClick={() => addTag(s)}
                  className="px-2 py-0.5 rounded-full border border-gray-200 text-xs text-gray-500 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
                >
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.contact_phone} onChange={set('contact_phone')} />
            </div>
          </div>
          <div>
            <label className="label">WhatsApp Number</label>
            <input className="input" value={form.whatsapp} onChange={set('whatsapp')} placeholder="e.g. +852 9123 4567" />
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
