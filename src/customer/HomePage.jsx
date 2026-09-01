import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Heart, ClipboardList, Receipt, Images, ArrowRight } from 'lucide-react'
import { useFrontPageFeatured } from '../frontPageFeatured'
import { isNew } from '../newArrivals'
import { useCart, useFavourites } from './store'
import { loadBrandedProductImages } from '../customerAssets'
import { loadProposal } from '../customerProposal'
import { isStorefrontVisible } from '../constants'
import ProposalInviteCard from './ProposalInviteCard'
import heroImage from '../assets/customer/hero-corporate.jpg'
import pillarFigurine from '../assets/customer/pillar-figurine.jpg'
import pillarCorporate from '../assets/customer/pillar-corporate.jpg'
import pillarCrystal from '../assets/customer/pillar-crystal.jpg'
import { heroContent, pillarsSection, pillars, quickAccessSection, quickActions } from './homepageContent'

const ICONS = { Heart, ClipboardList, Receipt, Images }

// Which invite (if any) this customer should see on the homepage — a
// priority ladder, not a checklist: a published proposal outranks branded
// product photos existing, which outranks nothing extra (a brand-assets-
// only customer still reaches the portal via the quick-access tile, no
// banner needed for that quiet case — owner, post-launch feedback).
function useProposalInviteStatus(customerId) {
  const [status, setStatus] = useState(null) // 'proposal_ready' | 'collection_ready' | null
  useEffect(() => {
    let alive = true
    if (!customerId) { setStatus(null); return }
    ;(async () => {
      let next = null
      try {
        const proposal = await loadProposal(customerId)
        if (proposal?.status === 'published') next = 'proposal_ready'
      } catch { /* draft/missing — not an error, just nothing to show */ }
      if (!next) {
        try {
          const imgs = await loadBrandedProductImages(customerId)
          if (imgs.filter(isStorefrontVisible).length > 0) next = 'collection_ready'
        } catch { /* ignore — invite just won't show */ }
      }
      if (alive) setStatus(next)
    })()
    return () => { alive = false }
  }, [customerId])
  return status
}

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
      return [it.id, { name, to, isNew: isNew(p) }]
    })).then(entries => { if (alive) setMeta(Object.fromEntries(entries.filter(Boolean))) })
    return () => { alive = false }
  }, [items])
  return meta
}

// A "New" pill for the featured tiles — square, Work Sans caps, same family as
// the storefront .badge (index.css), tinted to read on a photo.
function NewPill({ className = '' }) {
  return (
    <span className={`badge bg-white/90 text-ink backdrop-blur-sm ${className}`}>New</span>
  )
}

// Featured section = one large LEAD tile followed by a rail of standard tiles
// (UI-POLISH §4.1: the lead absorbs the old 5-in-a-4-col orphan and gives the
// eye one entry point). The lead is a SPLIT card — square image cell + text
// panel — NOT a wide banner: the whole catalogue's photos are square, and a
// square source in a wide `object-cover` frame crops ~25% off the top and
// bottom (owner, 2026-09-01). A square image cell fits a square photo with
// zero crop, needs no landscape re-shoot, and still reads as a showcase.
function FeaturedProductCard({ item, meta, lead = false }) {
  if (!meta) return null // product deleted/renamed away since being featured — skip rather than show a broken link
  if (lead) {
    return (
      <Link to={meta.to}
        className="mosaic-tile group grid sm:grid-cols-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
        <div className="relative aspect-square bg-ivory-dark overflow-hidden">
          <img src={item.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          {meta.isNew && <NewPill className="absolute top-3 left-3" />}
        </div>
        <div className="flex flex-col justify-center gap-2 p-6 md:p-8">
          <p className="eyebrow text-bronze">Featured</p>
          <p className="text-xl md:text-3xl text-ink leading-tight line-clamp-3">{meta.name}</p>
          <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-brand-600 font-medium group-hover:gap-2.5 transition-all">
            View product <ArrowRight size={15} />
          </span>
        </div>
      </Link>
    )
  }
  return (
    <Link to={meta.to}
      className="mosaic-tile relative flex flex-col group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <div className="aspect-square bg-ivory-dark overflow-hidden">
        <img src={item.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
      </div>
      {meta.isNew && <NewPill className="absolute top-2 left-2" />}
      <div className="p-3">
        <p className="text-sm text-ink line-clamp-2 leading-snug">{meta.name}</p>
      </div>
    </Link>
  )
}

function PillarCard({ pillar, spanFull }) {
  return (
    <Link to={pillar.to}
      className={`mosaic-tile flex flex-col group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${spanFull ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
      <div className="aspect-[4/3] bg-ivory-dark overflow-hidden">
        <img src={PILLAR_IMAGE[pillar.key]} alt="" loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <h3 className="text-lg text-ink">{pillar.title}</h3>
        <p className="text-sm text-ink-60 leading-snug">{pillar.description}</p>
        <p className="text-2xs text-ink-60 uppercase tracking-wide font-label">{pillar.metadata}</p>
        <div className="mt-auto pt-3 flex items-center gap-1.5 text-sm text-brand-600 font-medium group-hover:gap-2.5 transition-all">
          {pillar.ctaLabel} <ArrowRight size={15} />
        </div>
      </div>
    </Link>
  )
}

function QuickActionTile({ action, count }) {
  const Icon = ICONS[action.iconKey]
  // Utility row, not a hero card (UI-POLISH §3): no transform / lift. Two
  // coordinated colour shifts (tile warms, icon chip deepens) are the whole
  // hover — enough to read as interactive, nothing that jitters the layout.
  // `count` (favourites / enquiry lines) turns the tile from a nav duplicate
  // into a status glance — both come free from context, no extra reads.
  return (
    <Link to={action.to}
      className="mosaic-tile group flex flex-col items-center justify-center gap-3 py-6 px-3 text-center hover:bg-ivory transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <span className="relative w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center group-hover:bg-brand-100 transition-colors">
        <Icon size={20} strokeWidth={1.5} className="text-brand-600" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-2xs font-label font-medium flex items-center justify-center leading-none">
            {count}
          </span>
        )}
      </span>
      <span className="text-sm text-ink font-medium">{action.label}</span>
      <span className="text-xs text-ink-60 -mt-1.5 h-4">
        {count > 0
          ? (action.key === 'favourites' ? `${count} saved` : action.key === 'enquiry' ? `${count} item${count === 1 ? '' : 's'}` : '')
          : ''}
      </span>
    </Link>
  )
}

export default function HomePage({ profile }) {
  const visibleQuickActions = quickActions.filter(a => !a.requiresCustomer || profile?.customer_id)
  const fav = useFavourites()
  const cart = useCart()
  const quickCount = { favourites: fav?.count || 0, enquiry: cart?.count || 0 }
  const featured = useFrontPageFeatured()
  const featuredMeta = useFeaturedProductsMeta(featured?.items)
  const inviteStatus = useProposalInviteStatus(profile?.customer_id)

  // The hero CTA is the customer's most relevant first move, not a generic
  // "explore" that echoes the heading + the pillars section below it: a
  // customer with a published proposal jumps straight there; everyone else
  // goes to the largest catalogue (a real destination, not a 200px scroll).
  const heroCta = inviteStatus
    ? { label: 'View your proposal', to: '/shop/brand-portal' }
    : { label: heroContent.primaryCta.label, to: heroContent.primaryCta.to }

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
            <h1 className="text-4xl md:text-6xl text-white leading-tight mb-3 max-w-2xl">{heroContent.heading}</h1>
            <p className="text-sm md:text-base text-white/85 leading-relaxed mb-6 max-w-xl">{heroContent.supporting}</p>
            <Link to={heroCta.to} className="btn-reversed w-full sm:w-auto">{heroCta.label}</Link>
          </div>
        </div>
      </section>

      {/* One section rhythm across the whole page (UI-POLISH §4.1): every
          band is `py-16 md:py-24` (V3 — the landing-page band; list/detail
          storefront pages stay tighter), and every heading→grid gap is
          `mb-6`. Storefront breathing room (§3), not OpsCenter density. */}
      {inviteStatus && (
        <section className="py-16 md:py-24">
          <ProposalInviteCard status={inviteStatus} href="/shop/brand-portal" />
        </section>
      )}

      {/* Featured Products — hand-picked by an admin in Marketing → Front
          Page (src/pages/FrontPageConfig.jsx), each a specific product AND
          a specific one of its own photos, not just its default hero image.
          Renders nothing while loading or if none are configured yet, so a
          fresh install isn't left with an empty section header. */}
      {featured?.items?.length > 0 && (
        <section className="py-16 md:py-24">
          <p className="eyebrow tracking-[0.08em] text-bronze mb-2">Featured</p>
          <h2 className="text-xl md:text-2xl text-ink mb-1.5">This season's selection</h2>
          <p className="text-sm text-ink-60 mb-6 max-w-2xl">A closer look at new arrivals and pieces we're showing this quarter.</p>
          <FeaturedProductCard lead item={featured.items[0]} meta={featuredMeta[featured.items[0].id]} />
          {featured.items.length > 1 && (
            <div className="mosaic-grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 mt-px">
              {featured.items.slice(1).map(it => <FeaturedProductCard key={it.id} item={it} meta={featuredMeta[it.id]} />)}
            </div>
          )}
        </section>
      )}

      {/* Pillars */}
      <section id="pillars" className="py-16 md:py-24 scroll-mt-4">
        <p className="eyebrow tracking-[0.08em] text-bronze mb-2">Collections</p>
        <h2 className="text-xl md:text-2xl text-ink mb-1.5">{pillarsSection.heading}</h2>
        <p className="text-sm text-ink-60 mb-6 max-w-2xl">{pillarsSection.supporting}</p>
        <div className="mosaic-grid sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <PillarCard key={p.key} pillar={p} spanFull={i === pillars.length - 1} />
          ))}
        </div>
      </section>

      {/* Quick access */}
      <section className="py-16 md:py-24 border-t border-ivory-dark">
        <h2 className="text-lg md:text-xl text-ink mb-6">{quickAccessSection.heading}</h2>
        <div className="mosaic-grid grid-cols-2 lg:grid-cols-4">
          {visibleQuickActions.map(a => <QuickActionTile key={a.key} action={a} count={quickCount[a.key] || 0} />)}
        </div>
      </section>
    </div>
  )
}
