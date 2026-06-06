import { useState, useEffect } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useParams, useNavigate, Link } from 'react-router-dom'

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

// ── WordPress publish button ──────────────────────────────────────────────────
function WPPublishButton({ type, content, images }) {
  const [state, setState] = useState('idle') // idle | loading | success | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function handlePublish() {
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
        <p className="text-xs text-green-700">
          {result.images_uploaded}/{result.images_total} images uploaded to Media Library
        </p>
        <div className="flex gap-2 flex-wrap">
          <a
            href={result.edit_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-800 transition-colors"
          >
            ✏️ Edit in WordPress →
          </a>
          <a
            href={result.preview_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-white border border-green-300 text-green-700 hover:bg-green-50 transition-colors"
          >
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
        disabled={state === 'loading'}
        className="w-full btn-primary justify-center bg-blue-600 hover:bg-blue-700 border-blue-600"
        style={{ background: state === 'loading' ? '#3b82f6' : '#2563eb', borderColor: '#2563eb' }}
      >
        {state === 'loading' ? '⏳ Uploading images & publishing draft…' : '🚀 Publish Draft to WordPress'}
      </button>
      {state === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      <p className="text-xs text-gray-400 text-center">Images will be uploaded to WP Media Library for maximum SEO benefit</p>
    </div>
  )
}

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
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-brand-50 text-gray-600 hover:text-brand-700 transition-colors"
    >
      {copied ? '✓ Copied!' : label}
    </button>
  )
}

// ── Section block (for spotlight output) ─────────────────────────────────────
function SectionBlock({ section }) {
  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {section.type.replace('_', ' ')}
        </span>
        <CopyButton text={[section.heading, section.body].filter(Boolean).join('\n\n')} />
      </div>
      {section.heading && <p className="font-semibold text-gray-900">{section.heading}</p>}
      <p className="text-sm text-gray-700 whitespace-pre-line">{section.body}</p>
    </div>
  )
}

// ── Spotlight tab ─────────────────────────────────────────────────────────────
function SpotlightTab({ preloadedProduct }) {
  const [products, setProducts]   = useState([])
  const [selectedId, setSelectedId] = useState(preloadedProduct?.id || '')
  const [industry, setIndustry]   = useState('')
  const [result, setResult]       = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [productImages, setProductImages] = useState([])

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  const selectedProduct = preloadedProduct?.id === selectedId
    ? preloadedProduct
    : products.find(p => p.id === selectedId)

  // Fetch images when product changes
  useEffect(() => {
    if (!selectedId) { setProductImages([]); return }
    getDocs(query(collection(db, 'products', selectedId, 'images'), orderBy('sort_order')))
      .then(snap => setProductImages(snap.docs.map(d => d.data())))
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

  function fullPostText() {
    if (!result) return ''
    const lines = [
      `SEO TITLE: ${result.seo_title}`,
      `META DESCRIPTION: ${result.meta_description}`,
      `SLUG: ${result.slug}`,
      `FOCUS KEYWORD: ${result.focus_keyword}`,
      `TAGS: ${result.tags?.join(', ')}`,
      '',
      ...result.sections.flatMap(s => [
        s.heading ? `## ${s.heading}` : '',
        s.body,
        '',
      ]),
    ]
    return lines.filter(l => l !== undefined).join('\n')
  }

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
          <label className="label">Target Industry <span className="text-gray-400 font-normal">(optional — improves relevance)</span></label>
          <select className="input" value={industry} onChange={e => setIndustry(e.target.value)}>
            <option value="">General corporate gifting</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={!selectedId || loading}
          className="btn-primary w-full justify-center"
        >
          {loading ? '✍️ Writing blog post…' : '✨ Generate Product Spotlight Post'}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* SEO meta */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">SEO & Meta</h3>
              <CopyButton text={fullPostText()} label="Copy Full Post" />
            </div>
            <div className="space-y-2">
              {[
                { label: 'SEO Title', value: result.seo_title, hint: `${result.seo_title?.length || 0}/65 chars` },
                { label: 'Meta Description', value: result.meta_description, hint: `${result.meta_description?.length || 0}/155 chars` },
                { label: 'URL Slug', value: result.slug },
                { label: 'Focus Keyword', value: result.focus_keyword },
              ].map(({ label, value, hint }) => (
                <div key={label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-0.5">{label} {hint && <span className="text-gray-300">· {hint}</span>}</p>
                    <p className="text-sm text-gray-800">{value}</p>
                  </div>
                  <CopyButton text={value} />
                </div>
              ))}
              {result.tags && (
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {result.tags.map(t => (
                        <span key={t} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                  <CopyButton text={result.tags?.join(', ')} />
                </div>
              )}
            </div>
          </div>

          {/* Hero image */}
          {selectedProduct?.heroImage && (
            <div className="card p-5 space-y-2">
              <h3 className="font-semibold text-gray-800">Hero Image</h3>
              <div className="flex items-center gap-4">
                <img src={selectedProduct.heroImage} alt="" className="w-20 h-20 object-cover rounded-lg" />
                <div className="flex-1 space-y-1">
                  <p className="text-xs text-gray-400">Alt text for SEO</p>
                  <p className="text-sm text-gray-700">{result.hero_alt_text}</p>
                  <div className="flex gap-2 mt-1">
                    <CopyButton text={result.hero_alt_text} label="Copy alt text" />
                    <CopyButton text={selectedProduct.heroImage} label="Copy image URL" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Content sections */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Blog Content</h3>
              <p className="text-xs text-gray-400">Paste each section into an Elementor Text widget</p>
            </div>
            {result.sections?.map((s, i) => <SectionBlock key={i} section={s} />)}
          </div>

          {/* Publish to WordPress */}
          <div className="card p-5 space-y-3">
            <div>
              <h3 className="font-semibold text-gray-800">Publish to WordPress</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Creates a draft post with {productImages.length} image{productImages.length !== 1 ? 's' : ''} uploaded to WP Media Library
              </p>
            </div>
            <WPPublishButton
              type="spotlight"
              content={result}
              images={productImages.map(img => ({
                firebase_url: img.url,
                alt_text: img.alt_text || result.hero_alt_text || selectedProduct?.name || '',
                caption: img.caption || img.label || '',
              }))}
            />
          </div>

          {/* Elementor guide */}
          <div className="card p-5 bg-amber-50 border border-amber-100">
            <h3 className="font-semibold text-amber-800 mb-2">📋 Elementor Workflow (manual alternative)</h3>
            <ol className="text-sm text-amber-700 space-y-1 list-decimal list-inside">
              <li>In WordPress → Posts → Add New, set the <strong>SEO Title</strong> and <strong>Meta Description</strong> in Yoast/RankMath</li>
              <li>Set the <strong>URL slug</strong> in the post permalink</li>
              <li>Click <strong>Edit with Elementor</strong></li>
              <li>Add an <strong>Image widget</strong> → paste the image URL, set alt text</li>
              <li>Add a <strong>Heading widget</strong> for each section heading</li>
              <li>Add a <strong>Text Editor widget</strong> for each section body — copy from above</li>
              <li>Add <strong>Tags</strong> in the WordPress post settings panel</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Roundup tab ───────────────────────────────────────────────────────────────
function RoundupTab() {
  const [products, setProducts]     = useState([])
  const [selected, setSelected]     = useState([])
  const [industry, setIndustry]     = useState('')
  const [tone, setTone]             = useState('professional and premium')
  const [result, setResult]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

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

  function fullPostText() {
    if (!result) return ''
    const lines = [
      `SEO TITLE: ${result.seo_title}`,
      `META DESCRIPTION: ${result.meta_description}`,
      `SLUG: ${result.slug}`,
      `FOCUS KEYWORD: ${result.focus_keyword}`,
      `TAGS: ${result.tags?.join(', ')}`,
      '',
      result.intro?.body || '',
      '',
      ...(result.items || []).flatMap(item => [
        `## ${item.heading}`,
        item.body,
        item.image_caption ? `[Image: ${item.image_caption}]` : '',
        '',
      ]),
      `## ${result.conclusion?.heading || ''}`,
      result.conclusion?.body || '',
    ]
    return lines.join('\n')
  }

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        {/* Product picker */}
        <div>
          <label className="label">Select Products <span className="text-gray-400 font-normal">(2–7, in the order you want them)</span></label>
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {products.map(p => {
              const isSelected = selected.find(s => s.id === p.id)
              const idx = selected.findIndex(s => s.id === p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProduct(p)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
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

        <button
          onClick={handleGenerate}
          disabled={selected.length < 2 || loading}
          className="btn-primary w-full justify-center"
        >
          {loading ? '✍️ Writing roundup post…' : `✨ Generate Roundup Post (${selected.length} products)`}
        </button>
        {selected.length < 2 && <p className="text-xs text-gray-400 text-center">Select at least 2 products to generate a roundup</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* SEO meta */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">SEO & Meta</h3>
              <CopyButton text={fullPostText()} label="Copy Full Post" />
            </div>
            <div className="space-y-2">
              {[
                { label: 'SEO Title', value: result.seo_title, hint: `${result.seo_title?.length || 0}/65 chars` },
                { label: 'Meta Description', value: result.meta_description, hint: `${result.meta_description?.length || 0}/155 chars` },
                { label: 'URL Slug', value: result.slug },
                { label: 'Focus Keyword', value: result.focus_keyword },
              ].map(({ label, value, hint }) => (
                <div key={label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-0.5">{label} {hint && <span className="text-gray-300">· {hint}</span>}</p>
                    <p className="text-sm text-gray-800">{value}</p>
                  </div>
                  <CopyButton text={value} />
                </div>
              ))}
              {result.tags && (
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {result.tags.map(t => (
                        <span key={t} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                  <CopyButton text={result.tags?.join(', ')} />
                </div>
              )}
            </div>
          </div>

          {/* Intro */}
          {result.intro && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Introduction</h3>
                <CopyButton text={result.intro.body} />
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-line">{result.intro.body}</p>
            </div>
          )}

          {/* Product items */}
          {result.items?.map((item, i) => {
            const product = selected[i]
            return (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">{item.heading}</h3>
                  <CopyButton text={`${item.heading}\n\n${item.body}`} />
                </div>
                {product?.heroImage && (
                  <div className="flex items-center gap-3">
                    <img src={product.heroImage} alt="" className="w-16 h-16 object-cover rounded-lg" />
                    <div className="text-xs text-gray-500 space-y-1">
                      <p className="font-medium text-gray-700">Image caption: {item.image_caption}</p>
                      <CopyButton text={product.heroImage} label="Copy image URL" />
                    </div>
                  </div>
                )}
                <p className="text-sm text-gray-700 whitespace-pre-line">{item.body}</p>
              </div>
            )
          })}

          {/* Conclusion */}
          {result.conclusion && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">{result.conclusion.heading}</h3>
                <CopyButton text={`${result.conclusion.heading}\n\n${result.conclusion.body}`} />
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-line">{result.conclusion.body}</p>
            </div>
          )}

          {/* Publish to WordPress */}
          <div className="card p-5 space-y-3">
            <div>
              <h3 className="font-semibold text-gray-800">Publish to WordPress</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Creates a draft post with {selected.length} product image{selected.length !== 1 ? 's' : ''} uploaded to WP Media Library
              </p>
            </div>
            <WPPublishButton
              type="roundup"
              content={result}
              images={selected.map((p, i) => ({
                firebase_url: p.heroImage,
                alt_text: result.items?.[i]?.image_caption || p.name || '',
                caption: result.items?.[i]?.image_caption || '',
              })).filter(img => img.firebase_url)}
            />
          </div>

          {/* Elementor guide */}
          <div className="card p-5 bg-amber-50 border border-amber-100">
            <h3 className="font-semibold text-amber-800 mb-2">📋 Elementor Workflow (manual alternative)</h3>
            <ol className="text-sm text-amber-700 space-y-1 list-decimal list-inside">
              <li>WordPress → Posts → Add New, paste <strong>SEO Title</strong> + <strong>Meta Description</strong> into Yoast/RankMath</li>
              <li>Set the <strong>URL slug</strong> in permalink settings</li>
              <li>Edit with Elementor → for each product section: Image widget → Heading widget → Text widget</li>
              <li>Use <strong>"Copy image URL"</strong> to paste into Elementor Image widget URL field</li>
              <li>Add <strong>Tags</strong> in the WordPress sidebar</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BlogGenerator() {
  const { productId } = useParams()
  const navigate = useNavigate()
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
          Generate SEO-optimised blog content from your product data, ready to paste into Elementor.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6">
        {[
          { key: 'spotlight', label: '🔦 Product Spotlight', desc: 'One product, one post' },
          { key: 'roundup', label: '📋 Roundup Post', desc: 'Multiple products, one post' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
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
