import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { loadCustomerVisibleAssets, loadBrandedProductImages, cannotRenderAsImage, TYPE_LABEL } from '../customerAssets'
import { loadProposal, resolveProposalAsset, resolveProposalAssetIds, resolveProductRefs } from '../customerProposal'
import { isStorefrontVisible } from '../constants'
import { Download, FileText } from 'lucide-react'
import FacetDivider from '../components/FacetDivider'

// "Brand Portal" — replaces the old separate "My Brand Gallery" / "My
// Proposal" pages (owner, post-launch: two nav entries for the same
// customer-facing story was confusing, and the flat asset collage read as
// an internal reference dump rather than something built FOR the customer).
// One page, three sections, always in this order:
//   1. Proposal        — the curated story, if published. The reason they're here.
//   2. Product Gallery  — Sun-Life-branded catalogue photos NOT already
//                         featured in the proposal (leftover only — a
//                         product already in the proposal doesn't need a
//                         second, uncaptioned appearance here), one card per
//                         PRODUCT (not per photo — a product with 4 branded
//                         photos used to show as 4 separate cards). Plus any
//                         manually-uploaded "product_gallery" assets, which
//                         aren't tied to a catalogue product so can't be
//                         deduped/filtered against the proposal.
//   3. Brand Assets     — logos / guidelines. Reference material, not part
//                         of the pitch, so it sits last.
// A section renders nothing when it has nothing — most customers won't have
// all three.
const downloadUrl = (fileUrl, filename) =>
  `/api/download-image?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename || 'file')}`
const extOf = filename => (filename.match(/\.[^.]+$/)?.[0] || '').replace('.', '').toUpperCase()

export default function BrandPortalPage({ profile }) {
  const customerId = profile?.customer_id || null
  const [loading, setLoading] = useState(true)
  const [proposal, setProposal] = useState(null)       // resolved { proposal, heroAsset, sections } or null
  const [brandAssets, setBrandAssets] = useState([])    // category: brand_asset
  const [galleryProducts, setGalleryProducts] = useState([])  // deduped, leftover-filtered branded catalogue products
  const [galleryAssets, setGalleryAssets] = useState([])       // category: product_gallery (manually uploaded)

  useEffect(() => {
    let alive = true
    if (!customerId) { setLoading(false); return }
    setLoading(true)
    ;(async () => {
      const [visibleAssets, brandedImages] = await Promise.all([
        loadCustomerVisibleAssets(customerId),
        loadBrandedProductImages(customerId).then(imgs => imgs.filter(isStorefrontVisible)),
      ])
      if (!alive) return
      setBrandAssets(visibleAssets.filter(a => a.category === 'brand_asset'))

      // One card per PRODUCT, not per photo — first branded photo seen per
      // product_id stands in for that product.
      const byProduct = new Map()
      for (const img of brandedImages) {
        if (!byProduct.has(img.product_id)) byProduct.set(img.product_id, img)
      }
      const groupedProducts = [...byProduct.values()]

      let resolvedProposal = null
      let referencedProductIds = new Set()
      // Same redundancy idea as referencedProductIds below, but for
      // manually-uploaded assets: the proposal's hero image and any asset
      // used inside a section are NOT leftover gallery items. Missing this
      // showed the hero photo a second time, mislabeled as a "product"
      // (found live, 2026-08-20 — Sun Life's own hero image appeared in
      // "More products for your brand" captioned "Proposal hero").
      let referencedAssetIds = new Set()
      try {
        // loadProposal throws (permission-denied) for a customer with no
        // proposal doc at all — see hasBrandPortalContent's comment for why.
        const p = await loadProposal(customerId).catch(() => null)
        if (p && p.status === 'published') {
          const assetsById = new Map(visibleAssets.map(a => [a.id, a]))
          for (const img of brandedImages) assetsById.set(`branded:${img.id}`, { ...img, filename: img.caption || 'photo.jpg' })
          const heroAsset = resolveProposalAsset(assetsById, p.hero_asset_id)
          const sections = await Promise.all(p.sections.map(async s => ({
            heading: s.heading, tagline: s.tagline, briefing: s.briefing,
            images: resolveProposalAssetIds(assetsById, s.asset_ids),
            products: await resolveProductRefs(s.product_refs, profile),
          })))
          resolvedProposal = { proposal: p, heroAsset, sections }
          if (p.hero_asset_id) referencedAssetIds.add(p.hero_asset_id)
          for (const s of p.sections) {
            for (const r of s.product_refs) {
              if (r.collection === 'products') referencedProductIds.add(r.id)
            }
            for (const ref of s.asset_ids) referencedAssetIds.add(typeof ref === 'string' ? ref : ref?.id)
          }
        }
      } catch { /* draft or missing — treated as no proposal, same as ProposalPage did */ }

      if (!alive) return
      setProposal(resolvedProposal)
      setGalleryAssets(
        visibleAssets.filter(a => a.category === 'product_gallery' && !referencedAssetIds.has(a.id))
      )
      // Redundancy rule (owner, post-launch): if the proposal already
      // features a product, showing it again here — uncaptioned, out of
      // context — is noise, not value. Only show what's left over. When
      // there's no published proposal at all, nothing is "left over" from
      // it, so the gallery shows everything (its original fallback role).
      setGalleryProducts(groupedProducts.filter(p => !referencedProductIds.has(p.product_id)))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [customerId])

  const hasProposal = !!proposal
  const hasGallery = galleryProducts.length > 0 || galleryAssets.length > 0
  const hasBrandAssets = brandAssets.length > 0
  const total = (hasProposal ? 1 : 0) + galleryProducts.length + galleryAssets.length + brandAssets.length

  if (loading) return <p className="text-sm text-ink-40 py-10 text-center">Loading…</p>

  if (!customerId) {
    return (
      <div className="card p-8 text-center text-sm text-ink-60">
        No brand content is linked to your account yet. Contact us and we'll set it up.
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="card p-8 text-center text-sm text-ink-60">
        Nothing here yet — we haven't added any of your brand content to the portal.
      </div>
    )
  }

  return (
    <div>
      {/* 1. Proposal */}
      {hasProposal && (
        <div className="mb-12">
          <section className="relative w-screen mx-[calc(50%-50vw)] h-[50vh] min-h-[320px] max-h-[560px] -mt-6 overflow-hidden bg-ivory-dark">
            {proposal.heroAsset && <img src={proposal.heroAsset.file_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-ink/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent" />
            <a href="/shop/proposal/print" target="_blank" rel="noopener"
               className="btn-reversed text-xs absolute top-4 right-4 z-10 inline-flex items-center gap-1.5">
              <Download size={14} /> Download PDF
            </a>
            <div className="absolute inset-0 flex items-end">
              <div className="max-w-6xl w-full mx-auto px-4 pb-10 md:pb-14">
                <p className="eyebrow text-gold mb-2">Brand Proposal</p>
                {proposal.proposal.tagline && <h1 className="text-2xl md:text-4xl text-white leading-tight mb-2 max-w-2xl">{proposal.proposal.tagline}</h1>}
                {proposal.proposal.briefing && <p className="text-sm md:text-base text-white/85 leading-relaxed max-w-lg">{proposal.proposal.briefing}</p>}
              </div>
            </div>
          </section>

          {proposal.sections.length > 0 && (
            <div className="py-8 md:py-10">
              {proposal.sections.map((s, i) => (
                <div key={i}>
                  {i > 0 && <FacetDivider />}
                  <section className="py-6 first:pt-0">
                    {s.heading && <h2 className="text-xl md:text-2xl text-ink mb-1.5">{s.heading}</h2>}
                    {s.tagline && <p className="text-sm font-medium text-bronze mb-2">{s.tagline}</p>}
                    {s.briefing && <p className="text-sm text-ink-60 max-w-2xl mb-5 leading-relaxed">{s.briefing}</p>}

                    {(s.images.length > 0 || s.products.length > 0) && (
                      <div className="mosaic-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {s.images.map(a => {
                          const to = a.product_id ? `/shop/corporate/${a.product_id}` : null
                          const inner = (
                            <>
                              <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                                <img src={a.file_url} alt={a.title || ''} className="w-full h-full object-contain" />
                              </div>
                              {(a.title || a.caption) && (
                                <div className="p-2.5">
                                  {a.title && <p className="text-xs text-ink line-clamp-1 break-words">{a.title}</p>}
                                  {a.caption && <p className="text-[11px] text-ink-60 leading-snug line-clamp-6 mt-0.5 break-words">{a.caption}</p>}
                                </div>
                              )}
                            </>
                          )
                          return to ? (
                            <Link key={a.id} to={to} className="mosaic-tile flex flex-col hover:shadow-md transition-shadow">{inner}</Link>
                          ) : (
                            <div key={a.id} className="mosaic-tile flex flex-col">{inner}</div>
                          )
                        })}
                        {s.products.map(prod => (
                          <Link key={`${prod.collection}-${prod.id}`} to={prod.to} className="mosaic-tile flex flex-col hover:shadow-md transition-shadow">
                            <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                              {prod.image && <img src={prod.image} alt={prod.name} className="w-full h-full object-contain" />}
                            </div>
                            <div className="p-2.5">
                              <p className="text-xs text-ink line-clamp-1 break-words">{prod.name}</p>
                              {prod.caption && <p className="text-[11px] text-ink-60 leading-snug line-clamp-6 mt-0.5 break-words">{prod.caption}</p>}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Product Gallery — leftover branded products + manually uploaded ones.
          Heading/subtitle differ depending on whether a proposal exists, so
          the customer understands WHY this is a separate, secondary section
          rather than a repeat of the proposal (owner, post-launch). */}
      {hasGallery && (
        <div className="mb-10">
          {hasProposal && <FacetDivider />}
          <h2 className="text-xl md:text-2xl text-ink mb-1.5 mt-6">
            {hasProposal ? 'More products for your brand' : 'Your curated brand collection'}
          </h2>
          <p className="text-sm text-ink-60 mb-6 max-w-2xl">
            {hasProposal
              ? 'Browse other products prepared for your brand but not included in this proposal.'
              : 'Products selected and prepared for your brand.'}
          </p>
          <div className="mosaic-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {galleryProducts.map(img => (
              <div key={img.product_id} className="mosaic-tile flex flex-col hover:shadow-md transition-shadow">
                <Link to={`/shop/corporate/${img.product_id}`} className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                  <img src={img.file_url} alt={img.caption || img.product_name} className="w-full h-full object-contain" />
                </Link>
                <div className="p-2.5 flex items-center justify-between gap-2">
                  <Link to={`/shop/corporate/${img.product_id}`} className="min-w-0 hover:text-brand-600">
                    <p className="text-xs text-ink truncate">{img.caption || img.product_name || 'Product photo'}</p>
                  </Link>
                  <a href={downloadUrl(img.file_url, `${img.product_name || 'product'}.jpg`)}
                     title="Download" className="shrink-0 text-ink-40 hover:text-brand-600">
                    <Download size={15} />
                  </a>
                </div>
              </div>
            ))}
            {galleryAssets.map(a => (
              <div key={a.id} className="mosaic-tile flex flex-col hover:shadow-md transition-shadow">
                <div className="aspect-square bg-gray-400 flex items-center justify-center overflow-hidden">
                  {cannotRenderAsImage(a.filename) ? (
                    <div className="flex flex-col items-center gap-1 text-white/80">
                      <FileText size={26} strokeWidth={1.5} />
                      <span className="text-[10px] font-medium">{extOf(a.filename)}</span>
                    </div>
                  ) : (
                    <img src={a.file_url} alt={a.title || a.filename} className="w-full h-full object-contain" />
                  )}
                </div>
                <div className="p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-ink truncate">{a.title || a.filename}</p>
                    <p className="text-[10px] text-ink-40">{TYPE_LABEL[a.type]} · {extOf(a.filename)}</p>
                  </div>
                  <a href={downloadUrl(a.file_url, a.filename)}
                     title="Download" className="shrink-0 text-ink-40 hover:text-brand-600">
                    <Download size={15} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Brand Assets — logos / guidelines. Deliberately the quietest
          section (small label, not a full heading+subtitle like the two
          above) — a resource area, not something competing for attention
          with the proposal or product collection (owner, post-launch).
          Rendered as a FILE LIST, not product-style image tiles — a logo
          is a downloadable asset, not a photo to browse. Cropping a
          transparent-background logo into a big opaque square (found live,
          2026-08-20: Manulife's white/black logo files stretched across a
          solid grey tile) read as broken, not premium. */}
      {hasBrandAssets && (
        <div>
          {(hasProposal || hasGallery) && <FacetDivider />}
          <h2 className="text-sm font-semibold text-ink-70 mb-1 mt-6">Brand Assets</h2>
          <p className="text-xs text-ink-40 mb-3">Access your approved logos, guidelines and brand materials.</p>
          <div className="card divide-y divide-ivory-dark">
            {brandAssets.map(a => (
              <a key={a.id} href={downloadUrl(a.file_url, a.filename)}
                 className="flex items-center gap-3 px-3 py-2.5 hover:bg-ivory/60 transition-colors">
                <div className="w-11 h-11 shrink-0 rounded-sm border border-ivory-dark bg-white flex items-center justify-center overflow-hidden">
                  {cannotRenderAsImage(a.filename) ? (
                    <FileText size={18} strokeWidth={1.5} className="text-ink-40" />
                  ) : (
                    <img src={a.file_url} alt="" className="w-full h-full object-contain p-1" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{a.title || a.filename}</p>
                  <p className="text-[11px] text-ink-40">{TYPE_LABEL[a.type]} · {extOf(a.filename)}</p>
                </div>
                <Download size={16} className="shrink-0 text-ink-40" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

