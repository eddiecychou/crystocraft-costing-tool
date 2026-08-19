import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { loadCustomerVisibleAssets, loadBrandedProductImages, cannotRenderAsImage, TYPE_LABEL } from '../customerAssets'
import { loadProposal, resolveProposalAsset, resolveProposalAssetIds, resolveProductRefs } from '../customerProposal'
import { isStorefrontVisible } from '../constants'
import { Download, FileText } from 'lucide-react'

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
      setGalleryAssets(visibleAssets.filter(a => a.category === 'product_gallery'))

      // One card per PRODUCT, not per photo — first branded photo seen per
      // product_id stands in for that product.
      const byProduct = new Map()
      for (const img of brandedImages) {
        if (!byProduct.has(img.product_id)) byProduct.set(img.product_id, img)
      }
      const groupedProducts = [...byProduct.values()]

      let resolvedProposal = null
      let referencedProductIds = new Set()
      try {
        const p = await loadProposal(customerId)
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
          for (const s of p.sections) for (const r of s.product_refs) {
            if (r.collection === 'products') referencedProductIds.add(r.id)
          }
        }
      } catch { /* draft or missing — treated as no proposal, same as ProposalPage did */ }

      if (!alive) return
      setProposal(resolvedProposal)
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
      <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
        No brand content is linked to your account yet. Contact us and we'll set it up.
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
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
            <div className="absolute inset-0 flex items-end">
              <div className="max-w-6xl w-full mx-auto px-4 pb-10 md:pb-14">
                {proposal.proposal.tagline && <h1 className="text-2xl md:text-4xl text-white leading-tight mb-2 max-w-2xl">{proposal.proposal.tagline}</h1>}
                {proposal.proposal.briefing && <p className="text-sm md:text-base text-white/85 leading-relaxed max-w-lg">{proposal.proposal.briefing}</p>}
              </div>
            </div>
          </section>

          {proposal.sections.length > 0 && (
            <div className="space-y-12 py-8 md:py-10">
              {proposal.sections.map((s, i) => (
                <section key={i}>
                  {s.heading && <h2 className="text-xl md:text-2xl text-ink mb-1.5">{s.heading}</h2>}
                  {s.tagline && <p className="text-sm font-medium text-brand-600 mb-2">{s.tagline}</p>}
                  {s.briefing && <p className="text-sm text-ink-60 max-w-2xl mb-5 leading-relaxed">{s.briefing}</p>}

                  {(s.images.length > 0 || s.products.length > 0) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
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
                          <Link key={a.id} to={to} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">{inner}</Link>
                        ) : (
                          <div key={a.id} className="card overflow-hidden flex flex-col">{inner}</div>
                        )
                      })}
                      {s.products.map(prod => (
                        <Link key={`${prod.collection}-${prod.id}`} to={prod.to} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Product Gallery — leftover branded products + manually uploaded ones */}
      {hasGallery && (
        <div className="mb-10">
          <h2 className="text-sm font-semibold text-ink-70 mb-3">Product Gallery</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {galleryProducts.map(img => (
              <div key={img.product_id} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
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
              <div key={a.id} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
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

      {/* 3. Brand Assets — logos / guidelines */}
      {hasBrandAssets && (
        <div>
          <h2 className="text-sm font-semibold text-ink-70 mb-3">Brand Assets</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {brandAssets.map(a => (
              <div key={a.id} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
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
    </div>
  )
}

