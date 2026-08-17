// Forces a "Save As" download for a file already in THIS app's own Firebase
// Storage bucket (a plain <a href=".." download> is silently ignored by most
// browsers for a cross-origin URL — Firebase Storage is — so without this it
// just opens the file instead of saving it; see ImageGallery.jsx /
// CustomerBrandGallery.jsx / BrandGalleryPage.jsx). Called from a plain
// anchor click (see those callers), which cannot attach an Authorization
// header — so this is not, and cannot be, gated behind Firebase sign-in the
// way the JSON-API edge functions are. What it CAN and must do is refuse to
// fetch anywhere except this app's own bucket.
//
// FIXED (bug-fix pack A-02, 2026-08-17): this used to accept ANY `url` and
// fetch it server-side with no restriction — an open proxy / SSRF primitive
// (an attacker could point it at cloud metadata endpoints, internal
// services, or arbitrary internet hosts and read the response back through
// this app's own domain). Every real caller only ever passes a
// getDownloadURL() result from this project's own bucket, so pinning the
// allowed host+bucket closes the hole without breaking any of them. No
// Content-Type allowlist: brand-gallery assets are deliberately non-image
// too (.ai/.eps/.pdf/.pptx — see customerAssets.js's cannotRenderAsImage).

const ALLOWED_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com'])
const MAX_BYTES = 50 * 1024 * 1024   // 50MB — comfortably above any real asset here
const FETCH_TIMEOUT_MS = 20000

function isAllowedStorageUrl(u, bucket) {
  if (u.protocol !== 'https:') return false
  if (!ALLOWED_HOSTS.has(u.hostname)) return false
  if (!bucket) return true   // bucket env var not set — host allowlist alone still blocks SSRF
  // firebasestorage.googleapis.com/v0/b/<bucket>/o/...  or  storage.googleapis.com/<bucket>/...
  return u.pathname.includes(`/b/${bucket}/`) || u.pathname.startsWith(`/${bucket}/`)
}

export default async function handler(req) {
  const params = new URL(req.url).searchParams
  const rawUrl = params.get('url')
  const filename = (params.get('filename') || 'image.jpg').replace(/[/\\]/g, '_').slice(0, 200)

  if (!rawUrl) return new Response('Missing url param', { status: 400 })

  let target
  try { target = new URL(rawUrl) } catch { return new Response('Bad url param', { status: 400 }) }

  const bucket = Deno.env.get('VITE_FIREBASE_STORAGE_BUCKET') || Deno.env.get('FIREBASE_STORAGE_BUCKET') || ''
  if (!isAllowedStorageUrl(target, bucket)) {
    return new Response('URL not allowed — only this app\'s own Storage bucket may be downloaded through this endpoint', { status: 403 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    res = await fetch(target, { signal: controller.signal, redirect: 'error' })
  } catch {
    return new Response('Failed to fetch image', { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) return new Response('Failed to fetch image', { status: 502 })

  const declaredLength = Number(res.headers.get('Content-Length') || 0)
  if (declaredLength > MAX_BYTES) return new Response('File too large', { status: 413 })

  const blob = await res.arrayBuffer()
  if (blob.byteLength > MAX_BYTES) return new Response('File too large', { status: 413 })

  return new Response(blob, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

export const config = { path: '/api/download-image' }
