// Proxy Firebase Storage images to the browser without CORS issues.
// Firebase Storage requires CORS config for direct browser fetch() — routing
// through a same-origin edge function sidesteps that entirely.
export default async function handler(req) {
  const urlParam = new URL(req.url).searchParams.get('url')
  if (!urlParam) return new Response('Missing url param', { status: 400 })

  // Only allow Firebase Storage and Firebase App Hosting domains
  let parsed
  try { parsed = new URL(urlParam) } catch {
    return new Response('Invalid URL', { status: 400 })
  }
  if (!parsed.hostname.endsWith('firebasestorage.googleapis.com') &&
      !parsed.hostname.endsWith('firebaseapp.com')) {
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
