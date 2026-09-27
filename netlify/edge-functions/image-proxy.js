// Proxy Firebase Storage images to the browser without CORS issues.
// Firebase Storage requires CORS config for direct browser fetch() — routing
// through a same-origin edge function sidesteps that entirely.
//
// FIXED 2026-09-28 (whole-repo security review): the allowlist used a bare
// `host.endsWith('firebaseapp.com')` with no leading dot, so a real,
// registerable domain like `notfirebaseapp.com` passed it — combined with no
// redirect:'error', no timeout and no size cap, and `fetch()` following
// redirects by default, this was a full-read open proxy wearing this app's
// own domain (register that host, 302 to an internal address, get the body
// back with Access-Control-Allow-Origin:*). download-image.js was already
// fixed for the identical failure (LESSONS-LEARNED L-28); this pulls both
// onto one shared, dot-anchored implementation instead of leaving a second,
// weaker copy of the same check. See lib/fetchGuard.js.
import { fetchGuarded } from './lib/fetchGuard.js'

const ALLOWED_HOSTS = ['firebasestorage.googleapis.com', 'firebaseapp.com', 'crystocraft.com']

export default async function handler(req) {
  const urlParam = new URL(req.url).searchParams.get('url')
  if (!urlParam) return new Response('Missing url param', { status: 400 })

  const result = await fetchGuarded(urlParam, { allowedBases: ALLOWED_HOSTS, maxBytes: 20 * 1024 * 1024 })
  if (!result.ok) return new Response(result.message, { status: result.status })

  return new Response(result.blob, {
    headers: {
      'Content-Type': result.res.headers.get('content-type') || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export const config = { path: '/api/image-proxy' }
