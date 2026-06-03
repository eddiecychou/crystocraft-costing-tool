import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

export default function SupplierForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', name_cn: '', country: 'China', city: '',
    address: '', phone: '', wechat_id: '', email: '',
    whatsapp: '', contact_person: '', notes: '',
  })
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'suppliers', id)).then(snap => {
      if (snap.exists()) setForm(f => ({ ...f, ...snap.data() }))
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'suppliers', id), { ...form, updatedAt: serverTimestamp() })
        navigate(`/suppliers/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'suppliers'), {
          ...form, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        navigate(`/suppliers/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">← Suppliers</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Edit Supplier' : 'New Supplier'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Supplier Name (English) *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Fei Hong" />
          </div>
          <div>
            <label className="label">Supplier Name (Chinese)</label>
            <input className="input" value={form.name_cn} onChange={set('name_cn')} placeholder="e.g. 浦江晶鸿水晶" />
          </div>
        </div>

        <div>
          <label className="label">Contact Person</label>
          <input className="input" value={form.contact_person} onChange={set('contact_person')} placeholder="e.g. 王總, David Lee" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Country</label>
            <input className="input" value={form.country} onChange={set('country')} placeholder="China" />
          </div>
          <div>
            <label className="label">City / Region</label>
            <input className="input" value={form.city} onChange={set('city')} placeholder="e.g. 浦江, Guangzhou" />
          </div>
        </div>

        <div>
          <label className="label">Address</label>
          <textarea className="input" rows={2} value={form.address} onChange={set('address')} placeholder="Full address…" />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Contact Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={set('phone')} placeholder="+86 xxx xxxx xxxx" />
            </div>
            <div>
              <label className="label">WeChat ID</label>
              <input className="input" value={form.wechat_id} onChange={set('wechat_id')} placeholder="WeChat ID" />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input className="input" value={form.whatsapp} onChange={set('whatsapp')} placeholder="+86 xxx xxxx xxxx" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="supplier@example.com" />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Specialties, payment terms, reliability notes…" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Supplier'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
