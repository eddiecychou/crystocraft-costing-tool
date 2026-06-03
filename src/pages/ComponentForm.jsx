import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, serverTimestamp, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'

export default function ComponentForm() {
  const { productId, componentId } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(componentId)

  const [form, setForm] = useState({ name: '', spec: '', unit: 'pcs', notes: '' })
  const [sortOrder, setSortOrder] = useState(0)
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [productName, setProductName] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'products', productId)).then(s => setProductName(s.data()?.name || ''))
    if (!isEdit) {
      getDocs(query(collection(db, 'products', productId, 'components'), orderBy('sort_order', 'desc')))
        .then(snap => setSortOrder(snap.empty ? 0 : (snap.docs[0].data().sort_order ?? 0) + 1))
      return
    }
    getDoc(doc(db, 'products', productId, 'components', componentId)).then(snap => {
      if (snap.exists()) setForm(f => ({ ...f, ...snap.data() }))
      setFetching(false)
    })
  }, [productId, componentId, isEdit])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'products', productId, 'components', componentId), form)
        navigate(`/products/${productId}/components/${componentId}`)
      } else {
        const ref = await addDoc(collection(db, 'products', productId, 'components'), {
          ...form, sort_order: sortOrder, createdAt: serverTimestamp(),
        })
        navigate(`/products/${productId}/components/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-6 max-w-xl">
      <div className="mb-6">
        <Link to={`/products/${productId}`} className="text-sm text-brand-600 hover:underline">← {productName}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{isEdit ? 'Edit Component' : 'New Component'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Component Name *</label>
          <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Crystal Body, NFC Card, Packaging Box" />
        </div>

        <div>
          <label className="label">Specification</label>
          <textarea className="input" rows={3} value={form.spec} onChange={set('spec')} placeholder="Material, size, finish, colour, weight…" />
        </div>

        <div>
          <label className="label">Unit</label>
          <select className="input" value={form.unit} onChange={set('unit')}>
            {['pcs', 'set', 'kg', 'g', 'm', 'box'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Any additional notes…" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Component'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
