import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const REGIONS   = ['Hong Kong', 'China', 'International']
const INDUSTRIES = ['Banking & Finance', 'Insurance', 'Retail', 'Property', 'Hospitality', 'Healthcare', 'Education', 'Government', 'NGO / Charity', 'Technology', 'Professional Services', 'Other']

export default function CustomerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    wechat_id: '',
    region: 'Hong Kong',
    industry: '',
    address: '',
    notes: '',
  })
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'customers', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setForm(f => ({ ...f, ...d }))
      }
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'customers', id), { ...form, updatedAt: serverTimestamp() })
        navigate(`/customers/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'customers'), {
          ...form,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Region</label>
              <select className="input" value={form.region} onChange={set('region')}>
                {REGIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Industry</label>
              <select className="input" value={form.industry} onChange={set('industry')}>
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="Office address" />
          </div>
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
            <label className="label">WeChat ID</label>
            <input className="input" value={form.wechat_id} onChange={set('wechat_id')} placeholder="WeChat username" />
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
