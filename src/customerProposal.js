import {
  doc, getDoc, setDoc, serverTimestamp, collection, query, orderBy, getDocs,
} from 'firebase/firestore'
import { db, auth } from './firebase'
import { normGallery, isStorefrontVisible, productStatusOf } from './constants'
import { screenSensitiveImages } from './sensitiveImages'

// Customer proposal data layer — see Sun-Life-Proposal-Build-Spec.md §3/§6.
//
// Single doc per customer, fixed id 'current': customers/{customerId}/proposal/current.
// References existing assets/products by id — never denormalises a file_url
// or product name into this doc (spec §3.3). Resolving those refs against the
// live, privacy-screened loaders (loadCustomerVisibleAssets, product queries)
// is the caller's job (ProposalPage in Phase 4) — this module only reads/
// writes the proposal doc itself.

const DOC_ID = 'current'
const proposalRef = customerId => doc(db, 'customers', customerId, 'proposal', DOC_ID)

// A caption is a short "why this fits" line under one card, not a product
// description — capped so it reads as a caption on every screen size rather
// than overflowing the card (ProposalEditor's input and ProposalPage's
// line-clamp both assume this bound). Enforced here, the one place every
// caption passes through on save, not just at the input widget.
export const CAPTION_MAX_LEN = 200

const emptyProposal = {
  status: 'draft',
  hero_asset_id: null,
  tagline: '',
  briefing: '',
  sections: [],
}

const norm = data => ({
  status: data.status === 'published' ? 'published' : 'draft',   // spec §8.4: invalid/missing -> draft
  hero_asset_id: data.hero_asset_id || null,
  tagline: data.tagline || '',
  briefing: data.briefing || '',
  sections: Array.isArray(data.sections) ? data.sections.map(normSection) : [],
  updated_at: data.updated_at || null,
  updated_by: data.updated_by || '',
  created_at: data.created_at || null,
  created_by: data.created_by || '',
})

// asset_ids/product_refs items carry a per-item `caption` — the admin's own
// note on why this particular image/product is in the section (owner,
// post-launch: "so I can describe why the product fits the category"). Kept
// on the reference itself, not the asset/product doc, same "reference, not
// copy" reasoning as everything else here (spec §3.3) — the caption is about
// THIS proposal's use of the item, not a property of the item itself.
//
// Both entry shapes are normalized to { id, caption } / { collection, id,
// caption } — accepts the older plain-string / no-caption shape from before
// this field existed, so nothing already saved needs a migration.
const clampCaption = c => String(c || '').slice(0, CAPTION_MAX_LEN)
const normAssetRef = a => (typeof a === 'string' ? { id: a, caption: '' } : { id: a?.id || '', caption: clampCaption(a?.caption) })
const normProductRef = r => ({
  collection: r?.collection === 'range_products' ? 'range_products' : 'products',
  id: r?.id || '',
  caption: clampCaption(r?.caption),
})

const normSection = s => ({
  heading: s?.heading || '',
  tagline: s?.tagline || '',
  briefing: s?.briefing || '',
  asset_ids: Array.isArray(s?.asset_ids) ? s.asset_ids.map(normAssetRef).filter(a => a.id) : [],
  product_refs: Array.isArray(s?.product_refs)
    ? s.product_refs.map(normProductRef).filter(r => r.id && (r.collection === 'products' || r.collection === 'range_products'))
    : [],
})

// Admin loader — no status filter (an admin previews drafts). Customer-facing
// reads go through Firestore rules directly (Phase 3), not this function.
export async function loadProposal(customerId) {
  if (!customerId) return null
  const snap = await getDoc(proposalRef(customerId))
  return snap.exists() ? norm(snap.data()) : null
}

// Merge-write. Never touches status — publishProposal/unpublishProposal own
// that field so a content edit can't accidentally flip visibility.
export async function saveProposal(customerId, patch) {
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  const ref = proposalRef(customerId)
  const existing = await getDoc(ref)
  const clean = {}
  if ('hero_asset_id' in patch) clean.hero_asset_id = patch.hero_asset_id || null
  if ('tagline' in patch)       clean.tagline = String(patch.tagline || '')
  if ('briefing' in patch)      clean.briefing = String(patch.briefing || '')
  if ('sections' in patch)      clean.sections = Array.isArray(patch.sections) ? patch.sections.map(normSection) : []

  await setDoc(ref, {
    ...(!existing.exists() ? { ...emptyProposal, created_at: serverTimestamp(), created_by: by } : {}),
    ...clean,
    updated_at: serverTimestamp(), updated_by: by,
  }, { merge: true })
}

export async function publishProposal(customerId) {
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  await setDoc(proposalRef(customerId), { status: 'published', updated_at: serverTimestamp(), updated_by: by }, { merge: true })
}

export async function unpublishProposal(customerId) {
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  await setDoc(proposalRef(customerId), { status: 'draft', updated_at: serverTimestamp(), updated_by: by }, { merge: true })
}

// ── Render-time resolution (spec §5.2/§8) — references only, resolved fresh ──
// against the live, privacy-screened sources. An id/ref that no longer
// resolves (asset downgraded/deleted, product retired) is dropped, not
// rendered broken — never denormalise a file_url/name into the proposal doc
// itself (spec §3.3).

// assetsById: Map<id, asset> from loadCustomerVisibleAssets, keyed by id.
export function resolveProposalAsset(assetsById, assetId) {
  if (!assetId) return null
  return assetsById.get(assetId) || null
}
// assetRefs: [{ id, caption }] — resolves each id and attaches its own
// caption to the resolved asset object, dropping any that no longer resolve.
export function resolveProposalAssetIds(assetsById, assetRefs) {
  const seen = new Set()
  const out = []
  for (const ref of (assetRefs || [])) {
    const id = typeof ref === 'string' ? ref : ref?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const a = assetsById.get(id)
    if (a) out.push({ ...a, caption: (typeof ref === 'object' && ref?.caption) || '' })
  }
  return out
}

// Resolve product_refs against the live catalogue, mirroring each shop's own
// visibility filter (CorporateShop.jsx / FigurineShop.jsx) and the sensitive-
// viewer image screen (sensitiveImages.js) — a proposal must degrade exactly
// like the shop does, never show a retired product or a hero branded for a
// different customer. Dedupes by (collection, id); each ref's own caption
// travels onto the resolved product.
export async function resolveProductRefs(refs, profile) {
  const seen = new Set()
  const unique = (refs || []).filter(r => {
    const k = `${r.collection}:${r.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const resolved = await Promise.all(unique.map(async r => {
    if (r.collection === 'range_products') {
      const snap = await getDoc(doc(db, 'range_products', r.id))
      if (!snap.exists()) return null
      const p = snap.data()
      if (p.active === false || p.status === 'retired') return null
      const image = normGallery(p.gallery)[0]?.url || ''
      return {
        collection: 'range_products', id: r.id, caption: r.caption || '',
        name: p.design_name || p.description || p.design_code || r.id,
        image, to: `/shop/figurine/${r.id}`,
      }
    }
    const snap = await getDoc(doc(db, 'products', r.id))
    if (!snap.exists()) return null
    const p = snap.data()
    if (p.active === false || productStatusOf(p.status).value === 'retired') return null
    let image = p.heroImage || ''
    try {
      const imgSnap = await getDocs(query(collection(db, 'products', r.id, 'images'), orderBy('sort_order')))
      const imgs = screenSensitiveImages(imgSnap.docs.map(d => d.data()), profile).filter(im => im.file_url && isStorefrontVisible(im))
      const heroOk = image && imgs.some(im => im.file_url === image)
      image = heroOk ? image : (imgs[0]?.file_url || '')
    } catch { image = '' }
    return { collection: 'products', id: r.id, caption: r.caption || '', name: p.name || r.id, image, to: `/shop/corporate/${r.id}` }
  }))
  return resolved.filter(Boolean)
}
