import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FileText, ChevronRight } from 'lucide-react'
import BrandQuickView from '../BrandQuickView'
import { useCustomerAssets, cannotRenderAsImage } from '../../customerAssets'
import { loadProposal } from '../../customerProposal'
import { fmtDate } from './crmDates'
// Summary card for the Brand & Proposal page (split off from this page
// 2026-09-04). Shows a thumbnail strip of the customer's own brand assets +
// the proposal's status, and links to /customers/:id/brand.
function BrandThumb({ asset }) {
  if (cannotRenderAsImage(asset.filename)) {
    return (
      <span className="w-9 h-9 rounded-none border border-warm-grey bg-ivory-dark flex items-center justify-center shrink-0" title={asset.title || asset.filename}>
        <FileText size={14} className="text-ink-60" />
      </span>
    )
  }
  return (
    <img src={asset.file_url} alt={asset.title || asset.filename} loading="lazy"
      className="w-9 h-9 rounded-none border border-warm-grey object-contain bg-white shrink-0"
      title={asset.title || asset.filename} />
  )
}

export default function BrandProposalCard({ customerId, showDesignProfile }) {
  const { assets } = useCustomerAssets(customerId)
  const [proposal, setProposal] = useState(undefined)   // undefined = loading, null = none

  useEffect(() => {
    let alive = true
    loadProposal(customerId)
      .then(p => { if (alive) setProposal(p) })
      .catch(() => { if (alive) setProposal(null) })
    return () => { alive = false }
  }, [customerId])

  const brand = assets.filter(a => a.category === 'brand_asset')
  const thumbs = brand.slice(0, 5)

  const proposalLine =
    proposal === undefined ? 'loading proposal…'
      : proposal === null ? 'no proposal yet'
        : `proposal ${proposal.status}${proposal.updated_at ? ` · updated ${fmtDate(proposal.updated_at)}` : ''}`

  return (
    <div className="card mb-4">
      <Link to={`/customers/${customerId}/brand`}
        className="block px-5 py-4 hover:border-brand-300 transition-colors">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm text-ink-80">Brand &amp; Proposal</h2>
          <span className="text-xs text-brand-600 inline-flex items-center gap-0.5 shrink-0">
            Open <ChevronRight size={13} />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {thumbs.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {thumbs.map(a => <BrandThumb key={a.id} asset={a} />)}
              {brand.length > thumbs.length && (
                <span className="text-xs text-ink-60">+{brand.length - thumbs.length}</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-ink-60">No brand assets yet</span>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-60">
          {brand.length} brand asset{brand.length === 1 ? '' : 's'} · {proposalLine}
        </p>
      </Link>
      {/* Product Design's own brand profile (V8.16) — the Visual Tokens used
          when applying this customer's brand to a product mockup. Distinct
          data from the brand assets above (logos/competitor photos), so
          grouped under the same card rather than duplicating a second
          top-level section. Full editor at /design/customers/:id/brand. */}
      {showDesignProfile && (
        <div className="px-5 pb-4 pt-1 border-t border-warm-grey">
          <div className="flex items-center justify-between mb-1.5 mt-3">
            <h3 className="text-xs uppercase tracking-wide text-ink-60">Brand Profile (Design)</h3>
            <Link to={`/design/customers/${customerId}/brand`} className="text-xs text-brand-600 hover:underline">Edit →</Link>
          </div>
          <BrandQuickView customerId={customerId} />
        </div>
      )}
    </div>
  )
}
