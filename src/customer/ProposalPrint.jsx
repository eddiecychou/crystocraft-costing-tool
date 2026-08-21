import { useState, useEffect } from 'react'
import {
  loadCustomerVisibleAssets, loadBrandedProductImages,
} from '../customerAssets'
import { loadProposal, resolveProposalAsset, resolveProposalAssetIds, resolveProductRefs } from '../customerProposal'
import { isStorefrontVisible } from '../constants'
import { pdfFileTitle } from '../pdfFilename'
import logoUrl from '../assets/logo.png'

// Rendered and pixel-measured the actual exported PDF (2026-08-22): EVERY
// page — not just page 1 — started at literal pixel row 0, no margin at
// all, despite the deployed bundle confirmed to contain a real @page
// margin value. That ruled out "wrong cm value" as the cause. Root cause:
// this component's <style> tag was rendered as a child of .bp-doc, i.e.
// physically inside <body> — some browsers' print/PDF engines don't
// reliably honor @page at-rules from a body-injected <style> element the
// way they do from one in <head>. Building the CSS as a plain string and
// injecting it into document.head via a real DOM node (below) sidesteps
// that entirely, regardless of whether the JSX gets reused for other
// customers/products later.
const PRINT_CSS = `
  @page { size: A4 portrait; margin: 2.2cm; }
  @media print { body { margin: 0; } .print-btn-row { display: none !important; } }
  .bp-doc { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.5;
    background: #fff; padding: 0 clamp(16px, 5vw, 48px); max-width: 960px; margin: 0 auto; }
  .bp-doc * { box-sizing: border-box; }
  .bp-doc p { orphans: 3; widows: 3; }
  .print-btn-row { text-align: center; margin-bottom: 18px; }
  .print-btn { display: inline-block; padding: 9px 26px; background: #1a1a1a; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-size: 13px; letter-spacing: .02em; }
  .bp-accent { height: 4px; background: #b8935a; border-radius: 2px; margin-bottom: 20px; }
  .bp-logo { height: 26px; width: auto; aspect-ratio: 617 / 108; margin-bottom: 16px; display: block; }
  .bp-hero { margin-bottom: 24px; }
  .bp-hero img { width: 100%; max-height: 320px; object-fit: cover; border-radius: 8px; display: block; margin-bottom: 12px; }
  .bp-eyebrow { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: #b8935a; font-weight: 600; margin-bottom: 4px; }
  .bp-tagline { font-size: 19px; font-weight: 700; margin: 0 0 6px; }
  .bp-briefing { color: #555; max-width: 640px; }
  .bp-section { margin-bottom: 26px; }
  .bp-section-head { page-break-after: avoid; break-after: avoid; }
  .bp-section h2 { font-size: 15px; margin: 0 0 2px; }
  .bp-section .stagline { font-size: 10.5px; font-weight: 600; color: #b8935a; margin: 0 0 4px; }
  .bp-section .sbriefing { color: #666; max-width: 640px; margin: 0 0 12px; }
  .bp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; page-break-before: avoid; break-before: avoid; }
  .bp-tile { border: 1px solid #eee; border-radius: 6px; overflow: hidden; page-break-inside: avoid; break-inside: avoid; }
  .bp-tile .ph { aspect-ratio: 1; background: #f7f4ee; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .bp-tile img { width: 100%; height: 100%; object-fit: contain; }
  .bp-tile .cap { padding: 6px 8px; }
  .bp-tile .cap .nm { font-size: 9.5px; margin: 0 0 2px; }
  .bp-tile .cap .ds { font-size: 8.5px; color: #777; line-height: 1.4; }
  /* Back to normal flow, NOT forced onto its own page (tried, reverted —
     produced an almost entirely blank page 8 with 3 lines of text at the
     bottom, confirmed live 2026-08-22 — worse than an imperfectly
     positioned footer). Sits wherever the last section's content ends. */
  .bp-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eee;
    text-align: center; font-size: 9px; color: #888; line-height: 1.6; page-break-inside: avoid; break-inside: avoid; }
  .bp-foot .nm { font-weight: 600; color: #555; }
  .bp-section-divider { border-top: 1px solid #eee; margin: 0 0 26px; }
`

// Printable/PDF-able copy of a customer's published Brand Portal proposal
// (owner, 2026-08-22: "can customer export the proposal in pdf") — same
// standalone-route-outside-CustomerLayout pattern as CustomerInvoicePrint.jsx
// (the nav chrome must not print or bleed into the "Save as PDF"), and the
// same data resolution BrandPortalPage.jsx already does, so the PDF always
// matches what the customer sees on the live page — never a denormalised
// snapshot that could drift from it. Only ever shows a PUBLISHED proposal;
// a draft/missing proposal is treated as "nothing to print" here exactly
// like BrandPortalPage's own catch-and-null handling.
export default function ProposalPrint({ profile }) {
  const customerId = profile?.customer_id || null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState(null) // resolved { proposal, heroAsset, sections }

  useEffect(() => {
    let alive = true
    if (!customerId) { setError('No proposal is linked to your account.'); setLoading(false); return }
    ;(async () => {
      try {
        const p = await loadProposal(customerId).catch(() => null)
        if (!p || p.status !== 'published') throw new Error('No published proposal is available yet.')
        const [visibleAssets, brandedImages] = await Promise.all([
          loadCustomerVisibleAssets(customerId),
          loadBrandedProductImages(customerId).then(imgs => imgs.filter(isStorefrontVisible)),
        ])
        if (!alive) return
        const assetsById = new Map(visibleAssets.map(a => [a.id, a]))
        for (const img of brandedImages) assetsById.set(`branded:${img.id}`, { ...img, filename: img.caption || 'photo.jpg' })
        const heroAsset = resolveProposalAsset(assetsById, p.hero_asset_id)
        const sections = await Promise.all(p.sections.map(async s => ({
          heading: s.heading, tagline: s.tagline, briefing: s.briefing,
          images: resolveProposalAssetIds(assetsById, s.asset_ids),
          products: await resolveProductRefs(s.product_refs, profile),
        })))
        if (!alive) return
        setProposal({ proposal: p, heroAsset, sections })
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this proposal.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [customerId])

  useEffect(() => {
    if (!proposal) return
    const prev = document.title
    document.title = pdfFileTitle(['Brand Proposal', profile?.company_name])
    return () => { document.title = prev }
  }, [proposal, profile?.company_name])

  // See PRINT_CSS's own comment above — injected into document.head as a
  // real DOM node, not rendered inline in the JSX (which put it inside
  // <body>), specifically so @page is reliably honored.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = PRINT_CSS
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  if (loading) return <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</p>
  if (error) return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>{error}</p>

  return (
    <div className="bp-doc">
      <div className="print-btn-row">
        <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="bp-accent" />
      <img className="bp-logo" src={logoUrl} alt="" width="617" height="108" />

      <div className="bp-hero">
        {proposal.heroAsset && <img src={proposal.heroAsset.file_url} alt="" />}
        <div className="bp-eyebrow">Brand Proposal</div>
        {proposal.proposal.tagline && <div className="bp-tagline">{proposal.proposal.tagline}</div>}
        {proposal.proposal.briefing && <div className="bp-briefing">{proposal.proposal.briefing}</div>}
      </div>

      {proposal.sections.map((s, i) => (
        <div key={i} className="bp-section">
          {i > 0 && <div className="bp-section-divider" />}
          <div className="bp-section-head">
            {s.heading && <h2>{s.heading}</h2>}
            {s.tagline && <p className="stagline">{s.tagline}</p>}
            {s.briefing && <p className="sbriefing">{s.briefing}</p>}
          </div>
          {(s.images.length > 0 || s.products.length > 0) && (
            <div className="bp-grid">
              {s.images.map(a => (
                <div key={a.id} className="bp-tile">
                  <div className="ph"><img src={a.file_url} alt="" /></div>
                  {(a.title || a.caption) && (
                    <div className="cap">
                      {a.title && <p className="nm">{a.title}</p>}
                      {a.caption && <p className="ds">{a.caption}</p>}
                    </div>
                  )}
                </div>
              ))}
              {s.products.map(prod => (
                <div key={`${prod.collection}-${prod.id}`} className="bp-tile">
                  <div className="ph">{prod.image && <img src={prod.image} alt="" />}</div>
                  <div className="cap">
                    <p className="nm">{prod.name}</p>
                    {prod.caption && <p className="ds">{prod.caption}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="bp-foot">
        <div className="nm">United Art Metals Factory Limited</div>
        <div>11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong</div>
        <div>WhatsApp: +852 4608 3219 | Email: sales@uart.com.hk</div>
      </div>
    </div>
  )
}
