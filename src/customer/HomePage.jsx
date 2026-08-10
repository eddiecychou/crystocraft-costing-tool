import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Heart, ClipboardList, Receipt, Images, ArrowRight } from 'lucide-react'
import { useFrontPageFeatured } from '../frontPageFeatured'
import heroImage from '../assets/customer/hero-corporate.jpg'
import pillarFigurine from '../assets/customer/pillar-figurine.jpg'
import pillarCorporate from '../assets/customer/pillar-corporate.jpg'
import pillarCrystal from '../assets/customer/pillar-crystal.jpg'
import { heroContent, pillarsSection, pillars, quickAccessSection, quickActions } from './homepageContent'

const ICONS = { Heart, ClipboardList, Receipt, Images }
const PILLAR_IMAGE = { figurine: pillarFigurine, corporate: pillarCorporate, crystal: pillarCrystal }

// Resolves each featured item's current name + detail-page link live, so a
// renamed/retired product doesn't leave stale text on the homepage — only
// the CHOSEN PHOTO is fixed by the admin's pick (src/frontPageFeatured.js);
// everything else about the product stays live.
function useFeaturedProductsMeta(items) {
  const [meta, setMeta] = useState({})
  useEffect(() => {
    if (!items || items.length === 0) { setMeta({}); return }
    let alive = true
    Promise.all(items.map(async it => {
      const path = it.product_type === 'corp_gift' ? 'products' : 'range_products'
      const snap = await getDoc(doc(db, path, it.product_id))
      if (!snap.exists()) return null
      const p = snap.data()
      const name = it.product_type === 'corp_gift' ? (p.name || it.product_id) : (p.design_name || p.description || p.design_code || it.product_id)
      const to = it.product_type === 'corp_gift' ? `/shop/corporate/${it.product_id}` : `/shop/figurine/${it.product_id}`
      return [it.id, { name, to }]
    })).then(entries => { if (alive) setMeta(Object.fromEntries(entries.filter(Boolean))) })
    return () => { alive = false }
  }, [items])
  return meta
}

function FeaturedProductCard({ item, meta }) {
  if (!meta) return null // product deleted/renamed away since being featured — skip rather than show a broken link
  return (
    <Link to={meta.to}
      className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <div className="aspect-square bg-ivory-dark overflow-hidden">
        <img src={item.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
      </div>
      <div className="p-3">
        <p className="text-sm text-ink line-clamp-2 leading-snug">{meta.name}</p>
      </div>
    </Link>
  )
}

function PillarCard({ pillar, spanFull }) {
  return (
    <Link to={pillar.to}
      className={`card overflow-hidden flex flex-col hover:shadow-md transition-shadow group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${spanFull ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
      <div className="aspect-[4/3] bg-ivory-dark overflow-hidden">
        <img src={PILLAR_IMAGE[pillar.key]} alt="" loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <h3 className="text-lg text-ink">{pillar.title}</h3>
        <p className="text-sm text-ink-60 leading-snug">{pillar.description}</p>
        <p className="text-[11px] text-ink-50 uppercase tracking-wide font-label">{pillar.metadata}</p>
        <div className="mt-auto pt-3 flex items-center gap-1.5 text-sm text-brand-600 font-medium group-hover:gap-2.5 transition-all">
          {pillar.ctaLabel} <ArrowRight size={15} />
        </div>
      </div>
    </Link>
  )
}

function QuickActionTile({ action }) {
  const Icon = ICONS[action.iconKey]
  return (
    <Link to={action.to}
      className="card group flex flex-col items-center justify-center gap-3 py-6 px-3 text-center hover:shadow-lg hover:-translate-y-0.5 hover:border-brand-200 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <span className="w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center group-hover:bg-brand-100 group-hover:scale-110 transition-all duration-200">
        <Icon size={20} strokeWidth={1.5} className="text-brand-600" />
      </span>
      <span className="text-sm text-ink font-medium">{action.label}</span>
    </Link>
  )
}

export default function HomePage({ profile }) {
  const visibleQuickActions = quickActions.filter(a => !a.requiresCustomer || profile?.customer_id)
  const featured = useFrontPageFeatured()
  const featuredMeta = useFeaturedProductsMeta(featured?.items)

  const scrollToPillars = () => document.getElementById('pillars')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div>
      {/* Hero — full-bleed edge-to-edge banner (breaks out of CustomerLayout's
          max-w-6xl content column on purpose: mx-[calc(50%-50vw)] + w-screen
          is the standard full-bleed-inside-a-centered-container technique).
          Matches the wide-banner treatment on crystocraft.com and
          swarovski.com — a boxed half-width photo read as visually weak by
          comparison (owner, 2026-08-11). */}
      <section className="relative w-screen mx-[calc(50%-50vw)] h-[60vh] min-h-[380px] max-h-[640px] -mt-6 overflow-hidden">
        <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
        {/* Flat tint across the whole photo (not just the bottom gradient)
            — a bright, high-frequency close-up crystal texture like this
            one still fights white text even where the gradient alone was
            lightest (owner, 2026-08-11: text hard to read). */}
        <div className="absolute inset-0 bg-ink/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-6xl w-full mx-auto px-4 pb-10 md:pb-14">
            <p className="text-xs uppercase tracking-widest text-white/70 font-label mb-2">
              {profile?.company_name ? `Welcome back, ${profile.company_name}` : 'Welcome back'}
            </p>
            <h1 className="text-3xl md:text-5xl text-white leading-tight mb-3 max-w-2xl">{heroContent.heading}</h1>
            <p className="text-sm md:text-base text-white/85 leading-relaxed mb-6 max-w-md">{heroContent.supporting}</p>
            <button onClick={scrollToPillars} className="btn-primary w-full sm:w-auto">{heroContent.primaryCta.label}</button>
          </div>
        </div>
      </section>

      {/* Featured Products — hand-picked by an admin in Marketing → Front
          Page (src/pages/FrontPageConfig.jsx), each a specific product AND
          a specific one of its own photos, not just its default hero image.
          Renders nothing while loading or if none are configured yet, so a
          fresh install isn't left with an empty section header. */}
      {featured?.items?.length > 0 && (
        <section className="py-8 md:py-10">
          <h2 className="text-xl md:text-2xl text-ink mb-1.5">Featured Products</h2>
          <p className="text-sm text-ink-60 mb-6 max-w-2xl">A closer look at some of our new arrivals and best sellers.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {featured.items.map(it => <FeaturedProductCard key={it.id} item={it} meta={featuredMeta[it.id]} />)}
          </div>
        </section>
      )}

      {/* Pillars */}
      <section id="pillars" className="py-8 md:py-10 scroll-mt-4">
        <h2 className="text-xl md:text-2xl text-ink mb-1.5">{pillarsSection.heading}</h2>
        <p className="text-sm text-ink-60 mb-6 max-w-2xl">{pillarsSection.supporting}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {pillars.map((p, i) => (
            <PillarCard key={p.key} pillar={p} spanFull={i === pillars.length - 1} />
          ))}
        </div>
      </section>

      {/* Quick access */}
      <section className="py-6 md:py-8 border-t border-ivory-dark">
        <h2 className="text-lg md:text-xl text-ink mb-4">{quickAccessSection.heading}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {visibleQuickActions.map(a => <QuickActionTile key={a.key} action={a} />)}
        </div>
      </section>
    </div>
  )
}
