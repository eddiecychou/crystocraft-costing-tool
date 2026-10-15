import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { CATEGORIES, PRODUCT_STATUSES, productStatusOf, normVideos, normBlogLinks } from '../constants'
import { CUSTOMIZER_OPTIONS, engineTypeOf } from '../customizerEngines'
import MarketingCopyEditor from '../components/MarketingCopyEditor'
import VideoUrlsEditor from '../components/VideoUrlsEditor'
import BlogLinksEditor from '../components/BlogLinksEditor'

export default function ProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', product_code: '', category: '', status: 'concept', description: '', marketing_description: '', assembly_notes: '', videos: [], blog_links: [],
    is_new: false, customizer_type: '', active: true,
  })
  const [loading, setLoading]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const [fetching, setFetching] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'products', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        // Fold the legacy 'discontinued' status into 'retired' on load; never
        // written back until the form is saved again (then it's canonical).
        // Seed the customizer engine from the field, folding the legacy
        // `customizable: true` boolean into the crystal_fabric engine.
        setForm(f => ({ ...f, ...d, status: productStatusOf(d.status).value, videos: normVideos(d.videos, d.video_url), blog_links: normBlogLinks(d.blog_links), customizer_type: engineTypeOf(d) }))
      }
      setFetching(false)
    })
  }, [id, isEdit])

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return   // guard a double-click/double-Enter from firing two writes
    setLoading(true)
    setSaveError('')
    try {
      const videos = normVideos(form.videos)
      const blog_links = normBlogLinks(form.blog_links)
      const payload = { ...form, videos, video_url: videos[0] || '', blog_links }
      if (isEdit) {
        await updateDoc(doc(db, 'products', id), { ...payload, updatedAt: serverTimestamp() })
        navigate(`/products/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'products'), {
          ...payload, heroImage: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        navigate(`/products/${ref.id}`)
      }
    } catch (err) {
      // Previously uncaught: a failed write (permission-denied, offline,
      // malformed video URL from normVideos) reset the button to "Save
      // Changes" with nothing on screen to explain why — reported as
      // "the save button doesn't work, no response" (2026-09-11).
      console.error('ProductForm save failed:', err)
      setSaveError(err?.message || 'Could not save — please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl text-ink">{isEdit ? 'Edit Product' : 'New Product'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="label">Product Name *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Crystal Tumbler Set" />
          </div>
          <div>
            <label className="label">Item code</label>
            <input className="input font-mono w-40" value={form.product_code || ''} onChange={set('product_code')}
                   placeholder="e.g. A0231" />
          </div>
        </div>
        <p className="text-2xs text-ink-60 -mt-3">Used to match this product to its WooCommerce listing and the ERP. Leave blank if there isn't one.</p>

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

        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!form.is_new}
                 onChange={e => setForm(f => ({ ...f, is_new: e.target.checked }))} />
          <span className="text-sm text-ink-80">New arrival <span className="text-ink-60 font-normal">— shows a green “New” badge in the shop and floats this product to the top. Untick when it's no longer new.</span></span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={form.active !== false}
                 onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
          <span className="text-sm text-ink-80">Visible in catalogue <span className="text-ink-60 font-normal">— untick to hide this product from catalogues and the shop without deleting it.</span></span>
        </label>

        <div>
          <label className="label">Customiser</label>
          <select className="input max-w-sm" value={form.customizer_type || ''} onChange={set('customizer_type')}>
            {CUSTOMIZER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-2xs text-ink-60 mt-1">
            Lets customers preview this product with their own logo. Pick the customization engine that fits this product.
          </p>
        </div>

        <div>
          <label className="label">Spec Description</label>
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Materials, dimensions, technical specs — used in quotes…" />
        </div>

        <MarketingCopyEditor product={form} value={form.marketing_description || ''}
          onChange={text => setForm(f => ({ ...f, marketing_description: text }))} />

        <div>
          <label className="label">Internal Remarks</label>
          <textarea className="input" rows={2} value={form.assembly_notes} onChange={set('assembly_notes')} placeholder="Supplier details, production notes, and points to confirm…" />
        </div>

        <VideoUrlsEditor videos={form.videos} onChange={v => setForm(f => ({ ...f, videos: v }))} />

        <BlogLinksEditor links={form.blog_links} onChange={v => setForm(f => ({ ...f, blog_links: v }))} />

        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
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
