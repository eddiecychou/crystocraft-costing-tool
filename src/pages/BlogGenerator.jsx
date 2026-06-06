import { useState, useEffect } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useParams, Link } from 'react-router-dom'

const INDUSTRIES = [
  'Banking & Financial Services',
  'Insurance Companies',
  'Luxury & Premium Brands',
  'Hotels & Hospitality',
  'Corporate Events & Award Ceremonies',
  'Technology Companies',
  'Healthcare & Pharmaceuticals',
  'Real Estate & Property',
  'Legal & Professional Services',
  'General Corporate Gifting',
]

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-brand-50 text-gray-600 hover:text-brand-700 transition-colors shrink-0"
    >
      {copied ? '✓ Copied!' : label}
    </button>
  )
}

// ── Image picker ──────────────────────────────────────────────────────────────
function ImagePicker({ images, selected, onChange }) {
  function toggle(img) {
    const isSelected = selected.find(s => s.url === img.url)
    if (isSelected) {
      onChange(selected.filter(s => s.url !== img.url))
    } else {
      onChange([...selected, img])
    }
  }

  if (!images.length) return (
    <p className="text-xs text-gray-400 py-2">No images found for this product. Upload images on the product page first.</p>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{selected.length} of {images.length} selected — first image becomes the hero & featured image</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange(images)} className="text-xs text-brand-600 hover:underline">All</button>
          <button type="button" onClick={() => onChange([])} className="text-xs text-gray-400 hover:underline">None</button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {images.map((img, i) => {
          const isSelected = Boolean(selected.find(s => s.url === img.url))
          const position = selected.findIndex(s => s.url === img.url)
          return (
            <button
              key={img.url || i}
              type="button"
              onClick={() => toggle(img)}
              className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-square ${
                isSelected ? 'border-brand-500' : 'border-gray-200 opacity-50'
              }`}
            >
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              {isSelected && (
                <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
                  {position + 1}
                </div>
              )}
              {position === 0 && (
                <div className="absolute bottom-0 inset-x-0 bg-brand-500/80 text-white text-xs text-center py-0.5">hero</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── WordPress publish button ──────────────────────────────────────────────────
function WPPublishButton({ type, content, images }) {
  const [state, setState] = useState('idle')
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function handlePublish() {
    if (!images.length) return
    setState('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/publish-to-wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, images }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Publish failed')
      setResult(data)
      setState('success')
    } catch (err) {
      setErrMsg(err.message || 'Publish failed — check WordPress credentials')
      setState('error')
    }
  }

  if (state === 'success' && result) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-green-800">✅ Draft published to WordPress!</p>
        <p className="text-xs text-green-700">{result.images_uploaded}/{result.images_total} images uploaded to Media Library</p>
        <div className="flex gap-2 flex-wrap">
          <a href={result.edit_url} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-800 transition-colors">
            ✏️ Edit in WordPress →
          </a>
          <a href={result.preview_url} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-white border border-green-300 text-green-700 hover:bg-green-50 transition-colors">
            👁 Preview post →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handlePublish}
        disabled={state === 'loading' || !images.length}
        className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
        style={{ background: '#2563eb' }}
      >
        {state === 'loading' ? '⏳ Uploading images & publishing draft…' : `🚀 Publish Draft to WordPress (${images.length} image${images.length !== 1 ? 's' : ''})`}
      </button>
      {!images.length && <p className="text-xs text-amber-600 text-center">Select at least one image to publish</p>}
      {state === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      <p className="text-xs text-gray-400 text-center">Images upload to WP Media Library — same domain = max SEO</p>
    </div>
  )
}

// ── Editable SEO meta card ────────────────────────────────────────────────────
function EditableMeta({ result, onChange }) {
  function set(field) {
    return e => onChange({ ...result, [field]: e.target.value })
  }
  function setTag(val) {
    onChange({ ...result, tags: val.split(',').map(t => t.trim()).filter(Boolean) })
  }

  const fields = [
    { label: 'SEO Title', field: 'seo_title', hint: `${result.seo_title?.length || 0}/65 chars` },
    { label: 'URL Slug', field: 'slug' },
    { label: 'Focus Keyword', field: 'focus_keyword' },
  ]

  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-semibold text-gray-800">SEO & Meta</h3>
      <div className="space-y-3">
        {fields.map(({ label, field, hint }) => (
          <div key={field}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">{label} {hint && <span className="text-gray-300">· {hint}</span>}</label>
              <CopyButton text={result[field] || ''} />
            </div>
            <input className="input text-sm" value={result[field] || ''} onChange={set(field)} />
          </div>
        ))}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">Meta Description · {result.meta_description?.length || 0}/155 chars</label>
            <CopyButton text={result.meta_description || ''} />
          </div>
          <textarea className="input text-sm" rows={2} value={result.meta_description || ''} onChange={set('meta_description')} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">Tags (comma separated)</label>
            <CopyButton text={result.tags?.join(', ') || ''} />
          </div>
          <input className="input text-sm" value={result.tags?.join(', ') || ''} onChange={e => setTag(e.target.value)} />
          <div className="flex flex-wrap gap-1 mt-1">
            {result.tags?.map(t => (
              <span key={t} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Spotlight tab ─────────────────────────────────────────────────────────────
function SpotlightTab({ preloadedProduct }) {
  const [products, setProducts]     = useState([])
  const [selectedId, setSelectedId] = useState(preloadedProduct?.id || '')
  const [industry, setIndustry]     = useState('')
  const [result, setResult]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [productImages, setProductImages] = useState([])
  const [selectedImages, setSelectedImages] = useState([])

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  const selectedProduct = preloadedProduct?.id === selectedId
    ? preloadedProduct
    : products.find(p => p.id === selectedId)

  useEffect(() => {
    if (!selectedId) { setProductImages([]); setSelectedImages([]); return }
    getDocs(query(collection(db, 'products', selectedId, 'images'), orderBy('sort_order')))
      .then(snap => {
        const imgs = snap.docs.map(d => d.data())
        setProductImages(imgs)
        setSelectedImages(imgs) // default: all selected
      })
  }, [selectedId])

  async function handleGenerate() {
    if (!selectedProduct) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/generate-blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'spotlight', product: selectedProduct, industry }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError('Failed to generate — please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function updateSection(i, field, val) {
    setResult(prev => ({
      ...prev,
      sections: prev.sections.map((s, idx) => idx === i ? { ...s, [field]: val } : s),
    }))
  }

  function fullPostText() {
    if (!result) return ''
    return [
      `SEO TITLE: ${result.seo_title}`,
      `META DESCRIPTION: ${result.meta_description}`,
      `SLUG: ${result.slug}`,
      `FOCUS KEYWORD: ${result.focus_keyword}`,
      `TAGS: ${result.tags?.join(', ')}`,
      '',
      ...result.sections.flatMap(s => [s.heading ? `## ${s.heading}` : '', s.body, '']),
    ].join('\n')
  }

  const wpImages = selectedImages.map(img => ({
    firebase_url: img.url,
    alt_text: img.alt_text || result?.hero_alt_text || selectedProduct?.name || '',
    caption: img.caption || img.label || '',
  }))

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Product</label>
          <select className="input" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            <option value="">Select a product…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} — {p.category}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Target Industry <span className="text-gray-400 font-normal">(optional)</span></label>
          <select className="input" value={industry} onChange={e => setIndustry(e.target.value)}>
            <option value="">General corporate gifting</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <button onClick={handleGenerate} disabled={!selectedId || loading} className="btn-primary w-full justify-center">
          {loading ? '✍️ Writing blog post…' : '✨ Generate Product Spotlight Post'}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          {/* SEO meta — editable */}
          <EditableMeta result={result} onChange={setResult} />

          {/* Content sections — editable */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Blog Content</h3>
              <CopyButton text={fullPostText()} label="Copy All" />
            </div>
            {result.sections?.map((s, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 shrink-0">
                    {s.type?.replace('_', ' ') || `Section ${i + 1}`}
                  </span>
                  <CopyButton text={[s.heading, s.body].filter(Boolean).join('\n\n')} />
                </div>
                {s.heading !== undefined && (
                  <input
                    className="input text-sm font-medium"
                    value={s.heading || ''}
                    onChange={e => updateSection(i, 'heading', e.target.value)}
                    placeholder="Section heading…"
                  />
                )}
                <textarea
                  className="input text-sm"
                  rows={4}
                  value={s.body || ''}
                  onChange={e => updateSection(i, 'body', e.target.value)}
                />
              </div>
            ))}
          </div>

          {/* Publish to WordPress */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-gray-800">Images & Publish to WordPress</h3>
            <p className="text-xs text-gray-500">
              Select which images to include. They'll be uploaded to WP Media Library and spread across the post content automatically.
            </p>
            <ImagePicker
              images={productImages}
              selected={selectedImages}
              onChange={setSelectedImages}
            />
            <WPPublishButton type="spotlight" content={result} images={wpImages} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Roundup tab ───────────────────────────────────────────────────────────────
function RoundupTab() {
  const [products, setProducts] = useState([])
  const [selected, setSelected] = useState([])
  const [industry, setIndustry] = useState('')
  const [tone, setTone]         = useState('professional and premium')
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  function toggleProduct(p) {
    setSelected(prev =>
      prev.find(s => s.id === p.id)
        ? prev.filter(s => s.id !== p.id)
        : prev.length < 7 ? [...prev, p] : prev
    )
  }

  async function handleGenerate() {
    if (selected.length < 2) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/generate-blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'roundup', products: selected, industry, tone }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError('Failed to generate — please try again.')
    } finally {
      setLoading(false)
    }
  }

  function updateItem(i, field, val) {
    setResult(prev => ({
      ...prev,
      items: prev.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item),
    }))
  }
  function updateIntro(val) { setResult(prev => ({ ...prev, intro: { ...prev.intro, body: val } })) }
  function updateConclusion(field, val) { setResult(prev => ({ ...prev, conclusion: { ...prev.conclusion, [field]: val } })) }

  function fullPostText() {
    if (!result) return ''
    return [
      `SEO TITLE: ${result.seo_title}`,
      `META DESCRIPTION: ${result.meta_description}`,
      `SLUG: ${result.slug}`,
      `FOCUS KEYWORD: ${result.focus_keyword}`,
      `TAGS: ${result.tags?.join(', ')}`,
      '',
      result.intro?.body || '',
      '',
      ...(result.items || []).flatMap(item => [`## ${item.heading}`, item.body, '']),
      `## ${result.conclusion?.heading || ''}`,
      result.conclusion?.body || '',
    ].join('\n')
  }

  const wpImages = selected
    .map((p, i) => ({
      firebase_url: p.heroImage,
      alt_text: result?.items?.[i]?.image_caption || p.name || '',
      caption: result?.items?.[i]?.image_caption || '',
    }))
    .filter(img => img.firebase_url)

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        {/* Product picker */}
        <div>
          <label className="label">Select Products <span className="text-gray-400 font-normal">(2–7, in the order you want)</span></label>
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {products.map(p => {
              const isSelected = selected.find(s => s.id === p.id)
              const idx = selected.findIndex(s => s.id === p.id)
              return (
                <button key={p.id} type="button" onClick={() => toggleProduct(p)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    isSelected ? 'border-brand-300 bg-brand-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {p.heroImage
                    ? <img src={p.heroImage} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0 text-lg">📦</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.category}</p>
                  </div>
                  {isSelected && (
                    <span className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center shrink-0 font-bold">
                      {idx + 1}
                    </span>
                  )}
                  {!p.heroImage && (
                    <span className="text-xs text-amber-500 shrink-0">no image</span>
                  )}
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <p className="text-xs text-brand-600 mt-1">{selected.length} selected: {selected.map(s => s.name).join(', ')}</p>
          )}
        </div>

        <div>
          <label className="label">Target Industry / Theme</label>
          <select className="input" value={industry} onChange={e => setIndustry(e.target.value)}>
            <option value="">General corporate gifting</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Tone</label>
          <select className="input" value={tone} onChange={e => setTone(e.target.value)}>
            <option value="professional and premium">Professional & Premium</option>
            <option value="warm and approachable">Warm & Approachable</option>
            <option value="luxury and exclusive">Luxury & Exclusive</option>
            <option value="practical and informative">Practical & Informative</option>
          </select>
        </div>

        <button onClick={handleGenerate} disabled={selected.length < 2 || loading} className="btn-primary w-full justify-center">
          {loading ? '✍️ Writing roundup post…' : `✨ Generate Roundup Post (${selected.length} products)`}
        </button>
        {selected.length < 2 && <p className="text-xs text-gray-400 text-center">Select at least 2 products</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          {/* SEO meta — editable */}
          <EditableMeta result={result} onChange={setResult} />

          {/* Intro */}
          {result.intro && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Introduction</h3>
                <CopyButton text={result.intro.body} />
              </div>
              <textarea className="input text-sm" rows={3} value={result.intro.body || ''} onChange={e => updateIntro(e.target.value)} />
            </div>
          )}

          {/* Product items */}
          {result.items?.map((item, i) => {
            const product = selected[i]
            return (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Product {i + 1}</span>
                  <CopyButton text={`${item.heading}\n\n${item.body}`} />
                </div>
                <input className="input text-sm font-medium" value={item.heading || ''} onChange={e => updateItem(i, 'heading', e.target.value)} placeholder="Heading…" />
                {product?.heroImage && (
                  <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                    <img src={product.heroImage} alt="" className="w-14 h-14 object-cover rounded" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-1">Image caption / alt text</p>
                      <input
                        className="input text-xs py-1"
                        value={item.image_caption || ''}
                        onChange={e => updateItem(i, 'image_caption', e.target.value)}
                        placeholder="e.g. Crystal trophy engraved with company logo"
                      />
                    </div>
                  </div>
                )}
                {!product?.heroImage && (
                  <p className="text-xs text-amber-500 bg-amber-50 rounded p-2">⚠️ This product has no hero image — it will appear without a photo in the post</p>
                )}
                <textarea className="input text-sm" rows={4} value={item.body || ''} onChange={e => updateItem(i, 'body', e.target.value)} />
              </div>
            )
          })}

          {/* Conclusion */}
          {result.conclusion && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Conclusion</h3>
                <CopyButton text={`${result.conclusion.heading}\n\n${result.conclusion.body}`} />
              </div>
              <input className="input text-sm font-medium" value={result.conclusion.heading || ''} onChange={e => updateConclusion('heading', e.target.value)} />
              <textarea className="input text-sm" rows={3} value={result.conclusion.body || ''} onChange={e => updateConclusion('body', e.target.value)} />
            </div>
          )}

          {/* Images preview + publish */}
          <div className="card p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-800">Images & Publish to WordPress</h3>
              <p className="text-xs text-gray-500 mt-0.5">Each product's hero image will be placed beside its section in the post.</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {selected.map((p, i) => (
                <div key={p.id} className="space-y-1">
                  {p.heroImage
                    ? <img src={p.heroImage} alt="" className="w-full aspect-square object-cover rounded-lg border border-gray-200" />
                    : <div className="w-full aspect-square rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">no image</div>
                  }
                  <p className="text-xs text-gray-500 text-center truncate">{p.name}</p>
                </div>
              ))}
            </div>
            <WPPublishButton type="roundup" content={result} images={wpImages} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BlogGenerator() {
  const { productId } = useParams()
  const [tab, setTab] = useState('spotlight')
  const [preloadedProduct, setPreloadedProduct] = useState(null)

  useEffect(() => {
    if (productId) {
      getDoc(doc(db, 'products', productId)).then(snap => {
        if (snap.exists()) setPreloadedProduct({ id: snap.id, ...snap.data() })
      })
    }
  }, [productId])

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <Link to="/products" className="text-sm text-brand-600 hover:underline">← Products</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Blog Post Generator</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate SEO-optimised blog content from your product data, then publish as a WordPress draft in one click.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6">
        {[
          { key: 'spotlight', label: '🔦 Product Spotlight', desc: 'One product, one post' },
          { key: 'roundup',   label: '📋 Roundup Post',      desc: 'Multiple products, one post' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.label}</span>
            <span className="block text-xs font-normal text-gray-400">{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'spotlight'
        ? <SpotlightTab preloadedProduct={preloadedProduct} />
        : <RoundupTab />
      }
    </div>
  )
}
