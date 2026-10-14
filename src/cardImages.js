// Build the ordered image list for a catalogue card. `heroImage` is a cached
// URL on the product document; the images subcollection is the live gallery.
// A stale cache must never become a synthetic broken slide when the gallery
// already contains valid images.
export function buildCardImages(gallery = [], heroImage = null) {
  const live = gallery.filter(im => im?.file_url)
  const images = live.map(im => ({ url: im.file_url, caption: im.caption || '' }))
  const cachedHero = heroImage && images.some(im => im.url === heroImage) ? heroImage : null
  const galleryHero = live.find(im => im.is_hero)?.file_url || null
  const preferred = cachedHero || galleryHero

  if (preferred) {
    return [{ url: preferred, caption: '' }, ...images.filter(im => im.url !== preferred)]
  }
  if (images.length) return images
  return heroImage ? [{ url: heroImage, caption: '' }] : []
}

// Call with an already screened, storefront-visible gallery. A cached URL
// cannot override visibility or a live gallery; keep legacy cache-only records.
export function customerMainImage(visibleGallery, product, sensitive = false) {
  const chosen = visibleGallery.find(i => i.file_url === product.heroImage)
  if (chosen) return chosen.file_url
  if (visibleGallery.length) return visibleGallery.find(i => i.is_hero)?.file_url || visibleGallery[0].file_url
  return !sensitive && product.heroImage_visibility !== 'internal' ? product.heroImage || null : null
}
