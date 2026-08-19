import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, doc, getDoc, getDocs } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db, auth } from '../firebase'
import { Package } from 'lucide-react'
import { useRates, convertFromHKD, fmtMoney } from '../currency'
import { isNew, newFirst } from '../newArrivals'
import { productStatusOf, isStorefrontVisible } from '../constants'
import CollectionBand from './CollectionBand'
import { collectionProducts } from '../catalogueCollections'
import FavHeart from './FavHeart'
import LoadingBar from '../components/LoadingBar'
import { screenSensitiveImages } from '../sensitiveImages'
import CardImageCarousel from '../components/CardImageCarousel'

// Resolve the image a SENSITIVE viewer is actually allowed to see for one
// product. Shared by every place in this file that renders a product image
// — the "Shop by" band (bandItems below) was found to be a SECOND leak
// surface using the same unscreened p.heroImage directly (owner,
// 2026-08-07: "I can still see the product images tagged for brands of
// other customers").
//
// screenSensitiveImages() filters CLIENT-SIDE, after the fetch — do not
// remove this and trust the Firestore rule alone. Confirmed empirically
// (see sensitiveImages.js's header comment: minted a real auth token for
// Sunlife's own account and ran the exact list query her browser runs) that
// the rule does NOT reliably filter this kind of unconstrained collection
// list per-document, even though it correctly gates a direct single-doc
// read. Two earlier attempts at this exact fix both still leaked in
// production because they trusted the rule to have already done this.
// Returns EVERY storefront-visible image this viewer may see for one product,
// hero first — the card carousel (CardImageCarousel) pages through the whole
// list, and imageFor() below still takes [0] wherever a single image is all
// that's needed (the "Shop by" band, the favourites payload).
//
// COST NOTE: this now runs for every viewer, not just sensitive ones — a
// carousel needs the full list, and p.heroImage alone can't provide it. That
// is one extra subcollection read per product on this page (~115 today) where
// a non-sensitive viewer previously did zero. Deliberate tradeoff for the
// swipe-through-photos-on-the-card feature; if the catalogue grows enough for
// that to matter, the fix is a denormalised image-URL array on the product
// doc, not dropping the screening.
async function resolveSafeImages(productId, heroImage, profile) {
  try {
    const snap = await getDocs(query(collection(db, 'products', productId, 'images'), orderBy('sort_order')))
    const imgs = screenSensitiveImages(snap.docs.map(d => d.data()), profile)
      .filter(im => im.file_url && isStorefrontVisible(im))
    const urls = imgs.map(im => ({ url: im.file_url, caption: im.caption || '' }))
    // Hero first when it survived screening; otherwise the list stands on its
    // own (a sensitive viewer whose hero was blocked sees the next allowed
    // photo first, exactly as before).
    const heroOk = heroImage && urls.some(u => u.url === heroImage)
    return heroOk
      ? [{ url: heroImage, caption: '' }, ...urls.filter(u => u.url !== heroImage)]
      : urls
  } catch {
    return []
  }
}

export default function CorporateShop({ profile }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  // Filters persist across a detail visit so returning keeps your search/category.
  const [search, setSearch] = useState(() => sessionStorage.getItem('cs-search') || '')
  const [cat, setCat] = useState(() => sessionStorage.getItem('cs-cat') || '')
  const [coll, setColl] = useState(null)
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'
  const sensitive = !!profile?.sensitive

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setProducts(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.active !== false && productStatusOf(p.status).value !== 'retired')
          // New-tagged products first (C0), then alphabetical.
          .sort((a, b) => newFirst(a, b) || (a.name || '').localeCompare(b.name || ''))
      )
      setLoading(false)
    }, () => setLoading(false))
  }, [profile?.sensitive, profile?.customer_id])

  // One shared resolution pass for the whole product list — the card grid,
  // the card carousel and the "Shop by" band all read from this instead of
  // each re-deriving (or, previously, one of them skipping the sensitive
  // check entirely). Runs for EVERY viewer now, not only sensitive ones —
  // see resolveSafeImages's cost note.
  const [safeImagesByProductId, setSafeImagesByProductId] = useState({})
  // Whether the resolution pass has finished for the CURRENT product list —
  // used to hold the grid back until we actually know which products have
  // no safe photo at all, rather than flashing a photo-less card and then
  // yanking it away a moment later.
  const [safeImagesReady, setSafeImagesReady] = useState(false)
  useEffect(() => {
    if (products.length === 0) { setSafeImagesByProductId({}); setSafeImagesReady(false); return }
    let alive = true
    setSafeImagesReady(false)
    Promise.all(products.map(p => resolveSafeImages(p.id, p.heroImage, profile).then(imgs => [p.id, imgs])))
      .then(entries => { if (alive) { setSafeImagesByProductId(Object.fromEntries(entries)); setSafeImagesReady(true) } })
    return () => { alive = false }
  }, [products, profile?.sensitive, profile?.customer_id])

  const imagesFor = p => safeImagesByProductId[p.id] || []
  const imageFor = p => imagesFor(p)[0]?.url || ''

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
  // Light list the Shop-by band can render image tiles from.
  const bandItems = useMemo(() => products.map(p => ({
    id: p.id, category: p.category || '', is_new: !!p.is_new, image: imageFor(p), name: p.name || '',
  })), [products, sensitive, safeImagesByProductId])
  const filtered = useMemo(() => {
    const base = coll ? collectionProducts(coll, products, 'corp_gift') : products
    return base.filter(p => {
      const q = search.toLowerCase()
      const ms = !q || p.name?.toLowerCase().includes(q)
      if (!ms || (!coll && cat && p.category !== cat)) return false
      // Owner, 2026-08-07: "for the items that doesn't have enough fallback
      // images after the branded ones are taken out, it should be hidden
      // instead of showing the products without photos." A product with NO
      // safe image left for this sensitive viewer (every photo either IS
      // the branded one or was screened out with it) is dropped from the
      // shelf entirely, rather than shown as an empty box — same call
      // already made for a genuinely-imageless product elsewhere in this
      // app, just now also covering "imageless because of screening."
      if (sensitive && !imageFor(p)) return false
      return true
    })
  }, [products, coll, search, cat, sensitive, safeImagesByProductId])

  // After returning from a product detail, scroll the last-opened card back into
  // view so you can carry on browsing where you left off.
  useEffect(() => {
    if (loading || !safeImagesReady) return
    const lastId = sessionStorage.getItem('cs-last-id')
    if (!lastId) return
    const el = document.getElementById(`corp-card-${lastId}`)
    if (el) { el.scrollIntoView({ block: 'center' }); sessionStorage.removeItem('cs-last-id') }
  }, [loading, filtered, safeImagesReady])

  // Held back until the resolution pass finishes, so the grid never flashes a
  // would-be-hidden card (sensitive viewer) or a hero-only card that then
  // gains its carousel a moment later.
  const stillResolving = !safeImagesReady

  return (
    <div>
      {(loading || stillResolving) && <LoadingBar />}
      <div className="mb-2">
        <p className="eyebrow tracking-[0.08em] text-bronze mb-1.5">Catalogue</p>
        <h1 className="text-2xl md:text-3xl text-ink">Corporate Gifts</h1>
        <p className="text-sm text-ink-60 mt-0.5">{filtered.length} products · indicative prices in {cur}</p>
      </div>
      <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 mb-5">
        Corporate gifts are made to order. Prices shown are indicative reference points only — final pricing varies
        by specification, quantity and customisation. Contact us for a quotation.
      </div>
      <CollectionBand catalogue="corp_gift" products={bandItems} active={coll}
        onApply={c => { setColl(c); setCat(''); window.scrollTo({ top: 0 }) }} />
      {coll && (
        <div className="flex items-center justify-between gap-2 mb-4 px-3 py-2 rounded-md bg-ink/5 border border-ivory-dark">
          <span className="text-sm text-ink-80">Showing <span className="font-medium">{coll.title}</span></span>
          <button onClick={() => setColl(null)} className="text-sm text-ink-60 hover:text-ink shrink-0">Clear</button>
        </div>
      )}
      <div className="mb-5 space-y-2.5">
        <input type="text" placeholder="Search products…" className="input w-full sm:max-w-xs"
          value={search} onChange={e => { setSearch(e.target.value); sessionStorage.setItem('cs-search', e.target.value) }} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setColl(null); setCat(''); sessionStorage.setItem('cs-cat', '') }}
            className={(coll ? false : cat === '') ? 'tag-active' : 'tag-clickable'}>All categories</button>
          {categories.map(c => (
            <button key={c} type="button" onClick={() => { setColl(null); setCat(c); sessionStorage.setItem('cs-cat', c) }}
              className={(!coll && cat === c) ? 'tag-active' : 'tag-clickable'}>{c}</button>
          ))}
        </div>
      </div>
      {stillResolving ? null : filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No products match your search.</div>
      ) : (
        <div className="mosaic-grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map(p => (
            <CorpCard key={p.id} p={p} cur={cur} rates={rates} profile={profile}
              images={imagesFor(p)} />
          ))}
        </div>
      )}
    </div>
  )
}

function CorpCard({ p, cur, rates, profile, images }) {
  const displayImage = images[0]?.url || null
  const [fromPrice, setFromPrice] = useState(undefined) // undefined=loading, null=none

  useEffect(() => {
    const uid = profile?.id || auth.currentUser?.uid
    if (!uid) { setFromPrice(null); return }
    getDoc(doc(db, 'products', p.id, 'customer_prices', uid))
      .then(s => {
        const hkds = (s.exists() ? (s.data().tiers || []) : []).map(t => t.price_hkd).filter(v => v != null).map(Number)
        setFromPrice(hkds.length ? convertFromHKD(Math.min(...hkds), profile, rates) : null)
      })
      .catch(() => setFromPrice(null))
  }, [p.id, cur, rates, profile?.id, profile?.fx_rate])

  return (
    <Link id={`corp-card-${p.id}`} to={`/shop/corporate/${p.id}`}
      onClick={() => sessionStorage.setItem('cs-last-id', p.id)}
      className="mosaic-tile flex flex-col hover:shadow-md transition-shadow">
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden relative">
        <CardImageCarousel images={images} alt={p.name}
          fallback={<Package size={32} strokeWidth={1.25} className="text-gray-300" />} />
        {isNew(p) && (
          <span className="absolute top-1.5 left-1.5 badge-active" title="New arrival">New</span>
        )}
        <FavHeart item={{ type: 'corporate', id: p.id, name: p.name, code: '', image: displayImage || '' }}
          className="absolute top-1.5 right-1.5" />
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3 className="text-sm leading-tight text-ink line-clamp-2" title={p.name}>{p.name}</h3>
        <p className="text-[11px] text-ink-50">{p.category}</p>
        {p.description && <p className="text-[11px] text-ink-60 line-clamp-2">{p.description}</p>}
        <div className="mt-auto pt-1.5">
          {fromPrice === undefined ? <span className="text-xs text-ink-40">…</span>
            : fromPrice == null ? <span className="text-xs text-ink-40 italic">Enquire for pricing</span>
            : <span className="text-sm text-ink"><span className="text-[11px] text-ink-50">from </span>{fmtMoney(fromPrice, cur)}</span>}
        </div>
      </div>
    </Link>
  )
}
