import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { isPublicVisible } from '../constants'
import { useParams, Link } from 'react-router-dom'
import {
  Check, X, Pencil, FileArchive, Clock, Rocket, RotateCcw,
  Sparkles, Eye, Package, AlertTriangle, Monitor, Smartphone,
  Flashlight, List,
} from 'lucide-react'

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
      {copied ? <span className="inline-flex items-center gap-1"><Check size={12} />Copied!</span> : label}
    </button>
  )
}

// ── Hero image picker — single select ────────────────────────────────────────
const ORIENTATION_BADGE = {
  landscape: { label: 'L', cls: 'bg-blue-500 text-white' },
  square:    { label: 'S', cls: 'bg-purple-500 text-white' },
  portrait:  { label: 'P', cls: 'bg-green-500 text-white' },
}

function HeroPicker({ images, value, onChange }) {
  if (!images.length) return <p className="text-xs text-gray-400">No images on this product yet.</p>
  return (
    <div className="grid grid-cols-5 gap-2">
      {images.map((img, i) => {
        const active = value?.file_url === img.file_url
        const orient = ORIENTATION_BADGE[img.orientation] || ORIENTATION_BADGE.square
        return (
          <button key={img.file_url || i} type="button"
            onClick={() => onChange(active ? null : img)}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${active ? 'border-brand-500' : 'border-gray-200 opacity-50 hover:opacity-90'}`}>
            <img src={img.file_url} alt="" className="w-full h-full object-cover" />
            <span className={`absolute top-1 left-1 text-[10px] font-bold px-1 py-0.5 rounded leading-none ${orient.cls}`}>{orient.label}</span>
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
  const available = images.filter(img => img.file_url !== heroImage?.file_url)

  function toggle(img) {
    const has = selected.find(s => s.file_url === img.file_url)
    if (has) { onChange(selected.filter(s => s.file_url !== img.file_url)) }
    else if (selected.length < 3) { onChange([...selected, img]) }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selected.map((img, i) => (
          <div key={img.file_url} className="relative">
            <img src={img.file_url} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
            <button type="button" onClick={() => onChange(selected.filter(s => s.file_url !== img.file_url))}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center leading-none"><X size={10} /></button>
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
            {selected.length === 1 ? '1 image — appears below text' : `${selected.length} images — appear below text`}
          </p>
        )}
      </div>

      {open && (
        <div className="border border-gray-100 rounded-lg p-3 bg-gray-50">
          <div className="grid grid-cols-6 gap-1.5">
            {available.map(img => {
              const active = Boolean(selected.find(s => s.file_url === img.file_url))
              const atMax = selected.length >= 3 && !active
              return (
                <button key={img.file_url} type="button" onClick={() => toggle(img)} disabled={atMax}
                  className={`relative aspect-square rounded overflow-hidden border-2 transition-all ${active ? 'border-brand-500' : 'border-transparent opacity-50 hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed'}`}>
                  <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                  {img.orientation && (() => { const o = ORIENTATION_BADGE[img.orientation]; return o ? <span className={`absolute top-0.5 left-0.5 text-[9px] font-bold px-0.5 rounded leading-none ${o.cls}`}>{o.label}</span> : null })()}
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
function buildSpotlightPreviewHTML(result, heroImage, sectionImages, productUrl, ctaText) {
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Questrial&family=Work+Sans:wght@400;500;600&display=swap');
    *{box-sizing:border-box}
    body{font-family:'Questrial',system-ui,'Helvetica Neue',Arial,sans-serif;max-width:800px;margin:0 auto;padding:28px 20px;color:#222222;line-height:1.75;background:#FFFFFF}
    h1{font-family:'Questrial',system-ui,sans-serif;font-size:2.2em;font-weight:400;line-height:1.15;margin:0 0 .3em;color:#222222;text-transform:uppercase;letter-spacing:0.03em}
    h2{font-family:'Questrial',system-ui,sans-serif;font-size:1.5em;font-weight:400;margin:0 0 .5em;color:#222222;text-transform:uppercase;letter-spacing:0.03em}
    p{margin:0 0 1em}
    .kw{font-family:'Work Sans',system-ui,sans-serif;font-size:.72em;font-weight:500;text-transform:uppercase;color:#666666;margin-bottom:2em;letter-spacing:0.18em}
    .hero{width:100%;display:block;margin-bottom:3em}
    .section{margin-top:3em;margin-bottom:4em;padding-bottom:4em;border-bottom:1px solid #EDE8DF}
    .section:last-child{border-bottom:none;padding-bottom:0}
    .col{display:flex;gap:2.5em;align-items:flex-start}
    .col .text{flex:6;min-width:0}
    .col .img{flex:4;min-width:0}
    .col .img img{width:100%;display:block}
    .imgs{display:flex;gap:1.2em;margin-top:1.5em;align-items:flex-start}
    .imgs a{flex:1;display:block;min-width:0;margin:0;text-decoration:none}
    .imgs figure{flex:1;width:0;min-width:0;margin:0}
    .imgs a figure{width:100%;flex:none}
    .imgs img{width:100%;display:block}
    figcaption{font-family:'Work Sans',system-ui,sans-serif;font-size:.72em;font-weight:400;color:#6E6C66;text-align:center;margin-top:.35em;letter-spacing:0.04em}
    .btn{font-family:'Work Sans',system-ui,sans-serif;display:inline-block;margin-top:1em;padding:.6em 1.4em;background:#6E2433;color:#F7F4EF;text-decoration:none;font-size:.82em;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;border-radius:0}
    @media(max-width:600px){.col{flex-direction:column}.imgs{flex-direction:column}.imgs figure{width:100%}}
  `
  let body = `<h1>${escapeHtml(result.seo_title)}</h1>`
  body += `<p class="kw">Focus keyword: ${escapeHtml(result.focus_keyword)} · Tags: ${(result.tags || []).map(escapeHtml).join(', ')}</p>`

  if (heroImage) {
    const heroEl = `<img class="hero" src="${heroImage.file_url}" alt="${escapeHtml(heroImage.alt_text || heroImage.label || '')}" />`
    body += productUrl ? `<a href="${productUrl}" target="_blank">${heroEl}</a>` : heroEl
  }

  result.sections?.forEach((s, i) => {
    const imgs    = sectionImages[i] || []
    const linkUrl = s.section_url || ''  // per-section only; global URL is for button
    const heading = s.heading
      ? (linkUrl ? `<h2><a href="${linkUrl}" target="_blank">${escapeHtml(s.heading)}</a></h2>` : `<h2>${escapeHtml(s.heading)}</h2>`)
      : ''
    const paras = `<p>${escapeHtml(s.body || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    const imgHtml = (img) => {
      const el = `<figure><img src="${img.file_url}" alt="${escapeHtml(img.alt_text || img.label || '')}" />${img.caption || img.label ? `<figcaption>${escapeHtml(img.caption || img.label)}</figcaption>` : ''}</figure>`
      return linkUrl ? `<a href="${linkUrl}" target="_blank">${el}</a>` : el
    }
    const btn = (s.type === 'cta' && productUrl) ? `<a class="btn" href="${productUrl}" target="_blank">${escapeHtml(ctaText || 'View Product →')}</a>` : ''

    if (imgs.length === 1) {
      body += `<div class="section">${heading}${paras}<div class="imgs">${imgHtml(imgs[0])}</div>${btn}</div>`
    } else {
      body += `<div class="section">${heading}${paras}${imgs.length > 0 ? `<div class="imgs">${imgs.map(imgHtml).join('')}</div>` : ''}${btn}</div>`
    }
  })

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`
}

function buildRoundupPreviewHTML(result, selected, heroImage, itemImages, productUrl, ctaText) {
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Questrial&family=Work+Sans:wght@400;500;600&display=swap');
    *{box-sizing:border-box}
    body{font-family:'Questrial',system-ui,'Helvetica Neue',Arial,sans-serif;max-width:800px;margin:0 auto;padding:28px 20px;color:#222222;line-height:1.75;background:#FFFFFF}
    h1{font-family:'Questrial',system-ui,sans-serif;font-size:2.2em;font-weight:400;line-height:1.15;margin:0 0 .3em;color:#222222;text-transform:uppercase;letter-spacing:0.03em}
    h2{font-family:'Questrial',system-ui,sans-serif;font-size:1.5em;font-weight:400;margin:0 0 .5em;color:#222222;text-transform:uppercase;letter-spacing:0.03em}
    p{margin:0 0 1em}
    .kw{font-family:'Work Sans',system-ui,sans-serif;font-size:.72em;font-weight:500;text-transform:uppercase;color:#666666;margin-bottom:2em;letter-spacing:0.18em}
    .hero{width:100%;display:block;margin-bottom:3em}
    .section{margin-top:3em;margin-bottom:4em;padding-bottom:4em;border-bottom:1px solid #EDE8DF}
    .section:last-child{border-bottom:none;padding-bottom:0}
    .col{display:flex;gap:2.5em;align-items:flex-start}
    .col .text{flex:6;min-width:0}
    .col .img{flex:4;min-width:0}
    .col .img img{width:100%;display:block}
    .imgs{display:flex;gap:1.2em;margin-top:1.5em;align-items:flex-start}
    .imgs a{flex:1;display:block;min-width:0;margin:0;text-decoration:none}
    .imgs figure{flex:1;width:0;min-width:0;margin:0}
    .imgs a figure{width:100%;flex:none}
    .imgs img{width:100%;display:block}
    figcaption{font-family:'Work Sans',system-ui,sans-serif;font-size:.72em;font-weight:400;color:#6E6C66;text-align:center;margin-top:.35em;letter-spacing:0.04em}
    .btn{font-family:'Work Sans',system-ui,sans-serif;display:inline-block;margin-top:1em;padding:.6em 1.4em;background:#6E2433;color:#F7F4EF;text-decoration:none;font-size:.82em;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;border-radius:0}
    @media(max-width:600px){.col{flex-direction:column}.imgs{flex-direction:column}.imgs figure{width:100%}}
  `
  const imgHtml = (img, alt = '', url = '') => {
    const fig = `<figure><img src="${img.file_url}" alt="${escapeHtml(img.alt_text || img.label || alt)}" />${img.caption || img.label ? `<figcaption>${escapeHtml(img.caption || img.label)}</figcaption>` : ''}</figure>`
    return url ? `<a href="${url}" target="_blank">${fig}</a>` : fig
  }

  let body = `<h1>${escapeHtml(result.seo_title)}</h1>`
  body += `<p class="kw">Focus keyword: ${escapeHtml(result.focus_keyword)} · Tags: ${(result.tags || []).map(escapeHtml).join(', ')}</p>`

  if (heroImage) {
    const heroEl = `<img class="hero" src="${heroImage.file_url}" alt="${escapeHtml(heroImage.alt_text || heroImage.label || '')}" />`
    body += productUrl ? `<a href="${productUrl}" target="_blank">${heroEl}</a>` : heroEl
  }

  if (result.intro?.body) {
    body += `<p>${escapeHtml(result.intro.body).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
  }

  result.items?.forEach((item, i) => {
    const product = selected[i]
    const imgs    = itemImages[product?.id] || []
    const linkUrl = item.item_url || ''  // per-item only; global URL is for button
    const heading = item.heading
      ? (linkUrl ? `<h2><a href="${linkUrl}" target="_blank">${escapeHtml(item.heading)}</a></h2>` : `<h2>${escapeHtml(item.heading)}</h2>`)
      : ''
    const paras = `<p>${escapeHtml(item.body || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`

    if (imgs.length === 1) {
      body += `<div class="section">${heading}${paras}<div class="imgs">${imgHtml(imgs[0], product?.name, linkUrl)}</div></div>`
    } else if (imgs.length >= 2) {
      body += `<div class="section">${heading}${paras}<div class="imgs">${imgs.map(img => imgHtml(img, product?.name, linkUrl)).join('')}</div></div>`
    } else {
      body += `<div class="section">${heading}${paras}</div>`
    }
  })

  if (result.conclusion) {
    const btn = productUrl ? `<a class="btn" href="${productUrl}" target="_blank">${escapeHtml(ctaText || 'Enquire Now →')}</a>` : ''
    body += `<div class="section"><h2>${escapeHtml(result.conclusion.heading)}</h2><p>${escapeHtml(result.conclusion.body || '').replace(/\n\n/g, '</p><p>')}</p>${btn}</div>`
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
            {[['desktop', 'Desktop', Monitor], ['mobile', 'Mobile', Smartphone]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => setViewport(key)}
                className={`inline-flex items-center gap-1 text-xs px-3 py-1 rounded transition-colors ${viewport === key ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                <Icon size={13} />{label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 leading-none px-1"><X size={22} /></button>
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

// ── Browser-side image compression (reliable — browser has no memory constraints) ─
function bufToBase64(buf) {
  let out = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(out)
}

async function compressForWP(firebaseUrl, imageType = 'content') {
  try {
    // Route through same-origin proxy to avoid Firebase Storage CORS restrictions
    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(firebaseUrl)}`
    const res = await fetch(proxyUrl)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const { width, height } = bitmap
    const ratio = width / height

    let tw, th
    if (imageType === 'hero') {
      tw = Math.min(width, 1200); th = Math.round(tw / ratio)
    } else if (ratio >= 0.85 && ratio <= 1.18) {
      tw = Math.min(width, 1000); th = Math.round(tw / ratio)
    } else if (width >= height) {
      tw = Math.min(width, 1200); th = Math.round(tw / ratio)
    } else {
      tw = Math.min(width, 1000); th = Math.round(tw / ratio)
    }

    const maxBytes = imageType === 'hero' ? 400 * 1024 : 200 * 1024
    const canvas = new OffscreenCanvas(tw, th)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, tw, th)
    bitmap.close()

    const qualities = imageType === 'hero'
      ? [0.88, 0.80, 0.70, 0.60, 0.50]
      : [0.85, 0.75, 0.65, 0.50, 0.35, 0.25]
    for (const q of qualities) {
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: q })
      if (out.size <= maxBytes) return { b64: bufToBase64(await out.arrayBuffer()), width: tw, height: th }
    }
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.20 })
    return { b64: bufToBase64(await out.arrayBuffer()), width: tw, height: th }
  } catch (err) {
    console.warn('compressForWP failed:', firebaseUrl, err?.message)
    return null
  }
}

async function preprocessPayload(payload) {
  const p = JSON.parse(JSON.stringify(payload))

  // Compress hero
  if (p.hero?.firebase_url) {
    const r = await compressForWP(p.hero.firebase_url, 'hero')
    if (r) { p.hero.b64 = r.b64; p.hero.width = r.width; p.hero.height = r.height }
  }

  // Compress all content images in parallel
  if (p.type === 'spotlight') {
    await Promise.all((p.content.sections || []).map(async s => {
      s.images = await Promise.all((s.images || []).map(async img => {
        const r = await compressForWP(img.firebase_url, 'content')
        if (r) { img.b64 = r.b64; img.width = r.width; img.height = r.height }
        return img
      }))
    }))
  } else if (p.type === 'roundup') {
    await Promise.all((p.content.items || []).map(async item => {
      item.images = await Promise.all((item.images || []).map(async img => {
        const r = await compressForWP(img.firebase_url, 'content')
        if (r) { img.b64 = r.b64; img.width = r.width; img.height = r.height }
        return img
      }))
    }))
  }

  return p
}

// ── WordPress publish button ──────────────────────────────────────────────────
function WPPublishButton({ payload, disabled }) {
  const [state, setState] = useState('idle')
  const [wpResult, setWpResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  async function handlePublish() {
    setState('compressing')
    setErrMsg('')
    try {
      const processedPayload = await preprocessPayload(payload)
      setState('publishing')
      const res = await fetch('/api/publish-to-wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processedPayload),
      })
      // Edge function may return HTML on crash — guard against non-JSON
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(`Server error (${res.status}): ${text.replace(/<[^>]*>/g, '').trim().slice(0, 200)}`)
      }
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
        <p className="flex items-center gap-1.5 text-sm font-semibold text-green-800"><Check size={15} />Draft published to WordPress!</p>
        <p className="text-xs text-green-700">{wpResult.images_uploaded}/{wpResult.images_total} images uploaded to Media Library</p>
        <div className="flex gap-2 flex-wrap">
          <a href={wpResult.edit_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-800 transition-colors"><Pencil size={12} />Edit in WordPress →</a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <button onClick={handlePublish} disabled={state === 'compressing' || state === 'publishing' || disabled}
        className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
        style={{ background: '#2563eb' }}>
        <span className="inline-flex items-center justify-center gap-1.5">
          {state === 'compressing'
            ? <><FileArchive size={15} />Compressing images…</>
            : state === 'publishing'
              ? <><Clock size={15} />Publishing draft…</>
              : <><Rocket size={15} />Publish Draft to WordPress</>}
        </span>
      </button>
      {state === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      <p className="text-xs text-gray-400 text-center">Images upload to WP Media Library for maximum SEO benefit</p>
    </div>
  )
}

// ── Per-section rewrite panel ─────────────────────────────────────────────────
function RewritePanel({ sectionType, heading, body, context, onRewrite }) {
  const [open, setOpen]         = useState(false)
  const [guidance, setGuidance] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleRewrite() {
    if (!guidance.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/rewrite-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_type: sectionType, heading, body, guidance, context }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onRewrite(data)
      setOpen(false)
      setGuidance('')
    } catch (err) {
      setError(err.message || 'Rewrite failed — please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-brand-600 transition-colors flex items-center gap-1">
        <RotateCcw size={12} />Rewrite
      </button>
    )
  }

  return (
    <div className="border border-brand-100 rounded-lg p-3 bg-brand-50 space-y-2 mt-1">
      <p className="text-xs font-medium text-brand-700">What should be different?</p>
      <textarea
        className="input text-sm w-full"
        rows={2}
        placeholder="e.g. Make it more focused on banking clients, shorter, lead with the engraving detail…"
        value={guidance}
        onChange={e => setGuidance(e.target.value)}
        autoFocus
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={handleRewrite} disabled={loading || !guidance.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors">
          {loading ? <span className="inline-flex items-center gap-1"><Pencil size={12} />Rewriting…</span> : <span className="inline-flex items-center gap-1"><RotateCcw size={12} />Rewrite</span>}
        </button>
        <button type="button" onClick={() => { setOpen(false); setGuidance('') }}
          className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
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
  const [productUrl, setProductUrl] = useState('')
  const [ctaText, setCtaText]       = useState('View Product →')

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
        // Blog posts are public — only images marked Public may be used.
        const imgs = snap.docs.map(d => d.data()).filter(isPublicVisible)
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
    hero: heroImage ? { firebase_url: heroImage.file_url, alt_text: heroImage.alt_text || heroImage.label || selectedProduct?.name || '' } : null,
    content: {
      ...result,
      product_name: selectedProduct?.name || '',
      product_url: productUrl.trim(),
      cta_text: ctaText.trim() || 'View Product →',
      sections: result.sections.map((s, i) => ({
        ...s,
        images: (sectionImages[i] || []).map(img => ({
          firebase_url: img.file_url,
          alt_text: img.alt_text || img.label || '',
          caption: img.caption || img.label || '',
        })),
        section_url: s.section_url?.trim() || '',
      }))
    }
  } : null

  const previewHTML = result ? buildSpotlightPreviewHTML(result, heroImage, sectionImages, productUrl, ctaText) : ''

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Enquiry / CTA URL <span className="text-gray-400 font-normal">(optional — adds a button at the end of the post)</span></label>
            <input className="input" type="url" value={productUrl} onChange={e => setProductUrl(e.target.value)} placeholder="https://crystocraft.com/products/..." />
          </div>
          <div>
            <label className="label">Button Text</label>
            <input className="input" value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="View Product →" />
          </div>
        </div>
        <button onClick={handleGenerate} disabled={!selectedId || loading} className="btn-primary w-full justify-center">
          {loading ? <span className="inline-flex items-center gap-1.5"><Pencil size={15} />Writing blog post…</span> : <span className="inline-flex items-center gap-1.5"><Sparkles size={15} />Generate Product Spotlight Post</span>}
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
                <RewritePanel
                  sectionType={s.type}
                  heading={s.heading}
                  body={s.body}
                  context={`Product: ${selectedProduct?.name || ''}\nCategory: ${selectedProduct?.category || ''}\nDescription: ${selectedProduct?.description || ''}`}
                  onRewrite={data => {
                    if (data.heading !== undefined) updateSection(i, 'heading', data.heading)
                    updateSection(i, 'body', data.body)
                  }}
                />
                <input className="input text-xs text-gray-500" type="url" value={s.section_url || ''} placeholder="Section link URL (overrides global — links images & heading)"
                  onChange={e => updateSection(i, 'section_url', e.target.value)} />

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
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                <Eye size={13} />Preview HTML
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
  const [products, setProducts]       = useState([])
  const [selected, setSelected]       = useState([])
  const [industry, setIndustry]       = useState('')
  const [tone, setTone]               = useState('professional and premium')
  const [result, setResult]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [productUrl, setProductUrl]   = useState('')
  const [ctaText, setCtaText]         = useState('Enquire Now →')
  // Image state
  const [productImageMap, setProductImageMap] = useState({}) // { productId: [imageObjects] }
  const [heroImage, setHeroImage]     = useState(null)
  const [itemImages, setItemImages]   = useState({}) // { productId: [imageObjects] }

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  async function toggleProduct(p) {
    const isSelected = selected.find(s => s.id === p.id)
    if (isSelected) {
      setSelected(prev => prev.filter(s => s.id !== p.id))
    } else if (selected.length < 7) {
      setSelected(prev => [...prev, p])
      // Fetch images for this product if not already cached
      if (!productImageMap[p.id]) {
        const snap = await getDocs(query(collection(db, 'products', p.id, 'images'), orderBy('sort_order')))
        // Public path: only Public-visibility images are eligible.
        const imgs = snap.docs.map(d => d.data()).filter(isPublicVisible)
        setProductImageMap(prev => ({ ...prev, [p.id]: imgs }))
      }
    }
  }

  // All images from all selected products (for hero picker)
  const allImages = selected.flatMap(p => productImageMap[p.id] || [])

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
  function setProductImgs(productId, imgs) {
    setItemImages(prev => ({ ...prev, [productId]: imgs }))
  }

  const wpPayload = result ? {
    type: 'roundup',
    hero: heroImage ? { firebase_url: heroImage.file_url, alt_text: heroImage.alt_text || heroImage.label || '' } : null,
    content: {
      ...result,
      product_url: productUrl.trim(),
      cta_text: ctaText.trim() || 'Enquire Now →',
      items: result.items.map((item, i) => {
        const p = selected[i]
        return {
          ...item,
          product_name: p?.name || '',
          item_url: item.item_url?.trim() || '',
          images: (itemImages[p?.id] || []).map(img => ({
            firebase_url: img.file_url,
            alt_text: img.alt_text || img.label || '',
            caption: img.caption || img.label || '',
            product_name: p?.name || '',
          }))
        }
      })
    }
  } : null

  const previewHTML = result ? buildRoundupPreviewHTML(result, selected, heroImage, itemImages, productUrl, ctaText) : ''

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
                    : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0 text-gray-300"><Package size={18} /></div>
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Enquiry / CTA URL <span className="text-gray-400 font-normal">(optional — adds a button after the conclusion)</span></label>
            <input className="input" type="url" value={productUrl} onChange={e => setProductUrl(e.target.value)} placeholder="https://crystocraft.com/products/..." />
          </div>
          <div>
            <label className="label">Button Text</label>
            <input className="input" value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="Enquire Now →" />
          </div>
        </div>
        <button onClick={handleGenerate} disabled={selected.length < 2 || loading} className="btn-primary w-full justify-center">
          {loading ? <span className="inline-flex items-center gap-1.5"><Pencil size={15} />Writing roundup…</span> : <span className="inline-flex items-center gap-1.5"><Sparkles size={15} />Generate Roundup · {selected.length} products</span>}
        </button>
        {selected.length < 2 && <p className="text-xs text-gray-400 text-center">Select at least 2 products</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          <EditableMeta result={result} onChange={setResult} />

          {/* Hero image picker */}
          <div className="card p-5 space-y-3">
            <div>
              <h3 className="font-semibold text-gray-800">Hero Image</h3>
              <p className="text-xs text-gray-400 mt-0.5">Full-width banner at the top + WordPress featured image. Choose from any selected product's images.</p>
            </div>
            {allImages.length > 0
              ? <HeroPicker images={allImages} value={heroImage} onChange={setHeroImage} />
              : <p className="text-xs text-gray-400">No images found — upload images to the selected products first.</p>
            }
          </div>

          {result.intro && (
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Introduction</h3>
                <CopyButton text={result.intro.body} />
              </div>
              <textarea className="input text-sm" rows={3} value={result.intro.body || ''}
                onChange={e => setResult(prev => ({ ...prev, intro: { ...prev.intro, body: e.target.value } }))} />
              <RewritePanel
                sectionType="intro"
                body={result.intro.body}
                context={`Post type: roundup\nProducts: ${selected.map(p => p.name).join(', ')}`}
                onRewrite={data => setResult(prev => ({ ...prev, intro: { ...prev.intro, body: data.body } }))}
              />
            </div>
          )}

          {result.items?.map((item, i) => {
            const product = selected[i]
            const productImages = productImageMap[product?.id] || []
            return (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {product?.heroImage && <img src={product.heroImage} alt="" className="w-7 h-7 rounded object-cover" />}
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Product {i + 1} · {product?.name}</span>
                  </div>
                  <CopyButton text={`${item.heading}\n\n${item.body}`} />
                </div>
                <input className="input text-sm font-medium" value={item.heading || ''} placeholder="Heading…"
                  onChange={e => updateItem(i, 'heading', e.target.value)} />
                <textarea className="input text-sm" rows={4} value={item.body || ''}
                  onChange={e => updateItem(i, 'body', e.target.value)} />
                <RewritePanel
                  sectionType="product_item"
                  heading={item.heading}
                  body={item.body}
                  context={`Product: ${product?.name || ''}\nCategory: ${product?.category || ''}\nDescription: ${product?.description || ''}`}
                  onRewrite={data => {
                    if (data.heading !== undefined) updateItem(i, 'heading', data.heading)
                    updateItem(i, 'body', data.body)
                  }}
                />
                <input className="input text-xs text-gray-500" type="url" value={item.item_url || ''} placeholder="Product link URL (overrides global — links images & heading)"
                  onChange={e => updateItem(i, 'item_url', e.target.value)} />

                {/* Per-product image picker */}
                <div className="border-t border-gray-50 pt-2">
                  <p className="text-xs text-gray-400 mb-1">
                    Section images <span className="text-gray-300">(0–3 · 1 image = right side, 2–3 = row below text)</span>
                  </p>
                  {productImages.length > 0
                    ? <SectionImagePicker
                        images={productImages}
                        heroImage={heroImage}
                        selected={itemImages[product?.id] || []}
                        onChange={imgs => setProductImgs(product.id, imgs)}
                      />
                    : <p className="inline-flex items-center gap-1 text-xs text-amber-500"><AlertTriangle size={12} />No images found for this product</p>
                  }
                </div>
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
              <RewritePanel
                sectionType="conclusion"
                heading={result.conclusion.heading}
                body={result.conclusion.body}
                context={`Post type: roundup\nProducts: ${selected.map(p => p.name).join(', ')}`}
                onRewrite={data => setResult(prev => ({
                  ...prev,
                  conclusion: {
                    heading: data.heading !== undefined ? data.heading : prev.conclusion.heading,
                    body: data.body,
                  }
                }))}
              />
            </div>
          )}

          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Publish to WordPress</h3>
              <button onClick={() => setShowPreview(true)}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                <Eye size={13} />Preview HTML
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
        {[{ key: 'spotlight', label: 'Product Spotlight', Icon: Flashlight, desc: 'One product, one post' },
          { key: 'roundup', label: 'Roundup Post', Icon: List, desc: 'Multiple products, one post' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <span className="inline-flex items-center gap-1.5"><t.Icon size={14} />{t.label}</span>
            <span className="block text-xs font-normal text-gray-400">{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'spotlight' ? <SpotlightTab preloadedProduct={preloadedProduct} /> : <RoundupTab />}
    </div>
  )
}
