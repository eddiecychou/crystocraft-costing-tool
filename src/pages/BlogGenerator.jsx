import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useParams, Link } from 'react-router-dom'

const INDUSTRIES = [
  'Banking & Financial Services', 'Insurance Companies', 'Luxury & Premium Brands',
  'Hotels & Hospitality', 'Corporate Events & Award Ceremonies', 'Technology Companies',
  'Healthcare & Pharmaceuticals', 'Real Estate & Property', 'Legal & Professional Services',
  'General Corporate Gifting',
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-brand-50 text-gray-600 hover:text-brand-700 transition-colors shrink-0">
      {copied ? '✓ Copied!' : label}
    </button>
  )
}

// ── Hero image picker — single select ────────────────────────────────────────
function HeroPicker({ images, value, onChange }) {
  if (!images.length) return <p className="text-xs text-gray-400">No images on this product yet.</p>
  return (
    <div className="grid grid-cols-5 gap-2">
      {images.map((img, i) => {
        const active = value?.url === img.url
        return (
          <button key={img.url || i} type="button"
            onClick={() => onChange(active ? null : img)}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${active ? 'border-brand-500' : 'border-gray-200 opacity-50 hover:opacity-90'}`}>
            <img src={img.url} alt="" className="w-full h-full object-cover" />
            {active && (
              <div className="absolute inset-0 bg-brand-500/20 flex items-end justify-center pb-1">
                <span className="text-xs bg-brand-500 text-white px-1.5 py-0.5 rounded font-semibold">HERO</span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Per-section image picker — 0 to 3 images ─────────────────────────────────
function SectionImagePicker({ images, heroImage, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const available = images.filter(img => img.url !== heroImage?.url)

  function toggle(img) {
    const has = selected.find(s => s.url === img.url)
    if (has) { onChange(selected.filter(s => s.url !== img.url)) }
    else if (selected.length < 3) { onChange([...selected, img]) }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selected.map((img, i) => (
          <div key={img.url} className="relative">
            <img src={img.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
            <button type="button" onClick={() => onChange(selected.filter(s => s.url !== img.url))}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center leading-none">×</button>
            <span className="absolute -bottom-1.5 -left-1 text-[10px] bg-gray-700 text-white px-1 rounded">
              {i === 0 && selected.length === 1 ? 'right' : `${i + 1}`}
            </span>
          </div>
        ))}
        {selected.length < 3 && (
          <button type="button" onClick={() => setOpen(o => !o)}
            className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 hover:border-brand-400 text-gray-400 hover:text-brand-500 flex flex-col items-center justify-center text-xs gap-0.5 transition-colors">
            <span className="text-lg leading-none">+</span>
            <span>photo</span>
          </button>
        )}
        {selected.length > 0 && (
          <p className="text-xs text-gray-400 ml-1">
            {selected.length === 1 ? 'Image will appear on the right' : `${selected.length} images will appear below text`}
          </p>
        )}
      </div>

      {open && (
        <div className="border border-gray-100 rounded-lg p-3 bg-gray-50">
          <div className="grid grid-cols-6 gap-1.5">
            {available.map(img => {
              const active = Boolean(selected.find(s => s.url === img.url))
              const atMax = selected.length >= 3 && !active
              return (
                <button key={img.url} type="button" onClick={() => toggle(img)} disabled={atMax}
                  className={`relative aspect-square rounded overflow-hidden border-2 transition-all ${active ? 'border-brand-500' : 'border-transparent opacity-50 hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed'}`}>
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  {active && <div className="absolute inset-0 bg-brand-500/30" />}
                </button>
              )
            })}
            {available.length === 0 && <p className="col-span-6 text-xs text-gray-400 text-center py-2">No other images — hero image is already selected</p>}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 mt-2">Done</button>
        </div>
      )}
    </div>
  )
}

// ── Blog preview (iframe) ─────────────────────────────────────────────────────
function buildSpotlightPreviewHTML(result, heroImage, sectionImages) {
  const css = `
    *{box-sizing:border-box}
    body{font-family:Georgia,'Times New Roman',serif;max-width:800px;margin:0 auto;padding:28px 20px;color:#222;line-height:1.75}
    h1{font-size:1.9em;line-height:1.25;margin:0 0 .3em;color:#111}
    h2{font-size:1.3em;margin:0 0 .5em;color:#111}
    p{margin:0 0 1em}
    .kw{font-family:sans-serif;font-size:.8em;color:#aaa;margin-bottom:2em}
    .hero{width:100%;max-height:400px;object-fit:cover;border-radius:10px;display:block;margin-bottom:2.5em}
    .section{margin-bottom:2.5em}
    .col{display:flex;gap:2em;align-items:flex-start}
    .col .text{flex:6;min-width:0}
    .col .img{flex:4;min-width:0}
    .col .img img{width:100%;border-radius:8px;display:block}
    .imgs{display:flex;gap:1em;margin-top:1em}
    .imgs figure{flex:1;width:0;min-width:0;margin:0}
    .imgs img{width:100%;border-radius:8px;object-fit:cover;aspect-ratio:4/3;display:block}
    figcaption{font-size:.78em;color:#999;text-align:center;margin-top:.35em;font-family:sans-serif}
    @media(max-width:600px){.col{flex-direction:column}.imgs{flex-direction:column}.imgs figure{width:100%}}
  `
  let body = `<h1>${escapeHtml(result.seo_title)}</h1>`
  body += `<p class="kw">Focus keyword: ${escapeHtml(result.focus_keyword)} · Tags: ${(result.tags || []).map(escapeHtml).join(', ')}</p>`

  if (heroImage) {
    body += `<img class="hero" src="${heroImage.url}" alt="${escapeHtml(heroImage.alt_text || heroImage.label || '')}" />`
  }

  result.sections?.forEach((s, i) => {
    const imgs = sectionImages[i] || []
    const heading = s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''
    const paras = `<p>${escapeHtml(s.body || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    const imgHtml = (img) => `<figure><img src="${img.url}" alt="${escapeHtml(img.alt_text || img.label || '')}" />${img.caption || img.label ? `<figcaption>${escapeHtml(img.caption || img.label)}</figcaption>` : ''}</figure>`

    if (imgs.length === 1) {
      body += `<div class="section col"><div class="text">${heading}${paras}</div><div class="img">${imgHtml(imgs[0])}</div></div>`
    } else {
      body += `<div class="section">${heading}${paras}${imgs.length > 0 ? `<div class="imgs">${imgs.map(imgHtml).join('')}</div>` : ''}</div>`
    }
  })

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`
}

function buildRoundupPreviewHTML(result, selected) {
  const css = `
    *{box-sizing:border-box}
    body{font-family:Georgia,'Times New Roman',serif;max-width:800px;margin:0 auto;padding:28px 20px;color:#222;line-height:1.75}
    h1{font-size:1.9em;line-height:1.25;margin:0 0 .3em;color:#111}
    h2{font-size:1.3em;margin:0 0 .5em;color:#111}
    p{margin:0 0 1em}
    .kw{font-family:sans-serif;font-size:.8em;color:#aaa;margin-bottom:2em}
    .section{margin-bottom:2.5em}
    .col{display:flex;gap:2em;align-items:flex-start}
    .col .text{flex:6;min-width:0}
    .col .img{flex:4;min-width:0}
    .col .img img{width:100%;border-radius:8px;display:block}
    hr{border:none;border-top:1px solid #e5e7eb;margin:2em 0}
    figcaption{font-size:.78em;color:#999;text-align:center;margin-top:.35em;font-family:sans-serif}
    @media(max-width:600px){.col{flex-direction:column}}
  `
  let body = `<h1>${escapeHtml(result.seo_title)}</h1>`
  body += `<p class="kw">Focus keyword: ${escapeHtml(result.focus_keyword)} · Tags: ${(result.tags || []).map(escapeHtml).join(', ')}</p>`

  if (result.intro?.body) {
    body += `<p>${escapeHtml(result.intro.body).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
  }

  result.items?.forEach((item, i) => {
    const product = selected[i]
    const heading = `<h2>${escapeHtml(item.heading)}</h2>`
    const paras = `<p>${escapeHtml(item.body || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    if (product?.heroImage) {
      body += `<div class="section col"><div class="text">${heading}${paras}</div><div class="img"><figure><img src="${product.heroImage}" alt="${escapeHtml(item.image_caption || product.name || '')}" />${item.image_caption ? `<figcaption>${escapeHtml(item.image_caption)}</figcaption>` : ''}</figure></div></div>`
    } else {
      body += `<div class="section">${heading}${paras}</div>`
    }
    if (i < result.items.length - 1) body += '<hr/>'
  })

  if (result.conclusion) {
    body += `<div class="section"><h2>${escapeHtml(result.conclusion.heading)}</h2><p>${escapeHtml(result.conclusion.body || '').replace(/\n\n/g, '</p><p>')}</p></div>`
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`
}

function PreviewModal({ html, onClose }) {
  const [viewport, setViewport] = useState('desktop')
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-gray-800 text-sm">Blog Post Preview</h2>
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-md">
            {[['desktop', '🖥 Desktop'], ['mobile', '📱 Mobile']].map(([key, label]) => (
              <button key={key} onClick={() => setViewport(key)}
                className={`text-xs px-3 py-1 rounded transition-colors ${viewport === key ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-1">×</button>
      </div>
      <div className="flex-1 overflow-auto bg-gray-200 p-4 flex justify-center">
        <iframe
          srcDoc={html}
          title="Blog Preview"
          className="bg-white rounded-xl shadow-xl transition-all duration-300"
          style={{ border: 'none', height: '100%', width: viewport === 'mobile' ? '390px' : '100%', maxWidth: viewport === 'desktop' ? '900px' : undefined }}
        />
      </div>
    </div>
  )
}

// ── WordPress publish button ──────────────────────────────────────────────────
function WPPublishButton({ payload, disabled }) {
  const [state, setState] = useState('idle')
  const [wpResult, setWpResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function handlePublish() {
    setState('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/publish-to-wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Publish failed')
      setWpResult(data)
      setState('success')
    } catch (err) {
      setErrMsg(err.message || 'Publish failed — check WP credentials in Netlify')
      setState('error')
    }
  }

  if (state === 'success' && wpResult) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-green-800">✅ Draft published to WordPress!</p>
        <p className="text-xs text-green-700">{wpResult.images_uploaded}/{wpResult.images_total} images uploaded to Media Library</p>
        <div className="flex gap-2 flex-wrap">
          <a href={wpResult.edit_url} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-800 transition-colors">✏️ Edit in WordPress →</a>
          <a href={wpResult.preview_url} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-md bg-white border border-green-300 text-green-700 hover:bg-green-50 transition-colors">👁 Preview →</a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <button onClick={handlePublish} disabled={state === 'loading' || disabled}
        className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
        style={{ background: '#2563eb' }}>
        {state === 'loading' ? '⏳ Uploading & publishing draft…' : '🚀 Publish Draft to WordPress'}
      </button>
      {state === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      <p className="text-xs text-gray-400 text-center">Images upload to WP Media Library for maximum SEO benefit</p>
    </div>
  )
}

// ── Editable SEO meta ─────────────────────────────────────────────────────────
function EditableMeta({ result, onChange }) {
  function set(field) { return e => onChange({ ...result, [field]: e.target.value }) }
  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-semibold text-gray-800">SEO & Meta</h3>
      <div className="space-y-3">
        {[
          { label: 'SEO Title', field: 'seo_title', hint: `${result.seo_title?.length || 0}/65` },
          { label: 'URL Slug', field: 'slug' },
          { label: 'Focus Keyword', field: 'focus_keyword' },
        ].map(({ label, field, hint }) => (
          <div key={field}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">{label}{hint ? ` · ${hint} chars` : ''}</label>
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
          <input className="input text-sm" value={result.tags?.join(', ') || ''}
            onChange={e => onChange({ ...result, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
          <div className="flex flex-wrap gap-1 mt-1">
            {result.tags?.map(t => <span key={t} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">{t}</span>)}
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
  const [heroImage, setHeroImage]   = useState(null)
  const [sectionImages, setSectionImages] = useState([])  // array of arrays
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  const selectedProduct = preloadedProduct?.id === selectedId
    ? preloadedProduct
    : products.find(p => p.id === selectedId)

  useEffect(() => {
    if (!selectedId) { setProductImages([]); setHeroImage(null); setSectionImages([]); return }
    getDocs(query(collection(db, 'products', selectedId, 'images'), orderBy('sort_order')))
      .then(snap => {
        const imgs = snap.docs.map(d => d.data())
        setProductImages(imgs)
        setHeroImage(imgs[0] || null)
        setSectionImages(result ? result.sections.map(() => []) : [])
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
      setSectionImages(data.sections.map(() => []))
    } catch (err) {
      setError('Failed to generate — please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function updateSection(i, field, val) {
    setResult(prev => ({ ...prev, sections: prev.sections.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }))
  }
  function setSectionImgs(i, imgs) {
    setSectionImages(prev => prev.map((s, idx) => idx === i ? imgs : s))
  }

  // Build payload for WP publish
  const wpPayload = result ? {
    type: 'spotlight',
    hero: heroImage ? { firebase_url: heroImage.url, alt_text: heroImage.alt_text || heroImage.label || selectedProduct?.name || '' } : null,
    content: {
      ...result,
      sections: result.sections.map((s, i) => ({
        ...s,
        images: (sectionImages[i] || []).map(img => ({
          firebase_url: img.url,
          alt_text: img.alt_text || img.label || '',
          caption: img.caption || img.label || '',
        }))
      }))
    }
  } : null

  const previewHTML = result ? buildSpotlightPreviewHTML(result, heroImage, sectionImages) : ''

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
          <EditableMeta result={result} onChange={setResult} />

          {/* Hero image picker */}
          <div className="card p-5 space-y-3">
            <div>
              <h3 className="font-semibold text-gray-800">Hero Image</h3>
              <p className="text-xs text-gray-400 mt-0.5">Full-width image at the top of the post + WordPress featured image</p>
            </div>
            <HeroPicker images={productImages} value={heroImage} onChange={setHeroImage} />
          </div>

          {/* Content sections — editable with image pickers */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Blog Content</h3>
              <CopyButton text={result.sections?.map(s => [s.heading ? `## ${s.heading}` : '', s.body].filter(Boolean).join('\n\n')).join('\n\n')} label="Copy All" />
            </div>
            {result.sections?.map((s, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 shrink-0">{s.type?.replace('_', ' ') || `Section ${i + 1}`}</span>
                  <CopyButton text={[s.heading, s.body].filter(Boolean).join('\n\n')} />
                </div>
                {s.heading !== undefined && (
                  <input className="input text-sm font-medium" value={s.heading || ''} placeholder="Heading…"
                    onChange={e => updateSection(i, 'heading', e.target.value)} />
                )}
                <textarea className="input text-sm" rows={4} value={s.body || ''}
                  onChange={e => updateSection(i, 'body', e.target.value)} />

                {/* Section image picker */}
                <div className="border-t border-gray-50 pt-2">
                  <p className="text-xs text-gray-400 mb-1">Section images <span className="text-gray-300">(0–3 · 1 image = right side, 2–3 images = row below text)</span></p>
                  <SectionImagePicker
                    images={productImages}
                    heroImage={heroImage}
                    selected={sectionImages[i] || []}
                    onChange={imgs => setSectionImgs(i, imgs)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Publish card */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Publish to WordPress</h3>
              <button onClick={() => setShowPreview(true)}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                👁 Preview HTML
              </button>
            </div>
            <WPPublishButton payload={wpPayload} />
          </div>
        </div>
      )}

      {showPreview && <PreviewModal html={previewHTML} onClose={() => setShowPreview(false)} />}
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
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  function toggleProduct(p) {
    setSelected(prev => prev.find(s => s.id === p.id) ? prev.filter(s => s.id !== p.id) : prev.length < 7 ? [...prev, p] : prev)
  }

  async function handleGenerate() {
    if (selected.length < 2) return
    setLoading(true); setError(''); setResult(null)
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
    } catch { setError('Failed to generate — please try again.') }
    finally { setLoading(false) }
  }

  function updateItem(i, field, val) {
    setResult(prev => ({ ...prev, items: prev.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item) }))
  }

  const wpPayload = result ? {
    type: 'roundup',
    content: result,
    images: selected.map((p, i) => ({
      firebase_url: p.heroImage,
      alt_text: result.items?.[i]?.image_caption || p.name || '',
      caption: result.items?.[i]?.image_caption || '',
    })).filter(img => img.firebase_url),
  } : null

  const previewHTML = result ? buildRoundupPreviewHTML(result, selected) : ''

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Select Products <span className="text-gray-400 font-normal">(2–7, in order)</span></label>
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {products.map(p => {
              const idx = selected.findIndex(s => s.id === p.id)
              const isSelected = idx >= 0
              return (
                <button key={p.id} type="button" onClick={() => toggleProduct(p)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${isSelected ? 'border-brand-300 bg-brand-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}>
                  {p.heroImage
                    ? <img src={p.heroImage} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0 text-lg">📦</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.category}</p>
                  </div>
                  {!p.heroImage && <span className="text-xs text-amber-500 shrink-0">no image</span>}
                  {isSelected && (
                    <span className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center shrink-0 font-bold">{idx + 1}</span>
                  )}
                </button>
              )
            })}
          </div>
          {selected.length > 0 && <p className="text-xs text-brand-600 mt-1">{selected.length} selected</p>}
        </div>

        <div>
          <label className="label">Target Industry</label>
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
          {loading ? '✍️ Writing roundup…' : `✨ Generate Roundup (${selected.length} products)`}
        </button>
        {selected.length < 2 && <p className="text-xs text-gray-400 text-center">Select at least 2 products</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          <EditableMeta result={result} onChange={setResult} />

          {result.intro && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Introduction</h3>
                <CopyButton text={result.intro.body} />
              </div>
              <textarea className="input text-sm" rows={3} value={result.intro.body || ''}
                onChange={e => setResult(prev => ({ ...prev, intro: { ...prev.intro, body: e.target.value } }))} />
            </div>
          )}

          {result.items?.map((item, i) => {
            const product = selected[i]
            return (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Product {i + 1}</span>
                  <CopyButton text={`${item.heading}\n\n${item.body}`} />
                </div>
                <input className="input text-sm font-medium" value={item.heading || ''} placeholder="Heading…"
                  onChange={e => updateItem(i, 'heading', e.target.value)} />
                {product?.heroImage ? (
                  <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                    <img src={product.heroImage} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-1">Image caption / alt text</p>
                      <input className="input text-xs py-1" value={item.image_caption || ''} placeholder="e.g. Crystal trophy with logo engraving"
                        onChange={e => updateItem(i, 'image_caption', e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-amber-500 bg-amber-50 rounded p-2">⚠️ No hero image — this product will appear without a photo</p>
                )}
                <textarea className="input text-sm" rows={4} value={item.body || ''}
                  onChange={e => updateItem(i, 'body', e.target.value)} />
              </div>
            )
          })}

          {result.conclusion && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Conclusion</h3>
                <CopyButton text={`${result.conclusion.heading}\n\n${result.conclusion.body}`} />
              </div>
              <input className="input text-sm font-medium" value={result.conclusion.heading || ''}
                onChange={e => setResult(prev => ({ ...prev, conclusion: { ...prev.conclusion, heading: e.target.value } }))} />
              <textarea className="input text-sm" rows={3} value={result.conclusion.body || ''}
                onChange={e => setResult(prev => ({ ...prev, conclusion: { ...prev.conclusion, body: e.target.value } }))} />
            </div>
          )}

          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Publish to WordPress</h3>
              <button onClick={() => setShowPreview(true)}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                👁 Preview HTML
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {selected.map(p => (
                <div key={p.id}>
                  {p.heroImage
                    ? <img src={p.heroImage} alt="" className="w-full aspect-square object-cover rounded-lg border border-gray-200" />
                    : <div className="w-full aspect-square rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">no img</div>
                  }
                </div>
              ))}
            </div>
            <WPPublishButton payload={wpPayload} />
          </div>
        </div>
      )}

      {showPreview && <PreviewModal html={previewHTML} onClose={() => setShowPreview(false)} />}
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
        <p className="text-sm text-gray-500 mt-1">Generate SEO-optimised blog content, preview it, then publish as a WordPress draft.</p>
      </div>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6">
        {[{ key: 'spotlight', label: '🔦 Product Spotlight', desc: 'One product, one post' },
          { key: 'roundup', label: '📋 Roundup Post', desc: 'Multiple products, one post' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <span>{t.label}</span>
            <span className="block text-xs font-normal text-gray-400">{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'spotlight' ? <SpotlightTab preloadedProduct={preloadedProduct} /> : <RoundupTab />}
    </div>
  )
}
