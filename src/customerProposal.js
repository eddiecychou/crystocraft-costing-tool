import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from './firebase'

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

const emptyProposal = {
  status: 'draft',
  hero_asset_id: null,
  tagline: '',
  briefing: '',
  sections: [],
  cta_label: 'Make an enquiry',
}

const norm = data => ({
  status: data.status === 'published' ? 'published' : 'draft',   // spec §8.4: invalid/missing -> draft
  hero_asset_id: data.hero_asset_id || null,
  tagline: data.tagline || '',
  briefing: data.briefing || '',
  sections: Array.isArray(data.sections) ? data.sections.map(normSection) : [],
  cta_label: data.cta_label || 'Make an enquiry',
  updated_at: data.updated_at || null,
  updated_by: data.updated_by || '',
  created_at: data.created_at || null,
  created_by: data.created_by || '',
})

const normSection = s => ({
  heading: s?.heading || '',
  tagline: s?.tagline || '',
  briefing: s?.briefing || '',
  asset_ids: Array.isArray(s?.asset_ids) ? s.asset_ids : [],
  product_refs: Array.isArray(s?.product_refs)
    ? s.product_refs.filter(r => r && (r.collection === 'products' || r.collection === 'range_products') && r.id)
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
  if ('cta_label' in patch)     clean.cta_label = String(patch.cta_label || '') || 'Make an enquiry'

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
