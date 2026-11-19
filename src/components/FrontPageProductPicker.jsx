import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { normGallery } from '../constants'
import { Check, Search } from 'lucide-react'

// Two-step "pick a product, then pick one of its gallery photos" modal for
// the homepage Featured Products picker — same shape as LineImagePicker.jsx,
// extended to search BOTH catalogues (range_products AND products), since a
// featured showcase mixes figurines and corporate gifts (CatalogueBand.jsx's
// dual-catalogue product loading is the precedent for unifying the two
// shapes into one search list).
//
// Corporate-gift images are filtered to isStorefrontVisible() and exclude
// anything tagged branded_for_customer_id — this list is a manual choice
// that goes on the PUBLIC homepage every customer sees, so a photo branded
// for one specific client must never even be selectable here (the same leak
// this codebase has hit twice before in other surfaces — see
// sensitiveImages.js and CorporateShop.jsx's resolveSafeImage comment).
export default function FrontPageProductPicker({ initialProduct = null, currentImage, onSelect, onClose }) {
  const [products, setProducts] = useState(null) // null = loading
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(initialProduct)      // { id, type, name } whose gallery is open
  const [images, setImages] = useState([])
  const [imgLoading, setImgLoading] = useState(true)
  const [selected, setSelected] = useState(currentImage || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  useEffect(() => {
    if (chosen || products) return
    let active = true
    Promise.all([
      getDocs(collection(db, 'range_products')),
      getDocs(collection(db, 'products')),
    ]).then(([rangeSnap, corpSnap]) => {
      const range = rangeSnap.docs.map(d => {
        const p = d.data()
        return {
          id: d.id, type: 'range',
          name: p.design_name || p.description || p.design_code || d.id,
          cat: p.design_type || p.category || '',
          image: normGallery(p.gallery)[0]?.url || '',
          active: p.active !== false && p.status !== 'retired',
        }
      })
      const corp = corpSnap.docs.map(d => {
        const p = d.data()
        return {
          id: d.id, type: 'corp_gift',
          name: p.name || d.id,
          cat: p.category || '',
          image: p.heroImage || '',
          active: p.active !== false && !['retired', 'discontinued'].includes(p.status),
        }
      })
      if (active) setProducts([...range, ...corp].filter(p => p.active))
    }).catch(() => { if (active) setError('Could not load products. Close the picker and try again.') })
    return () => { active = false }
  }, [chosen, products])

  useEffect(() => {
    if (!chosen) return
    let active = true
    setImages([]); setImgLoading(true); setError('')
    async function load() {
      if (chosen.type === 'corp_gift') {
        const snap = await getDocs(query(collection(db, 'products', chosen.id, 'images'), orderBy('sort_order')))
        return snap.docs.map(d => d.data())
          .filter(im => im.file_url && (!im.visibility || ['public', 'private'].includes(im.visibility)) && !im.branded_for_customer_id)
          .map(im => ({url: im.file_url, caption: im.caption}))
      }
      const p = (await getDoc(doc(db, 'range_products', chosen.id))).data()
      if (!p || p.active === false || p.status === 'retired') return []
      const variants = p.variants?.length ? p.variants : p.finishes || []
      return [...normGallery(p.gallery), ...variants.flatMap(v => [
        {url: v?.image, caption: v?.plating_name || v?.finish_name},
        ...(v?.crystal_colors || []).map(c => ({url: v.colour_images?.[c], caption: c})),
      ])].filter(im => im.url)
    }
    load().then(rows => {
      if (active) setImages([...new Map(rows.map(im => [im.url, im])).values()])
    }).catch(() => { if (active) setError('Could not load photos. Close the picker and try again.') })
      .finally(() => { if (active) setImgLoading(false) })
    return () => { active = false }
  }, [chosen])

  const current = initialProduct?.type === chosen?.type && initialProduct?.id === chosen?.id ? currentImage : ''
  async function save(url) {
    if (saving) return
    setSaving(true); setError('')
    try { await onSelect({product_type: chosen.type, product_id: chosen.id, image_url: url}) }
    catch (e) { setError(e.message || 'Could not save the display image. Please try again.') }
    finally { setSaving(false) }
  }

  const filtered = (products || []).filter(p =>
    !search
    || p.name?.toLowerCase().includes(search.toLowerCase())
    || p.cat?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <dialog ref={dialog} aria-labelledby="featured-picker-heading" onCancel={e => { e.preventDefault(); if (!saving) onClose() }}
      className="w-11/12 max-w-lg p-0 bg-white text-ink backdrop:bg-black/50">
      <div className="bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey">
          <h2 id="featured-picker-heading" className="text-ink text-sm">
            {chosen ? `Choose a photo — ${chosen.name}` : 'Pick a product to feature'}
          </h2>
          <button type="button" aria-label="Close picker" disabled={saving} onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">×</button>
        </div>

        {!chosen && (
          <div className="px-4 pt-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-platinum" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search figurine or corporate gift products…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-warm-grey rounded-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-4">
          {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
          {chosen ? (
            imgLoading ? <p className="text-sm text-ink-60 text-center py-8">Loading photos…</p>
            : images.length === 0 && !error ? (
              <p className="text-sm text-ink-60 text-center py-6">
                No storefront-safe photos found for this product. {chosen.type === 'corp_gift' && 'Check its images aren’t all marked Internal or branded for a specific customer.'}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img, i) => (
                  <button key={img.url} type="button" disabled={saving}
                    aria-label={img.caption || `Photo ${i + 1}`} aria-pressed={selected === img.url}
                    onClick={() => initialProduct ? setSelected(img.url) : save(img.url)}
                    className={`relative aspect-square bg-ivory overflow-hidden border-2 focus-visible:outline-brand-600 ${selected === img.url ? 'border-brand-600' : 'border-transparent hover:border-brand-300'}`}>
                    <img src={img.url} alt="" className="w-full h-full object-contain" />
                    {img.url === current && <span className="absolute bottom-0 left-0 bg-white px-1.5 py-0.5 text-xs text-ink">Current</span>}
                    {selected === img.url && <Check size={18} className="absolute top-1 right-1 bg-brand-600 p-0.5 text-white" />}
                  </button>
                ))}
              </div>
            )
          ) : products === null && !error ? (
            <p className="text-sm text-ink-60 text-center py-8">Loading products…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-6">No matching products.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map(p => (
                <button key={`${p.type}-${p.id}`} type="button" onClick={() => { setSelected(''); setError(''); setChosen(p) }}
                  className="w-full flex items-center gap-3 p-2 rounded-none hover:bg-ivory text-left">
                  <div className="w-10 h-10 rounded-none bg-ivory-dark shrink-0 overflow-hidden">
                    {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink truncate">{p.name}</p>
                    <p className="text-xs text-ink-60 truncate">{p.cat}</p>
                  </div>
                  <span className={`text-2xs px-1.5 py-0.5 rounded-none uppercase tracking-wide shrink-0 ${p.type === 'range' ? 'bg-brand-50 text-brand-700' : 'bg-sapphire/10 text-sapphire'}`}>
                    {p.type === 'range' ? 'Figurine' : 'Corporate'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {chosen && (
          <div className="px-4 py-3 border-t border-warm-grey flex flex-wrap justify-between gap-2">
            <button type="button" disabled={saving} onClick={() => { setChosen(null); setImages([]); setSelected(''); setError('') }}
              className="btn-secondary text-xs py-1.5 px-3">{initialProduct ? 'Change product' : '← Back to products'}</button>
            {initialProduct && <button type="button" className="btn-primary text-xs" disabled={saving || selected === current || !images.some(im => im.url === selected)}
              onClick={() => save(selected)}>{saving ? 'Saving…' : 'Save image'}</button>}
          </div>
        )}
      </div>
    </dialog>
  )
}
