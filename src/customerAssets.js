import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage, auth } from './firebase'
import { resizeToJpeg } from './imageResize'

// Customer Brand Gallery data layer — see Customer_Brand_Gallery_Spec.md.
//
// Assets live in a NESTED subcollection `customers/{customerId}/assets` (not a
// top-level collection), so a logged-in portal user reads exactly their own
// customer's assets and the security rule is a simple field comparison. The
// privacy promise lives in the Firestore rule (spec §6); these helpers are the
// single place the same visibility logic is expressed on the client.

export const ASSET_TYPES = ['logo', 'mockup', 'in_use', 'other']
export const VISIBILITIES = ['internal_only', 'customer_private', 'public_reference']

export const VISIBILITY_LABEL = {
  internal_only:    'Internal only',
  customer_private: 'Customer private',
  public_reference: 'Public reference',
}
export const TYPE_LABEL = {
  logo: 'Logo', mockup: 'Mockup', in_use: 'In use', other: 'Other',
}

// ── Visibility helpers — the one source of truth, used by every surface ──────
// A customer may see any of their own assets that aren't internal-only.
export const visibleToCustomer = a => (a?.visibility || 'internal_only') !== 'internal_only'
// Marketing (blog / public catalogue / case study) needs BOTH public visibility
// AND explicit consent — the two flags are deliberately separate (spec §3).
export const usableInMarketing = a =>
  a?.visibility === 'public_reference' && a?.can_use_in_marketing === true

const COL = customerId => collection(db, 'customers', customerId, 'assets')

const norm = d => {
  const x = d.data()
  return {
    id: d.id,
    file_url: x.file_url || '',
    filename: x.filename || '',
    type: ASSET_TYPES.includes(x.type) ? x.type : 'other',
    visibility: VISIBILITIES.includes(x.visibility) ? x.visibility : 'internal_only',
    can_use_in_marketing: x.can_use_in_marketing === true,
    title: x.title || '',
    tags: Array.isArray(x.tags) ? x.tags : [],
    storage_path: x.storage_path || '',
    created_at: x.created_at || null,
    created_by: x.created_by || '',
  }
}

export async function loadCustomerAssets(customerId) {
  if (!customerId) return []
  try { return (await getDocs(query(COL(customerId), orderBy('created_at', 'desc')))).docs.map(norm) }
  catch { return [] }
}

// Customer-facing loader (portal "My Brand Gallery", spec §5.4). The query MUST
// exclude internal_only, because the Firestore rule (spec §6) rejects a read
// that could return an internal asset — the query constraint and the rule are
// two halves of the same guarantee. Admins use loadCustomerAssets (unconstrained)
// instead; a customer must use this one.
export async function loadCustomerVisibleAssets(customerId) {
  if (!customerId) return []
  try {
    // Filter only (no orderBy) to avoid needing a composite index; sort in JS.
    const q = query(COL(customerId), where('visibility', 'in', ['customer_private', 'public_reference']))
    const rows = (await getDocs(q)).docs.map(norm)
    return rows.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
  } catch { return [] }
}

export function useCustomerAssets(customerId) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!customerId) { setAssets([]); setLoading(false); return }
    setLoading(true)
    const q = query(COL(customerId), orderBy('created_at', 'desc'))
    return onSnapshot(q,
      snap => { setAssets(snap.docs.map(norm)); setLoading(false) },
      () => { setAssets([]); setLoading(false) },
    )
  }, [customerId])
  return { assets, loading }
}

// Upload a file and create its asset doc. Conservative defaults (spec §3):
// internal-only, no marketing consent — an admin must deliberately open it.
export async function uploadCustomerAsset(customerId, file, meta = {}) {
  const ref = doc(COL(customerId))                 // pre-generate id so the path can use it
  const { blob } = await resizeToJpeg(file)
  const safeName = (file.name || 'image').replace(/[/\\?%*:|"<>]/g, '-')
  const path = `customer-assets/${customerId}/${ref.id}/${safeName}`
  const sRef = storageRef(storage, path)
  await uploadBytes(sRef, blob, { contentType: 'image/jpeg' })
  const file_url = await getDownloadURL(sRef)
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  await setDoc(ref, {
    file_url, filename: safeName, storage_path: path,
    type: ASSET_TYPES.includes(meta.type) ? meta.type : 'logo',
    visibility: 'internal_only',
    can_use_in_marketing: false,
    title: (meta.title || '').trim(),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    created_at: serverTimestamp(), created_by: by,
    updated_at: serverTimestamp(), updated_by: by,
  })
  return ref.id
}

// Update descriptor fields (type / visibility / consent / title / tags).
export async function updateCustomerAsset(customerId, assetId, patch) {
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  const clean = {}
  if ('type' in patch)       clean.type = ASSET_TYPES.includes(patch.type) ? patch.type : 'other'
  if ('visibility' in patch) clean.visibility = VISIBILITIES.includes(patch.visibility) ? patch.visibility : 'internal_only'
  if ('can_use_in_marketing' in patch) clean.can_use_in_marketing = patch.can_use_in_marketing === true
  if ('title' in patch)      clean.title = (patch.title || '').trim()
  if ('tags' in patch)       clean.tags = Array.isArray(patch.tags) ? patch.tags : []
  await setDoc(doc(db, 'customers', customerId, 'assets', assetId),
    { ...clean, updated_at: serverTimestamp(), updated_by: by }, { merge: true })
}

// Delete the doc and its Storage object. A quote that snapshotted the URL keeps
// working; the export already falls back to the product hero image (spec §7).
export async function deleteCustomerAsset(customerId, asset) {
  await deleteDoc(doc(db, 'customers', customerId, 'assets', asset.id))
  if (asset.storage_path) {
    try { await deleteObject(storageRef(storage, asset.storage_path)) } catch { /* object already gone */ }
  }
}
