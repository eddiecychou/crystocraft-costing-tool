// Proxy Firebase Storage images to the browser without CORS issues.
// Firebase Storage requires CORS config for direct browser fetch() — routing
// through a same-origin edge function sidesteps that entirely.
export default async function handler(req) {
  const urlParam = new URL(req.url).searchParams.get('url')
  if (!urlParam) return new Response('Missing url param', { status: 400 })

  // Only allow Firebase Storage / App Hosting, plus our own WordPress site
  // (crystocraft.com) — figurine gallery photos imported from the catalogue
  // blog are hosted there and otherwise can't be loaded into a canvas for the
  // manual image editor (WordPress serves no CORS headers).
  let parsed
  try { parsed = new URL(urlParam) } catch {
    return new Response('Invalid URL', { status: 400 })
  }
  const host = parsed.hostname
  const allowed =
    host.endsWith('firebasestorage.googleapis.com') ||
    host.endsWith('firebaseapp.com') ||
    host === 'crystocraft.com' || host.endsWith('.crystocraft.com')
  if (!allowed) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const upstream = await fetch(urlParam)
    if (!upstream.ok) return new Response('Upstream error', { status: upstream.status })
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    return new Response(err.message, { status: 500 })
  }
}

export const config = { path: '/api/image-proxy' }
