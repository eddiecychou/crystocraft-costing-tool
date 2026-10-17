// Browser-only caching retains the existing access policy. Timestamped upload
// paths change on replacement, so a cached old file cannot mask a new photo.
export const CATALOGUE_IMAGE_CACHE_CONTROL = 'private, max-age=86400'

export function catalogueUploadMetadata(path, contentType = 'image/jpeg') {
  const metadata = { contentType }
  if (/^(products\/[^/]+\/images\/|range_products\/[^/]+\/)/.test(path) && contentType.startsWith('image/')) {
    metadata.cacheControl = CATALOGUE_IMAGE_CACHE_CONTROL
  }
  return metadata
}

export const isCurrentHero = (image, heroUrl) => Boolean(image?.is_hero || (heroUrl && image?.file_url === heroUrl))

export function productHeroPatch(image) {
  return {
    heroImage: image?.file_url || null,
    heroImage_visibility: image ? (image.visibility || 'public') : 'internal',
    heroImage_branded_for_customer_id: image?.branded_for_customer_id || null,
  }
}

export function chooseGalleryHero(gallery, cachedUrl) {
  const images = gallery.filter(i => i?.file_url).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  return images.find(i => i.file_url === cachedUrl) || images.find(i => i.is_hero) || images[0] || null
}

// Only referenced images in the owning catalogue record may be repaired.
// A supplier/customer URL or another bucket can never become a metadata target.
export function catalogueStoragePath(url, bucket, collection, id) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/)
    if (!match || match[1] !== bucket) return null
    const path = decodeURIComponent(match[2])
    const prefix = collection === 'products' ? `products/${id}/images/` : collection === 'range_products' ? `range_products/${id}/` : null
    return prefix && path.startsWith(prefix) && !path.includes('/../') ? path : null
  } catch { return null }
}

// Edited bytes need a new public review; keep the client's branding tag on copies.
export function editedImageAccess(image,showVisibility){
  const current=image?.visibility || 'private' // legacy images already show in the storefront
  return {branded_for_customer_id:image?.branded_for_customer_id ?? null,
    ...(showVisibility?{visibility:current==='public'?'private':(['private','internal'].includes(current)?current:'internal')}: {})}
}
