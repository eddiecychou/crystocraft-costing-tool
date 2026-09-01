import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// Portal-wide, customer-agnostic invitation card — NOT a Sun Life component.
// Every visual choice here comes straight from the existing design system
// (Crystocraft Design System 2026V2/tokens/*.css + this app's own Tailwind
// mirror of it, see tailwind.config.js): hairline border + flat corners
// (.card in index.css — "restraint over decoration", shadow reserved for
// hover, never at rest), Work Sans uppercase label for the eyebrow (the
// same treatment HomePage's own "Welcome back" line uses), and the
// text-plus-arrow CTA already established by PillarCard below on this same
// page — never a boxed button, never a customer's brand colour. Content is
// entirely data-driven by `status`; nothing here reads a customer's name,
// logo or colours. Customer-specific material (logos, product photos,
// brand copy) lives on the proposal/product-gallery page this links to,
// never on this card.
const CONTENT = {
  proposal_ready: {
    eyebrow: 'Your proposal is ready',
    subtitle: 'A curated selection prepared for your brand.',
    ctaLabel: 'View proposal',
  },
  collection_ready: {
    eyebrow: 'Explore your curated brand collection',
    subtitle: 'Products selected and prepared for your brand.',
    ctaLabel: 'Explore products',
  },
}

export default function ProposalInviteCard({ status, href }) {
  const content = CONTENT[status]
  if (!content) return null
  return (
    <Link to={href}
      className="card group flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6 px-6 py-6 hover:bg-ivory transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <div>
        <p className="text-xs uppercase tracking-widest text-ink font-label font-medium mb-1.5">{content.eyebrow}</p>
        <p className="text-sm text-ink-60">{content.subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 text-sm text-brand-600 font-medium shrink-0 group-hover:gap-2.5 transition-all">
        {content.ctaLabel} <ArrowRight size={15} />
      </div>
    </Link>
  )
}
