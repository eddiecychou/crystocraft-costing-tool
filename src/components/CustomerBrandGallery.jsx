import { useState, useRef, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  useCustomerAssets, uploadCustomerAsset, updateCustomerAsset, deleteCustomerAsset,
  loadBrandedProductImages, cannotRenderAsImage, ASSET_UPLOAD_ACCEPT,
  CATEGORIES, CATEGORY_LABEL, TYPES_BY_CATEGORY, VISIBILITIES, VISIBILITY_LABEL, TYPE_LABEL,
  usableInMarketing,
} from '../customerAssets'
import { IMAGE_VISIBILITY, imageVisibility } from '../constants'
import { ImagePlus, ShieldCheck, Lock, Globe, Megaphone, X, Trash2, ExternalLink, FileText, Download, ChevronDown, ChevronRight } from 'lucide-react'

const extOf = filename => (filename.match(/\.[^.]+$/)?.[0] || '').replace('.', '').toUpperCase()

// Reliable cross-origin download — a plain <a href=".." download> is silently
// ignored by most browsers for a different-origin URL (Firebase Storage is),
// so it just opens the file instead of saving it. Same Netlify proxy
// ImageGallery.jsx already relies on for this exact reason.
const downloadUrl = (fileUrl, filename) =>
  `/api/download-image?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename || 'file')}`

// A non-raster asset (.ai/.eps/.pdf/.pptx, and .svg which we deliberately
// never rasterize) can't render as an <img> thumbnail — show the file type
// instead of a broken image icon.
function AssetThumb({ asset, className = '' }) {
  if (cannotRenderAsImage(asset.filename)) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 text-white/80 ${className}`}>
        <FileText size={28} strokeWidth={1.5} />
        <span className="text-2xs font-medium">{extOf(asset.filename)}</span>
      </div>
    )
  }
  return <img src={asset.file_url} alt={asset.title || asset.filename} className={className} />
}

// Brand Gallery section on Customer Detail (Customer_Brand_Gallery_Spec.md §5.1).
// Admin-only surface: upload a customer's assets, set visibility + marketing
// consent, edit, delete. The privacy guarantee itself is the Firestore rule
// (spec §6); this is the curation UI behind it.
//
// Split into two categories (owner, 2026-08-05): "Brand Assets" (the
// customer's own logo/guidelines — low sensitivity once cleared) and
// "Product Gallery" (OUR photos of THEIR branded product — the sensitive one,
// needs a per-photo call, not a per-customer one). Same visibility/consent
// model underneath; the tabs are about which type list an admin picks from and
// keeping the two purposes visually distinct.

const VIS_BADGE = {
  internal_only:    { cls: 'bg-ivory-dark text-ink-70', Icon: Lock },
  customer_private: { cls: 'bg-amber-100 text-amber-700', Icon: ShieldCheck },
  public_reference: { cls: 'bg-emerald-100 text-emerald-700', Icon: Globe },
}

export default function CustomerBrandGallery({ customerId }) {
  const { assets, loading } = useCustomerAssets(customerId)
  const [category, setCategory] = useState('brand_asset')
  const [typeFilter, setTypeFilter] = useState('')
  const [visFilter, setVisFilter] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(null)   // asset open in the drawer
  const fileRef = useRef(null)
  // Collapsible (owner, post-launch: Customer Detail had grown too many
  // always-expanded sections) — per customer, survives a reload within the
  // same visit via sessionStorage, doesn't leak across customers/sessions.
  const [collapsed, setCollapsed] = useState(() => {
    try { return sessionStorage.getItem(`cd-collapse:${customerId}:brand-gallery`) === '1' } catch { return false }
  })
  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { sessionStorage.setItem(`cd-collapse:${customerId}:brand-gallery`, next ? '1' : '0') } catch {}
      return next
    })
  }

  // Catalogue photos tagged "branded for" this customer (ProductDetail.jsx) —
  // a SEPARATE source from the assets above. Shown inline in Product Gallery
  // so tagging a photo is the one action, not tag-there-then-upload-again-here.
  const [brandedImages, setBrandedImages] = useState([])
  const [brandedLoading, setBrandedLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setBrandedLoading(true)
    loadBrandedProductImages(customerId)
      .then(imgs => { if (alive) setBrandedImages(imgs) })
      .finally(() => { if (alive) setBrandedLoading(false) })
    return () => { alive = false }
  }, [customerId])

  const inCategory = useMemo(() => assets.filter(a => a.category === category), [assets, category])
  const filtered = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    return inCategory.filter(a => {
      if (typeFilter && a.type !== typeFilter) return false
      if (visFilter && a.visibility !== visFilter) return false
      if (q && ![a.title, a.filename, ...(a.tags || [])].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [inCategory, typeFilter, visFilter, tagQuery])

  // Grouped by type (Logo / Brand Guideline / ...), then by file extension
  // within each group — a dozen logos in mixed formats reads as chaos flat;
  // grouping by "what it is" first and "what format" second is the two axes
  // that actually matter for finding one (owner, 2026-08-06).
  const grouped = useMemo(() => {
    const byType = new Map()
    for (const a of filtered) {
      if (!byType.has(a.type)) byType.set(a.type, [])
      byType.get(a.type).push(a)
    }
    const extOf = f => (f.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
    for (const list of byType.values()) {
      list.sort((a, b) => extOf(a.filename).localeCompare(extOf(b.filename)) || a.filename.localeCompare(b.filename))
    }
    // Declared type order (Logo before Guideline, etc.), not insertion order.
    return TYPES_BY_CATEGORY[category]
      .map(t => [t, byType.get(t) || []])
      .filter(([, list]) => list.length > 0)
  }, [filtered, category])

  function switchCategory(c) { setCategory(c); setTypeFilter('') }

  async function onFiles(e) {
    const files = [...(e.target.files || [])]
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) await uploadCustomerAsset(customerId, f, { category })
    } catch (err) {
      alert(`Upload failed: ${err.message || err}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <button type="button" onClick={toggleCollapsed} className="flex items-center gap-1.5 min-w-0 text-left">
          {collapsed ? <ChevronRight size={15} className="text-ink-60 shrink-0" /> : <ChevronDown size={15} className="text-ink-60 shrink-0" />}
          <h2 className="text-sm text-ink-80 truncate">Brand Gallery ({assets.length})</h2>
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1 shrink-0">
          <ImagePlus size={13} /> {uploading ? 'Uploading…' : `Add to ${CATEGORY_LABEL[category]}`}
        </button>
        <input ref={fileRef} type="file" accept={ASSET_UPLOAD_ACCEPT} multiple className="hidden" onChange={onFiles} />
      </div>
      {!collapsed && (
      <>

      <div className="flex gap-1 border-b border-warm-grey mb-3 mt-2">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => switchCategory(c)}
                  className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
 category === c ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-70'}`}>
            {CATEGORY_LABEL[c]} ({assets.filter(a => a.category === c).length + (c === 'product_gallery' ? brandedImages.length : 0)})
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-60 mb-3">
        {category === 'brand_asset'
          ? <>The customer's own logo &amp; guidelines.</>
          : <>Our photos of their branded product — check each one before opening it up; some are fine to reuse, some aren't.</>}
        {' '}New uploads default to <strong>Internal only</strong> — open them deliberately.
      </p>

      {category === 'product_gallery' && (
        <div className="mb-4">
          <h3 className="text-xs text-ink-60 uppercase tracking-wide mb-2">From Product Catalogue</h3>
          {brandedLoading ? (
            <p className="text-xs text-ink-60 py-2">Loading…</p>
          ) : brandedImages.length === 0 ? (
            <p className="text-xs text-ink-60 py-2">
              No catalogue photos tagged for this customer yet. Tag one on a product's Images tab (look for "Branded for").
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {brandedImages.map(img => {
                const vis = imageVisibility(img)
                const visMeta = IMAGE_VISIBILITY.find(v => v.value === vis)
                return (
                  <div key={img.id} className="group rounded-none border border-warm-grey overflow-hidden hover:border-brand-300 transition-colors">
                    <Link to={`/products/${img.product_id}`} className="block">
                      <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                        <img src={img.file_url} alt={img.caption || img.product_name} className="w-full h-full object-contain" />
                      </div>
                    </Link>
                    <div className="p-2">
                      <Link to={`/products/${img.product_id}`} className="text-xs text-ink-80 truncate inline-flex items-center gap-1 hover:text-brand-600">
                        {img.product_name || 'Untitled product'} <ExternalLink size={10} className="text-platinum group-hover:text-brand-500 shrink-0" />
                      </Link>
                      <div className="flex items-center justify-between mt-1">
                        <span className={`inline-block text-2xs px-1.5 py-0.5 rounded-full font-medium ${visMeta?.cls || 'bg-warm-grey text-ink-70'}`}>
                          {visMeta?.short || vis}
                        </span>
                        <a href={downloadUrl(img.file_url, `${img.product_name || 'product'}.jpg`)}
                           title="Download" className="text-ink-60 hover:text-brand-600">
                          <Download size={12} />
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-2xs text-ink-60 mt-2">
            Visibility and tagging for these are managed on the product itself, not here.
          </p>
          <h3 className="text-xs text-ink-60 uppercase tracking-wide mb-2 mt-5">Additional Photos</h3>
        </div>
      )}

      {inCategory.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className="input text-xs w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES_BY_CATEGORY[category].map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select className="input text-xs w-auto" value={visFilter} onChange={e => setVisFilter(e.target.value)}>
            <option value="">All visibility</option>
            {VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </select>
          <input className="input text-xs flex-1 min-w-[140px]" placeholder="Search title / tag…"
                 value={tagQuery} onChange={e => setTagQuery(e.target.value)} />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-60 py-6 text-center">Loading…</p>
      ) : inCategory.length === 0 ? (
        <p className="text-sm text-ink-60 py-6 text-center">
          No {category === 'product_gallery' ? 'additional photos' : CATEGORY_LABEL[category].toLowerCase()} yet. <button onClick={() => fileRef.current?.click()} className="text-brand-600 hover:underline">Add one</button>.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-60 py-6 text-center">Nothing matches those filters.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([type, list]) => (
            <div key={type}>
              {grouped.length > 1 && (
                <h4 className="text-2xs text-ink-60 uppercase tracking-wide mb-2">
                  {TYPE_LABEL[type]} ({list.length})
                </h4>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {list.map(a => {
                  const vb = VIS_BADGE[a.visibility] || VIS_BADGE.internal_only
                  return (
                    <div key={a.id} className="group text-left rounded-none border border-warm-grey overflow-hidden hover:border-brand-300 transition-colors">
                      <button type="button" onClick={() => setEditing(a)} className="block w-full text-left">
                        <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
                          <AssetThumb asset={a} className="w-full h-full object-contain" />
                        </div>
                        <div className="px-2 pt-2">
                          <p className="text-xs text-ink-80 truncate">{a.title || a.filename}</p>
                        </div>
                      </button>
                      <div className="px-2 pb-2">
                        <div className="flex items-center justify-between gap-1 mt-1 flex-wrap">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-ivory-dark text-ink-60">{TYPE_LABEL[a.type]} · {extOf(a.filename)}</span>
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${vb.cls}`}>
                              <vb.Icon size={9} />{VISIBILITY_LABEL[a.visibility]}
                            </span>
                            {usableInMarketing(a) && (
                              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 inline-flex items-center gap-0.5">
                                <Megaphone size={9} />OK
                              </span>
                            )}
                          </div>
                          <a href={downloadUrl(a.file_url, a.filename)}
                             title="Download" className="shrink-0 text-ink-60 hover:text-brand-600">
                            <Download size={12} />
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {editing && (
        <AssetDrawer customerId={customerId} asset={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function AssetDrawer({ customerId, asset, onClose }) {
  const [f, setF] = useState({
    category: asset.category, type: asset.type, visibility: asset.visibility,
    can_use_in_marketing: asset.can_use_in_marketing,
    title: asset.title || '', tags: (asset.tags || []).join(', '),
  })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  function setCategory(cat) {
    setF(x => ({ ...x, category: cat, type: TYPES_BY_CATEGORY[cat][0] }))
  }

  // Consent only means anything on a public asset; keep the data honest.
  const marketingAllowed = f.visibility === 'public_reference'

  async function save() {
    setSaving(true)
    try {
      await updateCustomerAsset(customerId, asset.id, {
        category: f.category, type: f.type, visibility: f.visibility,
        can_use_in_marketing: marketingAllowed && f.can_use_in_marketing,
        title: f.title,
        tags: f.tags.split(',').map(s => s.trim()).filter(Boolean),
      })
      onClose()
    } finally { setSaving(false) }
  }

  async function del() {
    setSaving(true)
    try { await deleteCustomerAsset(customerId, asset); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey sticky top-0 bg-white">
          <h3 className="text-sm text-ink">Edit asset</h3>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-none bg-ivory-dark border border-warm-grey aspect-video flex items-center justify-center overflow-hidden">
            <AssetThumb asset={asset} className="max-w-full max-h-full object-contain" />
          </div>
          <p className="text-2xs text-ink-60 break-all">
            {asset.filename}{' — '}
            <a href={asset.file_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">view</a>
            {' · '}
            <a href={downloadUrl(asset.file_url, asset.filename)} className="text-brand-600 hover:underline">download</a>
          </p>

          <div>
            <label className="label text-xs">Title</label>
            <input className="input text-sm" value={f.title} onChange={set('title')} placeholder="e.g. Primary logo (dark)" />
          </div>
          <div>
            <label className="label text-xs">Category</label>
            <select className="input text-sm" value={f.category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Type</label>
            <select className="input text-sm" value={f.type} onChange={set('type')}>
              {TYPES_BY_CATEGORY[f.category].map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Visibility</label>
            <select className="input text-sm" value={f.visibility} onChange={set('visibility')}>
              {VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
            </select>
            <p className="text-2xs text-ink-60 mt-1">
              {f.visibility === 'internal_only' && 'Staff only — never shown to the customer or public.'}
              {f.visibility === 'customer_private' && 'Visible to this customer when they log in, and to staff.'}
              {f.visibility === 'public_reference' && 'May be shown publicly — still needs marketing consent below.'}
            </p>
          </div>
          <label className={`flex items-center gap-2 text-sm ${marketingAllowed ? 'text-ink-80' : 'text-platinum'}`}>
            <input type="checkbox" disabled={!marketingAllowed}
                   checked={marketingAllowed && f.can_use_in_marketing}
                   onChange={e => setF(x => ({ ...x, can_use_in_marketing: e.target.checked }))}
                   className="w-4 h-4 rounded-none border-warm-grey text-brand-600" />
            Marketing consent — may appear in blog / case studies
          </label>
          {!marketingAllowed && <p className="text-2xs text-ink-60 -mt-2">Only available on a Public reference asset.</p>}

          <div>
            <label className="label text-xs">Tags</label>
            <input className="input text-sm" value={f.tags} onChange={set('tags')} placeholder="banking, award (comma separated)" />
          </div>

          <div className="flex items-center justify-between pt-2">
            {confirmDel ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Delete permanently?</span>
                <button onClick={del} disabled={saving} className="text-xs text-white bg-red-500 hover:bg-red-600 rounded-none px-2 py-1">Yes, delete</button>
                <button onClick={() => setConfirmDel(false)} className="text-xs text-ink-60">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="text-xs text-red-500 hover:text-red-700 inline-flex items-center gap-1">
                <Trash2 size={13} /> Delete
              </button>
            )}
            <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
