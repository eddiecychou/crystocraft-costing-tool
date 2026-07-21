// ── Product source adapter ────────────────────────────────────────────────────
// Corporate gifts (`products`) and the Crystocraft range (`range_products`) have
// very different shapes (fields, images, pricing). Features like the Blog writer
// only need a common subset, so this module normalizes either collection into one
// shape and isolates the messy field-mapping in a single tested place.
//
// Common blog shape:
//   { id, source, name, category, description, marketing_description, status, images }
// where each image is { file_url, alt_text, label, caption }.

import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from './firebase'
import { galleryUrl } from './constants'

export const PRODUCT_SOURCES = [
  { value: 'corporate', label: 'Corporate Gifts', collection: 'products' },
  { value: 'range',     label: 'Crystocraft Range', collection: 'range_products' },
]

// Range stores variants inline (or a legacy `finishes` array) — mirror the
// storefront's resolution so blog content matches what customers see.
function rangeVariants(p) {
  if (Array.isArray(p.variants) && p.variants.length) return p.variants
  return (p.finishes || []).map(f => ({
    plating_name: f.finish_name, sku: f.sku,
    ws_price_usd: f.ws_price_usd, image: f.image, description: f.finish_name,
  }))
}

// Model-level normalization: one entry per design, deduped images from the
// model gallery first, then each variant's photo.
function normalizeRangeModel(p) {
  const seen = new Set()
  const images = []
  const push = (url, label) => {
    if (url && !seen.has(url)) {
      seen.add(url)
      images.push({
        file_url: url,
        alt_text: p.design_name || label || '',
        label: label || p.design_name || '',
        caption: '',
      })
    }
  }
  ;(p.gallery || []).forEach(g => push(galleryUrl(g), p.design_name))
  rangeVariants(p).forEach(v => push(v.image, v.description || v.plating_name))

  return {
    id: p.id,
    source: 'range',
    name: p.design_name || p.description || p.design_code || 'Untitled design',
    category: p.design_type || p.category || 'Crystocraft Range',
    description: p.description || '',
    marketing_description: p.marketing_description || '',  // AI-written range sell-copy
    status: p.active === false ? 'hidden' : 'active',
    heroImage: images[0]?.file_url || '',  // row thumbnail (matches corporate field)
    images,
  }
}

// Load the selectable product list for the blog writer, normalized by source.
export async function loadBlogProducts(source) {
  if (source === 'range') {
    const snap = await getDocs(query(collection(db, 'range_products'), orderBy('design_code')))
    return snap.docs
      .map(d => normalizeRangeModel({ id: d.id, ...d.data() }))
      .filter(p => p.status !== 'hidden')  // never feature hidden designs
  }
  const snap = await getDocs(query(collection(db, 'products'), orderBy('name')))
  return snap.docs
    .map(d => ({ id: d.id, source: 'corporate', ...d.data() }))
    // `active !== false`, not `active === true`: products created before the
    // flag existed have no such field and must stay visible.
    .filter(p => p.active !== false)
}

// Resolve the image list for one selected product. Range images are already on
// the normalized object; corporate images live in an `images` sub-collection.
// Range image docs carry no `visibility` field, so the caller's isPublicVisible
// filter treats them as public automatically.
export async function loadBlogImages(source, product) {
  if (source === 'range') return product?.images || []
  if (!product?.id) return []
  const snap = await getDocs(query(collection(db, 'products', product.id, 'images'), orderBy('sort_order')))
  return snap.docs.map(d => d.data())
}
