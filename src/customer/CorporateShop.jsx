import useCatalogueFilter from '../hooks/useCatalogueFilter'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useCustomerCatalogue } from '../hooks/useCustomerCatalogue'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useRates, convertFromHKD, fmtMoney } from '../currency'
import { isNew, newFirst } from '../newArrivals'
import CollectionBand from './CollectionBand'
import { collectionProducts } from '../catalogueCollections'
import FavHeart from './FavHeart'
import LoadingBar from '../components/LoadingBar'
import CardImageCarousel from '../components/CardImageCarousel'

const PAGE_SIZE = 24

export default function CorporateShop({ profile }) {
  const { data, loading, error, retry } = useCustomerCatalogue(profile)
  const products = useMemo(() => [...(data?.products || [])].sort((a, b) => newFirst(a, b) || (a.name || '').localeCompare(b.name || '')), [data])
  const filtersReady = !loading && !error
  // Filters persist across a detail visit so returning keeps your search/category.
  const [search, setSearch] = useState(() => sessionStorage.getItem('cs-search') || '')
  const [coll, setColl] = useState(null)
  const [visibleCount, setVisibleCount] = useState(() => Number(sessionStorage.getItem('cs-visible')) || PAGE_SIZE)
  const filtersMounted = useRef(false)
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'
  const sensitive = !!profile?.sensitive

  const imagesFor = p => p.images.map(im => ({ url: im.file_url, caption: im.caption }))
  const imageFor = p => p.heroImage || ''

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
  const [cat, setCat] = useCatalogueFilter('cs-cat', categories, filtersReady)
  // Light list the Shop-by band can render image tiles from.
  const bandItems = useMemo(() => products.map(p => ({
    id: p.id, category: p.category || '', is_new: !!p.is_new, image: imageFor(p), name: p.name || '',
  })), [products, sensitive])
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
  }, [products, coll, search, cat, sensitive])
  const visible = filtered.slice(0, visibleCount)

  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return }
    setVisibleCount(PAGE_SIZE)
    sessionStorage.setItem('cs-visible', String(PAGE_SIZE))
  }, [search, cat, coll])

  // After returning from a product detail, scroll the last-opened card back into
  // view so you can carry on browsing where you left off.
  useEffect(() => {
    if (loading) return
    const lastId = sessionStorage.getItem('cs-last-id')
    if (!lastId) return
    const el = document.getElementById(`corp-card-${lastId}`)
    if (el) { el.scrollIntoView({ block: 'center' }); sessionStorage.removeItem('cs-last-id') }
  }, [loading, filtered])

  return (
    <div>
      {loading && <LoadingBar />}
      {error && <p role="alert" className="text-sm text-red-600">{error} <button onClick={retry} className="underline">Retry</button></p>}
      <div className="mb-5">
        <p className="eyebrow tracking-[0.08em] text-bronze mb-1.5">Catalogue</p>
        <h1 className="text-2xl md:text-3xl text-ink">Corporate Gifts</h1>
        <p className="text-sm text-ink-60 mt-0.5">{filtered.length} products</p>
      </div>
      <div className="bg-gold/10 border border-gold/40 text-ink-80 text-xs px-3 py-2 mb-5">
        Corporate gifts are made to order. Prices shown are indicative reference points only — final pricing varies
        by specification, quantity and customisation. Contact us for a quotation.
      </div>
      <CollectionBand catalogue="corp_gift" products={bandItems} active={coll}
        onApply={c => { setColl(c); setCat(''); window.scrollTo({ top: 0 }) }} />
      {coll && (
        <div className="flex items-center justify-between gap-2 mb-4 px-3 py-2 bg-ink/5 border border-ivory-dark">
          <span className="text-sm text-ink-80">Showing <span className="font-medium">{coll.title}</span></span>
          <button onClick={() => setColl(null)} className="text-sm text-ink-60 hover:text-ink shrink-0">Clear</button>
        </div>
      )}
      <div className="mb-5 space-y-4">
        <input type="text" placeholder="Search products…" className="input w-full sm:max-w-xs"
          value={search} onChange={e => { setSearch(e.target.value); sessionStorage.setItem('cs-search', e.target.value) }} />
        <div>
          <p className="label mb-1.5">Category</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => { setColl(null); setCat(''); sessionStorage.setItem('cs-cat', '') }}
              className={(coll ? false : cat === '') ? 'tag-active' : 'tag-clickable'}>All categories</button>
            {categories.map(c => (
              <button key={c} type="button" onClick={() => { setColl(null); setCat(c); sessionStorage.setItem('cs-cat', c) }}
                className={(!coll && cat === c) ? 'tag-active' : 'tag-clickable'}>{c}</button>
            ))}
          </div>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="eyebrow text-ink-60 mb-1.5">No matches</p>
          <p className="text-sm text-ink-60">No products match your search or filters.</p>
        </div>
      ) : (
        <div className="mosaic-grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map(p => (
            <CorpCard key={p.id} p={p} cur={cur} rates={rates} profile={profile}
              images={imagesFor(p)} />
          ))}
        </div>
      )}
      {visible.length < filtered.length && (
        <div className="flex justify-center mt-6">
          <button type="button" className="btn-secondary text-sm"
            onClick={() => setVisibleCount(n => {
              const next = n + PAGE_SIZE
              sessionStorage.setItem('cs-visible', String(next))
              return next
            })}>
            Load more ({filtered.length - visible.length} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

function CorpCard({ p, cur, rates, profile, images: initialImages }) {
  const images = [...initialImages].sort((a, b) => Number(b.url === p.heroImage) - Number(a.url === p.heroImage))
  const displayImage = images[0]?.url || null
  const hkds = (p.tiers || []).map(t => Number(t.price_hkd)).filter(v => v > 0)
  const fromPrice = hkds.length ? convertFromHKD(Math.min(...hkds), profile, rates) : null

  return (
    <Link id={`corp-card-${p.id}`} to={`/shop/corporate/${p.id}`}
      onClick={() => sessionStorage.setItem('cs-last-id', p.id)}
      className="mosaic-tile flex flex-col group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <div className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark relative">
        <CardImageCarousel images={images} alt={p.name}
          imgClassName="object-cover group-hover:scale-105 transition-transform duration-300"
          fallback={<Package size={32} strokeWidth={1.25} className="text-platinum" />} />
        {isNew(p) && (
          <span className="absolute top-1.5 left-1.5 badge-active" title="New arrival">New</span>
        )}
        <FavHeart item={{ type: 'corporate', id: p.id, name: p.name, code: '', image: displayImage || '' }}
          className="absolute top-1.5 right-1.5" />
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3 className="text-sm leading-tight text-ink line-clamp-2" title={p.name}>{p.name}</h3>
        <p className="text-xs text-ink-60">{p.category}</p>
        {p.description && <p className="text-xs text-ink-60 line-clamp-2">{p.description}</p>}
        <div className="mt-auto pt-1.5">
          {fromPrice === undefined ? <span className="text-xs text-ink-60">…</span>
            : fromPrice == null ? <span className="text-xs text-ink-60 italic">Enquire for pricing</span>
            : <span className="text-sm text-ink"><span className="text-xs text-ink-60">from </span>{fmtMoney(fromPrice, cur)}</span>}
        </div>
      </div>
    </Link>
  )
}
