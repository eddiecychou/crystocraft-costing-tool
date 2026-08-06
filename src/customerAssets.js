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

// Two categories, deliberately separate (owner, 2026-08-05):
//   'brand_asset'     — the client's own logo / brand guidelines. Never shows
//                        anyone else's branding; low sensitivity once cleared.
//   'product_gallery'  — OUR photos of THEIR branded product (a mockup, an
//                        in-use shot). This is the sensitive one — some are
//                        fine to reuse, some are not, and it needs a
//                        per-photo call, not a per-customer one.
// Both share the same visibility/consent model (§4); the split is about which
// types of asset an admin is choosing between, and how the galleries group.
export const CATEGORIES = ['brand_asset', 'product_gallery']
export const CATEGORY_LABEL = {
  brand_asset: 'Brand Assets',
  product_gallery: 'Product Gallery',
}
export const TYPES_BY_CATEGORY = {
  brand_asset: ['logo', 'guideline'],
  product_gallery: ['mockup', 'in_use', 'photo', 'other'],
}
export const ASSET_TYPES = [...TYPES_BY_CATEGORY.brand_asset, ...TYPES_BY_CATEGORY.product_gallery]
export const VISIBILITIES = ['internal_only', 'customer_private', 'public_reference']

export const VISIBILITY_LABEL = {
  internal_only:    'Internal only',
  customer_private: 'Customer private',
  public_reference: 'Public reference',
}
export const TYPE_LABEL = {
  logo: 'Logo', guideline: 'Brand Guideline',
  mockup: 'Mockup', in_use: 'In use', photo: 'Product Photo', other: 'Other',
}

// Category a type belongs to — used to backfill `category` on assets written
// before the field existed, so nothing already saved needs a migration.
const CATEGORY_OF_TYPE = Object.fromEntries(
  Object.entries(TYPES_BY_CATEGORY).flatMap(([cat, types]) => types.map(t => [t, cat]))
)
export const categoryOfType = type => CATEGORY_OF_TYPE[type] || 'product_gallery'

// Brand assets aren't only photos — a logo often only exists as vector art or
// a brand-guideline PDF/deck. These formats can't go through resizeToJpeg
// (nothing in a browser can decode .ai/.eps into pixels, and rasterizing an
// .svg would defeat the point of it being vector), so uploadCustomerAsset
// uploads them as-is instead. Kept as one shared list so the file picker's
// `accept` and the gallery's "can this render as an <img>" check never drift.
export const NON_RASTER_EXT = {
  '.ai':   'application/postscript',
  '.eps':  'application/postscript',
  '.pdf':  'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg':  'image/svg+xml',   // technically renderable, but never rasterized — see above
}
export const ASSET_UPLOAD_ACCEPT = `image/*,${Object.keys(NON_RASTER_EXT).join(',')}`

const extOf = filename => (/\.[^.]+$/.exec(filename || '')?.[0] || '').toLowerCase()
export const isNonRasterAsset = filename => extOf(filename) in NON_RASTER_EXT

// .svg IS in NON_RASTER_EXT (it must skip the resize-to-JPEG pipeline on
// upload — rasterizing it would defeat the point) but, unlike .ai/.eps/.pdf/
// .pptx, a browser renders it fine via a plain <img src>. Conflating the two
// meant SVGs got the file-icon placeholder instead of actually showing —
// this is the one exception the gallery's "can I render this as a thumbnail"
// check needs.
export const cannotRenderAsImage = filename => isNonRasterAsset(filename) && extOf(filename) !== '.svg'

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
  const type = ASSET_TYPES.includes(x.type) ? x.type : 'other'
  return {
    id: d.id,
    file_url: x.file_url || '',
    filename: x.filename || '',
    type,
    // Backfilled from type when absent — covers assets written before this
    // field existed, no migration script needed.
    category: CATEGORIES.includes(x.category) ? x.category : categoryOfType(type),
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

// Catalogue product photos tagged "branded for" this customer
// (products/{id}/images.branded_for_customer_id — see ProductDetail.jsx and
// firestore.rules viewerIsSensitive()). This is a SEPARATE source from the
// customers/{id}/assets docs above — tagging a photo on a product does not
// create an asset doc — so the Product Gallery views (admin + portal) read
// both and show them together, rather than requiring the same photo to be
// uploaded twice. Iterates each product's own images subcollection rather
// than a collectionGroup query, same reasoning as domain/customer.js's
// brandedImageDocs(): a collectionGroup equality filter needs a manually-
// created composite index; a collection-scoped where() doesn't.
export async function loadBrandedProductImages(customerId) {
  if (!customerId) return []
  try {
    const productsSnap = await getDocs(collection(db, 'products'))
    const perProduct = await Promise.all(productsSnap.docs.map(async p => {
      const imgSnap = await getDocs(query(collection(db, 'products', p.id, 'images'), where('branded_for_customer_id', '==', customerId)))
      return imgSnap.docs.map(d => ({ id: d.id, product_id: p.id, product_name: p.data().name || '', ...d.data() }))
    }))
    return perProduct.flat()
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
  const safeName = (file.name || 'image').replace(/[/\\?%*:|"<>]/g, '-')
  let blob, contentType
  if (isNonRasterAsset(file.name)) {
    // Vector art / documents go through untouched — resizing would either
    // fail outright (.ai/.eps/.pptx aren't image-decodable in a browser) or,
    // for .svg, silently rasterize away the thing that makes it useful.
    blob = file
    contentType = file.type || NON_RASTER_EXT[extOf(file.name)] || 'application/octet-stream'
  } else {
    ;({ blob } = await resizeToJpeg(file))
    contentType = 'image/jpeg'
  }
  const path = `customer-assets/${customerId}/${ref.id}/${safeName}`
  const sRef = storageRef(storage, path)
  await uploadBytes(sRef, blob, { contentType })
  const file_url = await getDownloadURL(sRef)
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  const category = CATEGORIES.includes(meta.category) ? meta.category : 'brand_asset'
  const typesHere = TYPES_BY_CATEGORY[category]
  const type = typesHere.includes(meta.type) ? meta.type : typesHere[0]
  await setDoc(ref, {
    file_url, filename: safeName, storage_path: path,
    category, type,
    visibility: 'internal_only',
    can_use_in_marketing: false,
    title: (meta.title || '').trim(),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    created_at: serverTimestamp(), created_by: by,
    updated_at: serverTimestamp(), updated_by: by,
  })
  return ref.id
}

// Update descriptor fields (category / type / visibility / consent / title / tags).
export async function updateCustomerAsset(customerId, assetId, patch) {
  const by = auth.currentUser?.email || auth.currentUser?.uid || ''
  const clean = {}
  if ('category' in patch)   clean.category = CATEGORIES.includes(patch.category) ? patch.category : 'product_gallery'
  // The caller (AssetDrawer) always sends category alongside type when either
  // changes, so this doc doesn't need a read to know the "other" one. If type
  // arrives alone, validate against the full list rather than guess a category.
  if ('type' in patch) {
    const typesHere = clean.category ? TYPES_BY_CATEGORY[clean.category] : ASSET_TYPES
    clean.type = typesHere.includes(patch.type) ? patch.type : typesHere[0]
  }
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
