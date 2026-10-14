const OPTIMIZABLE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'www.crystocraft.com',
  'crystocraft.com',
])

// Catalogue cards never need the full upload. Netlify's image endpoint keeps
// the source's download URL and returns a resized WebP thumbnail. This is
// delivery optimisation, not an access-control boundary. Unknown hosts stay untouched.
export function cardImageUrl(url, width = 640) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !OPTIMIZABLE_HOSTS.has(parsed.hostname)) return url
    if (parsed.hostname.endsWith('crystocraft.com') && !parsed.pathname.startsWith('/wp-content/uploads/')) return url
    return `/.netlify/images?url=${encodeURIComponent(url)}&w=${width}&fm=webp&q=72`
  } catch {
    return url
  }
}
