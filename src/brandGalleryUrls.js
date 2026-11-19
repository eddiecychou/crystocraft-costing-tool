// Stable references can be stored on quotes. Access is checked when bytes are read.
export const galleryEndpoint = '/api/brand-gallery-media'
export const galleryVisible = visibility => ['customer_private', 'public_reference'].includes(visibility)
export const galleryUrl = (company, asset, filename) =>
  galleryEndpoint + '?' + new URLSearchParams({ company, asset, filename })

export function galleryReference(value, bucket) {
  if (!value || typeof value !== 'string') return null
  if (value.startsWith(galleryEndpoint + '?')) return value
  try {
    const url = new URL(value)
    if (url.origin !== 'https://firebasestorage.googleapis.com' || !bucket) return null
    const prefix = '/v0/b/' + bucket + '/o/'
    if (!url.pathname.startsWith(prefix)) return null
    const parts = decodeURIComponent(url.pathname.slice(prefix.length)).split('/')
    if (parts.length === 4 && parts[0] === 'customer-assets' && parts.slice(1).every(Boolean)) {
      return galleryUrl(...parts.slice(1))
    }
  } catch { /* Ordinary product URL. */ }
  return null
}

export const galleryDisplayUrl = value =>
  galleryReference(value, import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || value
