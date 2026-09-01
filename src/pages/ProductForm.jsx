import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db, authHeader } from '../firebase'
import { CATEGORIES, PRODUCT_STATUSES, productStatusOf, normVideos, MARKETING_DESC_MAXLEN } from '../constants'
import { CUSTOMIZER_OPTIONS, engineTypeOf } from '../customizerEngines'
import { Sparkles, RotateCcw } from 'lucide-react'
import VideoUrlsEditor from '../components/VideoUrlsEditor'

export default function ProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState({
    name: '', category: '', status: 'concept', description: '', marketing_description: '', assembly_notes: '', videos: [],
    is_new: false, customizer_type: '', active: true,
  })
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiError, setAiError]         = useState('')
  const [aiGuide, setAiGuide]         = useState('')
  const [guideOpen, setGuideOpen]     = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteGuide, setRewriteGuide] = useState('')
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [rewriteError, setRewriteError]     = useState('')

  useEffect(() => {
    if (!isEdit) return
    getDoc(doc(db, 'products', id)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        // Fold the legacy 'discontinued' status into 'retired' on load; never
        // written back until the form is saved again (then it's canonical).
        // Seed the customizer engine from the field, folding the legacy
        // `customizable: true` boolean into the crystal_fabric engine.
        setForm(f => ({ ...f, ...d, status: productStatusOf(d.status).value, videos: normVideos(d.videos, d.video_url), customizer_type: engineTypeOf(d) }))
      }
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
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ product: form, instructions: aiGuide.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const desc = (data.marketing_description || '').slice(0, MARKETING_DESC_MAXLEN)
      setForm(f => ({ ...f, marketing_description: desc }))
    } catch (err) {
      setAiError(err.message || 'Generation failed — please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleRewrite() {
    if (!rewriteGuide.trim()) return
    setRewriteLoading(true); setRewriteError('')
    try {
      const res = await fetch('/api/rewrite-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          section_type: 'marketing_description',
          body: form.marketing_description,
          guidance: rewriteGuide,
          context: `Product: ${form.name}\nCategory: ${form.category}\nSpec: ${form.description}`,
          max_chars: MARKETING_DESC_MAXLEN,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Slice as a safety net — same as handleGenerateCopy. The textarea's
      // maxLength only limits typing, not a programmatic set, so an AI
      // response over budget would otherwise show e.g. "392/300".
      setForm(f => ({ ...f, marketing_description: (data.body || '').slice(0, MARKETING_DESC_MAXLEN) }))
      setRewriteOpen(false); setRewriteGuide('')
    } catch (err) {
      setRewriteError(err.message || 'Rewrite failed — please try again.')
    } finally {
      setRewriteLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    const videos = normVideos(form.videos)
    const payload = { ...form, videos, video_url: videos[0] || '' }
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'products', id), { ...payload, updatedAt: serverTimestamp() })
        navigate(`/products/${id}`)
      } else {
        const ref = await addDoc(collection(db, 'products'), {
          ...payload, heroImage: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        navigate(`/products/${ref.id}`)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{isEdit ? 'Edit Product' : 'New Product'}</h1>
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
          <p className="text-[11px] text-ink-60 mt-1">
            Lets customers preview this product with their own logo. Pick the customization engine that fits this product.
          </p>
        </div>

        <div>
          <label className="label">Spec Description</label>
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Materials, dimensions, technical specs — used in quotes…" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Marketing Description</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGuideOpen(o => !o)}
                className="text-xs text-ink-60 hover:text-brand-600 transition-colors"
              >
                {guideOpen ? 'Hide instructions' : '+ Instructions'}
              </button>
              <button
                type="button"
                onClick={handleGenerateCopy}
                disabled={!form.name || aiLoading}
                className="text-xs px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {aiLoading ? 'Writing…' : <span className="inline-flex items-center gap-1"><Sparkles size={13} />AI Write</span>}
              </button>
            </div>
          </div>
          {guideOpen && (
            <div className="mb-2">
              <textarea
                className="input text-sm"
                rows={2}
                placeholder="Optional: tell the AI what to emphasise — e.g. target luxury hotels, mention the gift-box packaging, keep it under 60 words…"
                value={aiGuide}
                onChange={e => setAiGuide(e.target.value)}
              />
              <p className="text-xs text-ink-60 mt-1">
                {form.heroImage
                  ? 'The product hero image will be sent to the AI so it can describe what it sees.'
                  : 'No hero image yet — add one on the product page so the AI can also see the product.'}
              </p>
            </div>
          )}
          <textarea
            className="input"
            rows={4}
            value={form.marketing_description}
            onChange={set('marketing_description')}
            maxLength={MARKETING_DESC_MAXLEN}
            placeholder="Sell-copy for catalogues — evocative, customer-facing language… or click AI Write to generate"
          />
          <p className="text-[11px] text-ink-60 mt-0.5 text-right">{(form.marketing_description || '').length}/{MARKETING_DESC_MAXLEN}</p>
          {aiError && <p className="text-xs text-red-500 mt-1">{aiError}</p>}
          {!form.name && <p className="text-xs text-ink-60 mt-1">Enter a product name first to enable AI writing</p>}
          {form.marketing_description && !rewriteOpen && (
            <button type="button" onClick={() => setRewriteOpen(true)}
              className="text-xs text-ink-60 hover:text-brand-600 transition-colors mt-1 flex items-center gap-1">
              <RotateCcw size={13} />Rewrite with guidance
            </button>
          )}
          {rewriteOpen && (
            <div className="border border-brand-100 rounded-lg p-3 bg-brand-50 space-y-2 mt-1">
              <p className="text-xs font-medium text-brand-700">What should be different?</p>
              <textarea
                className="input text-sm w-full"
                rows={2}
                placeholder="e.g. More focused on luxury hotel clients, shorter, emphasise the engraving…"
                value={rewriteGuide}
                onChange={e => setRewriteGuide(e.target.value)}
                autoFocus
              />
              {rewriteError && <p className="text-xs text-red-500">{rewriteError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleRewrite} disabled={rewriteLoading || !rewriteGuide.trim()}
                  className="text-xs px-3 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors">
                  {rewriteLoading ? 'Rewriting…' : <span className="inline-flex items-center gap-1"><RotateCcw size={13} />Rewrite</span>}
                </button>
                <button type="button" onClick={() => { setRewriteOpen(false); setRewriteGuide('') }}
                  className="text-xs px-3 py-1.5 rounded-md border border-warm-grey text-ink-60 hover:bg-ivory transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="label">Assembly Notes</label>
          <textarea className="input" rows={2} value={form.assembly_notes} onChange={set('assembly_notes')} placeholder="Factory assembly instructions, special handling notes…" />
        </div>

        <VideoUrlsEditor videos={form.videos} onChange={v => setForm(f => ({ ...f, videos: v }))} />

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
