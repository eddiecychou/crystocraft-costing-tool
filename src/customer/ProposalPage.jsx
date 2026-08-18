import { Link } from 'react-router-dom'
import { Presentation } from 'lucide-react'
import { useCart } from './store'
import { sunLifeProposal, PLACEHOLDER_NOTICE } from './proposalContent'

// PHASE 0 — Sun-Life-Proposal-Build-Spec.md §5 / §10.
// Renders the hard-coded proposalContent module. No Firestore reads yet —
// Phase 4 swaps `sunLifeProposal` for loadProposal() + resolved assets/
// products via customerProposal.js, keeping this render structure.
export default function ProposalPage({ profile }) {
  const cart = useCart()
  const p = sunLifeProposal

  const enquire = () => {
    cart?.add({
      type: 'enquiry_note',
      id: 'proposal',
      name: `${profile?.company_name || 'Proposal'} discussion`,
      note: 'Sun Life proposal discussion',
    })
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <Presentation size={14} className="shrink-0" />
        <span>{PLACEHOLDER_NOTICE}</span>
      </div>

      {/* Hero — same full-bleed treatment as HomePage.jsx's banner */}
      <section className="relative w-screen mx-[calc(50%-50vw)] h-[50vh] min-h-[320px] max-h-[560px] -mt-6 overflow-hidden">
        <img src={p.hero_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-ink/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-6xl w-full mx-auto px-4 pb-10 md:pb-14">
            <h1 className="text-2xl md:text-4xl text-white leading-tight mb-2 max-w-2xl">{p.tagline}</h1>
            <p className="text-sm md:text-base text-white/85 leading-relaxed max-w-lg">{p.briefing}</p>
          </div>
        </div>
      </section>

      {/* Sections */}
      <div className="space-y-12 py-8 md:py-10">
        {p.sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-xl md:text-2xl text-ink mb-1.5">{s.heading}</h2>
            <p className="text-sm font-medium text-brand-600 mb-2">{s.tagline}</p>
            <p className="text-sm text-ink-60 max-w-2xl mb-5 leading-relaxed">{s.briefing}</p>

            {s.images?.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                {s.images.map((img, j) => (
                  <div key={j} className="aspect-[4/3] bg-ivory-dark rounded-lg overflow-hidden">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}

            {s.products?.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {s.products.map((prod, k) => {
                  const inner = (
                    <>
                      <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                        <img src={prod.image} alt={prod.name} className="w-full h-full object-contain" />
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs text-ink truncate">{prod.name}</p>
                      </div>
                    </>
                  )
                  return prod.to ? (
                    <Link key={k} to={prod.to} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">{inner}</Link>
                  ) : (
                    <div key={k} className="card overflow-hidden flex flex-col">{inner}</div>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* CTA */}
      <div className="border-t border-ivory-dark pt-8 pb-4 text-center">
        <Link to="/shop/enquiry" onClick={enquire} className="btn-primary">
          {p.cta_label}
        </Link>
      </div>
    </div>
  )
}
