const endpoint = '/api/brand-gallery-media'
const headers = {
  'Cache-Control': 'private, no-store', 'Netlify-CDN-Cache-Control': 'no-store',
  'Vary': 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "sandbox; default-src 'none'",
}
const deny = (status, message = 'Gallery file unavailable.') => new Response(message, { status, headers })
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const bindingPattern = /^[a-f0-9-]{36}$/
function galleryToken(req) {
  const bearer = req.headers.get('authorization')?.match(/^Bearer ([\w.-]{1,6000})$/)?.[1]
  if (bearer) return bearer
  const cookies = Object.fromEntries((req.headers.get('cookie') || '').split(';').map(s => s.trim().split('=')))
  const [binding, token] = (cookies.oc_gallery || '').split(':')
  return bindingPattern.test(binding) && binding === cookies.oc_gallery_binding && token
}

// Public image transformations and download proxies must never serve gallery originals.
export function isGalleryStorageUrl(value) {
  try {
    const url = new URL(value)
    return ['storage.googleapis.com', 'firebasestorage.googleapis.com'].includes(url.hostname) &&
      decodeURIComponent(url.pathname).split('/').includes('customer-assets')
  } catch { return false }
}

export function createBrandGalleryHandler({ getProfile, readAsset, readObject }) {
  return async req => {
    const url = new URL(req.url)
    if (req.method === 'POST') {
      const binding = req.headers.get('X-Gallery-Binding')
      const token = req.headers.get('authorization')?.match(/^Bearer ([\w.-]{1,3900})$/)?.[1]
      if (req.headers.get('origin') !== url.origin || !token || !bindingPattern.test(binding)) return deny(403)
      // Firestore verifies this credential and the current profile on every GET.
      return new Response(null, { status: 204, headers: { ...headers,
        'Set-Cookie': 'oc_gallery=' + binding + ':' + token + '; Path=' + endpoint + '; HttpOnly; Secure; SameSite=Strict; Max-Age=3600',
      } })
    }
    if (!['GET', 'HEAD'].includes(req.method)) return deny(405)
    const token = galleryToken(req)
    if (!token) return deny(401)
    const company = url.searchParams.get('company'), asset = url.searchParams.get('asset')
    if (!id(company) || !id(asset)) return deny(400)
    try {
      const profile = await getProfile(token)
      const crm = profile?.role === 'admin' || profile?.role === 'staff' && Array.isArray(profile.modules) && profile.modules.includes('customers')
      if (!crm && !(profile?.role === 'customer' && profile.status === 'approved' && profile.company === company)) return deny(403)
      const result = await readAsset(company, asset, token)
      if (!result.ok) return deny([401,403,404].includes(result.status) ? result.status : 503)
      const fields = (await result.json()).fields || {}
      if (!crm && !['customer_private', 'public_reference'].includes(fields.visibility?.stringValue)) return deny(403)
      const path = fields.storage_path?.stringValue || ''
      // Only the trusted customer merge operation may attest a transferred path.
      if (!path.startsWith('customer-assets/' + company + '/' + asset + '/') && fields.gallery_original_path?.stringValue !== path) return deny(404)
      const parts = path.split('/')
      if (parts.length !== 4 || parts[0] !== 'customer-assets' || !id(parts[1]) || !id(parts[2]) || !parts[3] || parts.includes('..') || parts.includes('.')) return deny(404)
      const original = await readObject(path, req.method, req.headers.get('range'))
      if (!original.ok) return deny(original.status === 404 ? 404 : original.status === 416 ? 416 : 503)
      const responseHeaders = new Headers(headers)
      const mime = original.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream'
      responseHeaders.set('Content-Type', mime)
      for (const key of ['Content-Length','Content-Range','Accept-Ranges']) {
        if (original.headers.has(key)) responseHeaders.set(key, original.headers.get(key))
      }
      const name = (fields.filename?.stringValue || parts[3]).replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      const disposition = !url.searchParams.has('download') && /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/pdf)$/.test(mime) ? 'inline' : 'attachment'
      responseHeaders.set('Content-Disposition', disposition + '; filename="' + name.replace(/[^\x20-\x7e]|["\\]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)))
      return new Response(original.body, { status: original.status, headers: responseHeaders })
    } catch { return deny(503) }
  }
}
