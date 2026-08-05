import { useState, useRef, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  useCustomerAssets, uploadCustomerAsset, updateCustomerAsset, deleteCustomerAsset,
  loadBrandedProductImages,
  CATEGORIES, CATEGORY_LABEL, TYPES_BY_CATEGORY, VISIBILITIES, VISIBILITY_LABEL, TYPE_LABEL,
  usableInMarketing,
} from '../customerAssets'
import { IMAGE_VISIBILITY, imageVisibility } from '../constants'
import { ImagePlus, ShieldCheck, Lock, Globe, Megaphone, X, Trash2, ExternalLink } from 'lucide-react'

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
  internal_only:    { cls: 'bg-gray-100 text-gray-600', Icon: Lock },
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
        <h2 className="text-sm font-semibold text-gray-700">Brand Gallery ({assets.length})</h2>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1">
          <ImagePlus size={13} /> {uploading ? 'Uploading…' : `Add to ${CATEGORY_LABEL[category]}`}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
      </div>

      <div className="flex gap-1 border-b border-gray-100 mb-3 mt-2">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => switchCategory(c)}
                  className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
                    category === c ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {CATEGORY_LABEL[c]} ({assets.filter(a => a.category === c).length + (c === 'product_gallery' ? brandedImages.length : 0)})
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        {category === 'brand_asset'
          ? <>The customer's own logo &amp; guidelines.</>
          : <>Our photos of their branded product — check each one before opening it up; some are fine to reuse, some aren't.</>}
        {' '}New uploads default to <strong>Internal only</strong> — open them deliberately.
      </p>

      {category === 'product_gallery' && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">From Product Catalogue</h3>
          {brandedLoading ? (
            <p className="text-xs text-gray-400 py-2">Loading…</p>
          ) : brandedImages.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              No catalogue photos tagged for this customer yet. Tag one on a product's Images tab (look for "Branded for").
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {brandedImages.map(img => {
                const vis = imageVisibility(img)
                const visMeta = IMAGE_VISIBILITY.find(v => v.value === vis)
                return (
                  <Link key={img.id} to={`/products/${img.product_id}`}
                        className="group text-left rounded-lg border border-gray-100 overflow-hidden hover:border-brand-300 hover:shadow-sm transition-all block">
                    <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                      <img src={img.file_url} alt={img.caption || img.product_name} className="w-full h-full object-contain" />
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-gray-700 truncate inline-flex items-center gap-1">
                        {img.product_name || 'Untitled product'} <ExternalLink size={10} className="text-gray-300 group-hover:text-brand-500 shrink-0" />
                      </p>
                      <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${visMeta?.cls || 'bg-gray-200 text-gray-600'}`}>
                        {visMeta?.short || vis}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            Visibility and tagging for these are managed on the product itself, not here.
          </p>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-5">Additional Photos</h3>
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
        <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
      ) : inCategory.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          No {category === 'product_gallery' ? 'additional photos' : CATEGORY_LABEL[category].toLowerCase()} yet. <button onClick={() => fileRef.current?.click()} className="text-brand-600 hover:underline">Add one</button>.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Nothing matches those filters.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map(a => {
            const vb = VIS_BADGE[a.visibility] || VIS_BADGE.internal_only
            return (
              <button key={a.id} onClick={() => setEditing(a)}
                      className="group text-left rounded-lg border border-gray-100 overflow-hidden hover:border-brand-300 hover:shadow-sm transition-all">
                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                  <img src={a.file_url} alt={a.title || a.filename} className="w-full h-full object-contain" />
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-700 truncate">{a.title || a.filename}</p>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{TYPE_LABEL[a.type]}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${vb.cls}`}>
                      <vb.Icon size={9} />{VISIBILITY_LABEL[a.visibility]}
                    </span>
                    {usableInMarketing(a) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 inline-flex items-center gap-0.5">
                        <Megaphone size={9} />OK
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
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
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-sm font-semibold text-gray-800">Edit asset</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-100 aspect-video flex items-center justify-center overflow-hidden">
            <img src={asset.file_url} alt={asset.title || asset.filename} className="max-w-full max-h-full object-contain" />
          </div>
          <p className="text-[11px] text-gray-400 break-all">{asset.filename}</p>

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
            <p className="text-[11px] text-gray-400 mt-1">
              {f.visibility === 'internal_only' && 'Staff only — never shown to the customer or public.'}
              {f.visibility === 'customer_private' && 'Visible to this customer when they log in, and to staff.'}
              {f.visibility === 'public_reference' && 'May be shown publicly — still needs marketing consent below.'}
            </p>
          </div>
          <label className={`flex items-center gap-2 text-sm ${marketingAllowed ? 'text-gray-700' : 'text-gray-300'}`}>
            <input type="checkbox" disabled={!marketingAllowed}
                   checked={marketingAllowed && f.can_use_in_marketing}
                   onChange={e => setF(x => ({ ...x, can_use_in_marketing: e.target.checked }))}
                   className="w-4 h-4 rounded border-gray-300 text-brand-600" />
            Marketing consent — may appear in blog / case studies
          </label>
          {!marketingAllowed && <p className="text-[11px] text-gray-400 -mt-2">Only available on a Public reference asset.</p>}

          <div>
            <label className="label text-xs">Tags</label>
            <input className="input text-sm" value={f.tags} onChange={set('tags')} placeholder="banking, award (comma separated)" />
          </div>

          <div className="flex items-center justify-between pt-2">
            {confirmDel ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Delete permanently?</span>
                <button onClick={del} disabled={saving} className="text-xs text-white bg-red-500 hover:bg-red-600 rounded px-2 py-1">Yes, delete</button>
                <button onClick={() => setConfirmDel(false)} className="text-xs text-gray-500">Cancel</button>
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
