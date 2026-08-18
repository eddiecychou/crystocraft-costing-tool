import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from './store'
import { loadCustomerVisibleAssets, loadBrandedProductImages } from '../customerAssets'
import { loadProposal, resolveProposalAsset, resolveProposalAssetIds, resolveProductRefs } from '../customerProposal'
import { isStorefrontVisible } from '../constants'

// PHASE 4 — Sun-Life-Proposal-Build-Spec.md §5. Reads the live proposal doc
// and resolves every reference (hero/section assets, product cards) against
// the same privacy-screened loaders the rest of the portal uses. Never reads
// a file_url/product name off the proposal doc itself (spec §3.3) — an id
// that no longer resolves (asset downgraded, product retired) is dropped
// silently rather than shown broken (spec §8).
export default function ProposalPage({ profile }) {
  const cart = useCart()
  const customerId = profile?.customer_id || null
  const [state, setState] = useState({ loading: true, proposal: null, heroAsset: null, sections: [] })

  useEffect(() => {
    let alive = true
    if (!customerId) { setState({ loading: false, proposal: null, heroAsset: null, sections: [] }); return }
    setState(s => ({ ...s, loading: true }))
    ;(async () => {
      const proposal = await loadProposal(customerId)
      if (!proposal || proposal.status !== 'published') {
        if (alive) setState({ loading: false, proposal: null, heroAsset: null, sections: [] })
        return
      }
      const [visibleAssets, brandedImages] = await Promise.all([
        loadCustomerVisibleAssets(customerId),
        loadBrandedProductImages(customerId).then(imgs => imgs.filter(isStorefrontVisible)),
      ])
      const assetsById = new Map(visibleAssets.map(a => [a.id, a]))
      // Branded catalogue photos aren't in the assets store (they live on the
      // product doc — see customerAssets.js), but a section may still want to
      // reference one by its synthetic id so it resolves the same way.
      for (const img of brandedImages) assetsById.set(`branded:${img.id}`, { ...img, file_url: img.file_url, filename: img.caption || 'photo.jpg' })

      const heroAsset = resolveProposalAsset(assetsById, proposal.hero_asset_id)
      const sections = await Promise.all(proposal.sections.map(async s => ({
        heading: s.heading,
        tagline: s.tagline,
        briefing: s.briefing,
        images: resolveProposalAssetIds(assetsById, s.asset_ids),
        products: await resolveProductRefs(s.product_refs, profile),
      })))
      if (alive) setState({ loading: false, proposal, heroAsset, sections })
    })()
    return () => { alive = false }
  }, [customerId])

  const enquire = () => {
    cart?.add({
      type: 'enquiry_note',
      id: 'proposal',
      name: `${profile?.company_name || 'Proposal'} discussion`,
      note: 'Sun Life proposal discussion',
    })
  }

  const { loading, proposal, heroAsset, sections } = state

  if (loading) {
    return <p className="text-sm text-ink-40 py-10 text-center">Loading…</p>
  }

  if (!proposal) {
    return (
      <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
        Nothing here yet — we haven't put together your proposal in the portal.
      </div>
    )
  }

  return (
    <div>
      {/* Hero — same full-bleed treatment as HomePage.jsx's banner */}
      <section className="relative w-screen mx-[calc(50%-50vw)] h-[50vh] min-h-[320px] max-h-[560px] -mt-6 overflow-hidden bg-ivory-dark">
        {heroAsset && <img src={heroAsset.file_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-ink/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-6xl w-full mx-auto px-4 pb-10 md:pb-14">
            {proposal.tagline && <h1 className="text-2xl md:text-4xl text-white leading-tight mb-2 max-w-2xl">{proposal.tagline}</h1>}
            {proposal.briefing && <p className="text-sm md:text-base text-white/85 leading-relaxed max-w-lg">{proposal.briefing}</p>}
          </div>
        </div>
      </section>

      {/* Sections */}
      {sections.length > 0 && (
        <div className="space-y-12 py-8 md:py-10">
          {sections.map((s, i) => (
            <section key={i}>
              {s.heading && <h2 className="text-xl md:text-2xl text-ink mb-1.5">{s.heading}</h2>}
              {s.tagline && <p className="text-sm font-medium text-brand-600 mb-2">{s.tagline}</p>}
              {s.briefing && <p className="text-sm text-ink-60 max-w-2xl mb-5 leading-relaxed">{s.briefing}</p>}

              {s.images.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                  {s.images.map(a => (
                    <div key={a.id} className="aspect-[4/3] bg-ivory-dark rounded-lg overflow-hidden">
                      <img src={a.file_url} alt={a.title || ''} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}

              {s.products.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {s.products.map(prod => (
                    <Link key={`${prod.collection}-${prod.id}`} to={prod.to} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                      <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                        {prod.image && <img src={prod.image} alt={prod.name} className="w-full h-full object-contain" />}
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs text-ink truncate">{prod.name}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* CTA */}
      <div className="border-t border-ivory-dark pt-8 pb-4 text-center">
        <Link to="/shop/enquiry" onClick={enquire} className="btn-primary">
          {proposal.cta_label || 'Make an enquiry'}
        </Link>
      </div>
    </div>
  )
}
