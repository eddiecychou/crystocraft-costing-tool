import { useState, useEffect } from 'react'
import { doc, onSnapshot, getDoc, collection, query, orderBy } from 'firebase/firestore'
import { useParams, Link } from 'react-router-dom'
import { db, auth } from '../firebase'
import { Package, ArrowLeft, Check, Plus, Sparkles } from 'lucide-react'
import { useRates, convertFromHKD, fmtMoney } from '../currency'
import FavHeart from './FavHeart'
import { useCart } from './store'
import LoadingBar from '../components/LoadingBar'
import VideoEmbed from '../components/VideoEmbed'
import { isStorefrontVisible, normVideos, youtubeEmbed } from '../constants'
import { engineTypeOf, engineAvailable, engineLabel } from '../customizerEngines'
import { screenSensitiveImages } from '../sensitiveImages'
import ImageLightbox from '../components/ImageLightbox'

export default function CorporateDetail({ profile }) {
  const { id } = useParams()
  const [p, setP] = useState(undefined)
  const [images, setImages] = useState([])
  const [tiers, setTiers] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const rates = useRates()
  const cart = useCart()
  const cur = profile?.base_currency || 'USD'

  useEffect(() => onSnapshot(doc(db, 'products', id),
    s => setP(s.exists() ? { id: s.id, ...s.data() } : null), () => setP(null)), [id])

  useEffect(() => onSnapshot(
    query(collection(db, 'products', id, 'images'), orderBy('sort_order')),
    // screenSensitiveImages: the Firestore rule does NOT reliably filter
    // this list query per-document for a sensitive viewer — confirmed
    // empirically, see sensitiveImages.js's header comment. Filtered again
    // here, client-side, right at the fetch boundary so nothing downstream
    // in this file can accidentally see an unfiltered `images`.
    snap => setImages(screenSensitiveImages(snap.docs.map(d => ({ id: d.id, ...d.data() })), profile)),
    () => setImages([])
  ), [id, profile?.sensitive, profile?.customer_id])

  useEffect(() => {
    const uid = profile?.id || auth.currentUser?.uid
    if (!uid) { setTiers([]); return }
    // Prices are published per-customer (cost × this customer's markup), so we
    // read only this customer's own price doc — raw cost is never sent here.
    getDoc(doc(db, 'products', id, 'customer_prices', uid))
      .then(s => {
        const list = s.exists() ? (s.data().tiers || []) : []
        setTiers(list.filter(t => t.price_hkd != null).sort((a, b) => (a.quantity || 0) - (b.quantity || 0)))
      })
      .catch(() => setTiers([]))
  }, [id, profile?.id])

  if (p === undefined) return <LoadingBar />
  if (p === null) return (
    <div className="text-center py-20 text-ink-60">
      <p>This product is no longer available.</p>
      <Link to="/shop/corporate" className="text-brand-600 text-sm mt-2 inline-block">Back to catalogue</Link>
    </div>
  )

  // p.heroImage is a plain cached URL on the product doc — it bypasses the
  // images subcollection entirely, so it needs its own explicit check
  // against the tag on whichever image doc actually IS the hero (found via
  // matching file_url, since `images` here is already screenSensitiveImages()-
  // filtered at the fetch above — see that effect's comment for the full
  // "why", including the empirical proof the Firestore rule alone doesn't
  // do this). If the hero's URL isn't in the (already-filtered) `images`,
  // it was blocked — same derivation as before, just no longer trusting the
  // rule to have done the filtering; the filter already ran client-side.
  const heroBlocked = !!(profile?.sensitive && p.heroImage && !images.some(im => im.file_url === p.heroImage))
  const visibleImages = images.filter(im => im.file_url && isStorefrontVisible(im))
  const displayHero = heroBlocked ? (visibleImages[0]?.file_url || null) : (p.heroImage || null)

  // Show all storefront-visible images except whichever one is the hero.
  const gallery = visibleImages.filter(im => im.file_url !== displayHero)

  // Carousel order: hero first (if any), then the gallery — same order the
  // page already displays them in, just also click-able (bug-fix pack D-02).
  const carouselImages = [
    ...(displayHero ? [{ url: displayHero, caption: '' }] : []),
    ...gallery.map(im => ({ url: im.file_url, caption: im.caption || '' })),
  ]

  const inCart = cart?.has({ type: 'corporate', id: p.id })
  const tierQtys = tiers.map(t => Number(t.quantity) || 0).filter(q => q > 0)
  const minQty = tierQtys.length ? Math.min(...tierQtys) : 0

  return (
    <div>
      <Link to="/shop/corporate" className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to Corporate Gifts
      </Link>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="card overflow-hidden bg-gray-100 aspect-square flex items-center justify-center relative">
          {displayHero ? (
            <img src={displayHero} alt={p.name} className="w-full h-full object-cover cursor-zoom-in"
                 onClick={() => setLightboxIndex(0)} />
          ) : <Package size={56} className="text-gray-300" />}
          <FavHeart item={{ type: 'corporate', id: p.id, name: p.name, code: '', image: displayHero || '' }} className="absolute top-3 right-3" />
        </div>
        <div>
          {p.category && <p className="eyebrow tracking-[0.08em] text-bronze mb-1.5">{p.category}</p>}
          <h1 className="text-xl md:text-2xl text-ink">{p.name}</h1>
          {p.marketing_description && <p className="text-sm text-ink-70 leading-relaxed mt-3">{p.marketing_description}</p>}
          {p.description && <p className="text-sm text-ink-60 mt-3">{p.description}</p>}

          <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 mt-4">
            Made to order. Prices below are indicative reference points only — final pricing varies by
            specification, quantity and customisation.
            {minQty > 0 && <span className="block mt-1 font-medium">Minimum order: {minQty.toLocaleString()} pcs per design.</span>}
          </div>

          <div className="mt-5">
            <button onClick={() => cart?.add({ type: 'corporate', id: p.id, name: p.name, code: '', image: displayHero || '', qty: minQty || 1, moq: minQty })}
              disabled={inCart}
              className={`btn-primary ${inCart ? 'opacity-60 pointer-events-none' : ''}`}>
              {inCart ? <><Check size={16} /> In enquiry</> : <><Plus size={16} /> Add to enquiry</>}
            </button>
            {inCart && <span className="ml-3 text-xs text-ink-50">Adjust quantity in your enquiry list</span>}
          </div>

          {engineAvailable(engineTypeOf(p)) && (
            <div className="mt-4">
              <Link to={`/customize/${p.id}`}
                className="btn-secondary inline-flex items-center gap-1.5 border-brand-300 text-brand-700">
                <Sparkles size={16} /> Customise &amp; Preview with your logo
              </Link>
              <p className="text-xs text-ink-50 mt-1.5">See your own logo before you enquire · {engineLabel(engineTypeOf(p))}</p>
            </div>
          )}

          {tiers.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">Indicative ex-factory prices ({cur})</p>
              <div className="card divide-y divide-ivory-dark">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-60">{Number(t.quantity).toLocaleString()} pcs</span>
                    <span className="text-ink font-medium">{fmtMoney(convertFromHKD(t.price_hkd, profile, rates), cur)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {(() => {
        const videos = normVideos(p.videos, p.video_url).filter(youtubeEmbed)
        if (!videos.length) return null
        return (
          <div className="mt-10 max-w-2xl mx-auto">
            <div className="space-y-4">
              {videos.map((v, i) => <VideoEmbed key={i} url={v} title={`${p.name} video ${i + 1}`} />)}
            </div>
          </div>
        )
      })()}

      {gallery.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg text-ink mb-3">Gallery & inspiration</h2>
          <div className="mosaic-grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {gallery.map((im, i) => (
              <figure key={im.id} className="mosaic-tile flex flex-col">
                <div className="aspect-square bg-gray-100 overflow-hidden cursor-zoom-in"
                     onClick={() => setLightboxIndex((displayHero ? 1 : 0) + i)}>
                  <img src={im.file_url} alt={im.caption || p.name} loading="lazy"
                    className="w-full h-full object-cover" />
                </div>
                {im.caption && (
                  <figcaption className="text-xs text-ink-60 px-2.5 py-2">{im.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}

      {lightboxIndex != null && (
        <ImageLightbox images={carouselImages} index={lightboxIndex} onIndexChange={setLightboxIndex}
                        onClose={() => setLightboxIndex(null)} altBase={p.name} />
      )}
    </div>
  )
}
