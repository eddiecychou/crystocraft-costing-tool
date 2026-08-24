import { pdf } from '@react-pdf/renderer'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { loadProposal, resolveProposalAsset, resolveProductRefs } from './customerProposal'
import { loadCustomerVisibleAssets } from './customerAssets'
import BrandProposalPDF from './components/BrandProposalPDF'

// Builds and downloads the landscape Brand Proposal PDF (V8.10) for one
// customer — the data-resolution/image-inlining half of the feature;
// BrandProposalPDF.jsx is pure presentation and never fetches anything
// itself. Mirrors RangeCatalogueExport.jsx's own imageToDataURL split:
// react-pdf can't reliably follow a Firebase Storage URL from inside
// pdf().toBlob(), so every image is fetched through the download proxy and
// inlined as a data: URI before the Document is built.
async function imageToDataURL(url) {
  if (!url) return null
  try {
    let buf
    try {
      const res = await fetch(`/api/download-image?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('proxy failed')
      buf = await res.arrayBuffer()
    } catch {
      const res = await fetch(url)
      buf = await res.arrayBuffer()
    }
    const mime = url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'
    let binary = ''
    const bytes = new Uint8Array(buf)
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    return `data:${mime};base64,${btoa(binary)}`
  } catch {
    return null // a missing image is a blank frame, never a failed export
  }
}

// A product/asset is flagged "premium" heuristically — there's no dedicated
// field on product_refs/asset_ids today (see customerProposal.js's schema).
// Checks the per-item caption AND the resolved product's own name for any
// of these words, case-insensitive. Documented as a heuristic on purpose:
// if this proves unreliable in practice, the real fix is a proper
// `premium: boolean` on the proposal's product_refs schema, not a smarter
// keyword list.
const PREMIUM_WORDS = /\b(vip|hnw|signature|premium)\b/i
const isPremiumRef = (caption, name) => PREMIUM_WORDS.test(`${caption || ''} ${name || ''}`)

export async function buildBrandProposalPdf(customerId, profile, { onProgress, allowDraft = false } = {}) {
  const p = await loadProposal(customerId)
  if (!p || (p.status !== 'published' && !allowDraft)) throw new Error('No published proposal to export.')

  // The COVER/CLIENT NAME must be the actual customer this proposal is
  // for — NOT the logged-in portal account's own name/company. Owner,
  // 2026-08-24: "United Art is my testing account... I use my testing
  // account to link to Sunlife" — a test/proxy login viewing someone
  // else's proposal was showing ITS OWN name on the cover instead of the
  // real client's, because this used to read `profile.name`
  // (whoever's currently logged in) rather than the customer record the
  // proposal actually belongs to. Always fetched fresh from `customers/
  // {customerId}`, independent of who's viewing.
  const customerSnap = await getDoc(doc(db, 'customers', customerId))
  const customerCompanyName = customerSnap.exists() ? (customerSnap.data().company_name || '') : ''

  // assetsById only needs the hero — sections' own images[] (non-product
  // assets) aren't part of the adaptive PRODUCT grid the brief specifies,
  // so they're intentionally left out of the PDF body (still shown in the
  // portal itself, which has room for a looser mosaic).
  const visibleAssets = await loadCustomerVisibleAssets(customerId)
  const assetsById = new Map(visibleAssets.map(a => [a.id, a]))
  const heroAsset = resolveProposalAsset(assetsById, p.hero_asset_id)

  const resolvedSections = await Promise.all(p.sections.map(async (sec, i) => {
    const products = await resolveProductRefs(sec.product_refs, profile)
    return {
      key: `sec-${i}`,
      heading: sec.heading,
      tagline: sec.tagline,
      briefing: sec.briefing,
      products: products.map((prod, j) => ({
        key: `${sec.key}-${prod.collection}-${prod.id}-${j}`,
        name: prod.name,
        caption: prod.caption,
        image: prod.image,
        premium: isPremiumRef(prod.caption, prod.name),
      })),
    }
  }))

  // Inline every image used: hero + every product photo across every
  // section, bounded concurrency (same 6-at-a-time reasoning
  // RangeCatalogueExport.jsx already uses — enough to saturate the proxy
  // without burying it).
  const allImageUrls = [
    heroAsset?.file_url,
    ...resolvedSections.flatMap(s => s.products.map(pr => pr.image)),
  ].filter(Boolean)
  const uniqueUrls = [...new Set(allImageUrls)]
  const dataUrlByUrl = new Map()
  let done = 0
  const LIMIT = 6
  let next = 0
  await Promise.all(Array.from({ length: Math.min(LIMIT, uniqueUrls.length) }, async () => {
    while (next < uniqueUrls.length) {
      const i = next++
      const url = uniqueUrls[i]
      dataUrlByUrl.set(url, await imageToDataURL(url))
      onProgress?.(++done, uniqueUrls.length)
    }
  }))

  const heroDataUrl = heroAsset?.file_url ? dataUrlByUrl.get(heroAsset.file_url) : null
  const sectionsWithInlineImages = resolvedSections.map(sec => ({
    ...sec,
    products: sec.products.map(pr => ({ ...pr, image: pr.image ? dataUrlByUrl.get(pr.image) : null })),
  }))

  const blob = await pdf(
    <BrandProposalPDF
      client={{ name: customerCompanyName, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }}
      hero={heroDataUrl ? { image: heroDataUrl } : null}
      tagline={p.tagline}
      briefing={p.briefing}
      sections={sectionsWithInlineImages}
    />,
  ).toBlob()

  const stem = ['Crystocraft Brand Proposal', customerCompanyName, new Date().toISOString().slice(0, 10)]
    .filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '-')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${stem}.pdf`; a.click()
  URL.revokeObjectURL(url)
}
