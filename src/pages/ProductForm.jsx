import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { CATEGORIES, PRODUCT_STATUSES } from '../constants'

export default function ProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', category: '', status: 'concept', description: '', marketing_description: '', assembly_notes: '',
  })
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError]   = useState('')

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'products', id)).then(snap => {
      if (snap.exists()) setForm(f => ({ ...f, ...snap.data() }))
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleGenerateCopy() {
    if (!form.name) return
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/generate-marketing-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: form }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setForm(f => ({ ...f, marketing_description: data.marketing_description }))
    } catch (err) {
      setAiError(err.message || 'Generation failed — please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'products', id), { ...form, updatedAt: serverTimestamp() })
        navigate(`/products/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'products'), {
          ...form, heroImage: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        navigate(`/products/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Product' : 'New Product'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Product Name *</label>
          <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Crystal Tumbler Set" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Category *</label>
            <select className="input" value={form.category} onChange={set('category')} required>
              <option value="">Select…</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              {PRODUCT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Spec Description</label>
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Materials, dimensions, technical specs — used in quotes…" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Marketing Description</label>
            <button
              type="button"
              onClick={handleGenerateCopy}
              disabled={!form.name || aiLoading}
              className="text-xs px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {aiLoading ? '⏳ Writing…' : '✨ AI Write'}
            </button>
          </div>
          <textarea
            className="input"
            rows={4}
            value={form.marketing_description}
            onChange={set('marketing_description')}
            placeholder="Sell-copy for catalogues — evocative, customer-facing language… or click ✨ AI Write to generate"
          />
          {aiError && <p className="text-xs text-red-500 mt-1">{aiError}</p>}
          {!form.name && <p className="text-xs text-gray-400 mt-1">Enter a product name first to enable AI writing</p>}
        </div>

        <div>
          <label className="label">Assembly Notes</label>
          <textarea className="input" rows={2} value={form.assembly_notes} onChange={set('assembly_notes')} placeholder="Factory assembly instructions, special handling notes…" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
