const OPTIMIZABLE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
])

// Catalogue cards never need the full upload. Netlify's image endpoint keeps
// the original URL (including its Firebase access token) server-side and
// returns a cached, content-negotiated thumbnail. Unknown hosts stay untouched.
export function cardImageUrl(url, width = 640) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (!OPTIMIZABLE_HOSTS.has(parsed.hostname)) return url
    return `/.netlify/images?url=${encodeURIComponent(url)}&w=${width}&q=72`
  } catch {
    return url
  }
}
