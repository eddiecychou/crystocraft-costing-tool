// Shared SSRF guard for edge functions that fetch a caller-supplied URL
// server-side. Extracted 2026-09-28 (whole-repo security review) from
// download-image.js's own hardening (bug-fix pack A-02, 2026-08-17) — that
// function got https-only + host allowlist + redirect:'error' + timeout +
// size cap; image-proxy.js (same job, also unauthenticated) got none of it,
// and its allowlist used a bare `endsWith('firebaseapp.com')` with no
// leading dot, so `notfirebaseapp.com` (a real, registerable domain) passed.
// That's the exact failure LESSONS-LEARNED L-28 already covers once
// (image-proxy.js / download-image.js diverging on the SAME allowlist) —
// this is one shared implementation instead of a third hand-copied one.
//
// isAllowedHost: dot-anchored suffix match — `host === base || host.endsWith('.' + base)`
// never a bare `endsWith(base)`, which a domain like `notfirebaseapp.com`
// would pass.
export function isAllowedHost(hostname, allowedBases) {
  return allowedBases.some(base => hostname === base || hostname.endsWith('.' + base))
}

// fetchGuarded(url, { allowedBases, maxBytes, timeoutMs })
// Returns { ok:true, res, blob } or { ok:false, status, message }. Never
// follows a redirect (redirect:'error') — a same-allowlist-passing host that
// 302s to an internal address must not be silently followed there.
export async function fetchGuarded(rawUrl, { allowedBases, maxBytes = 20 * 1024 * 1024, timeoutMs = 15000 }) {
  let target
  try { target = new URL(rawUrl) } catch { return { ok: false, status: 400, message: 'Invalid URL' } }
  if (target.protocol !== 'https:') return { ok: false, status: 403, message: 'Only https URLs are allowed' }
  if (!isAllowedHost(target.hostname, allowedBases)) return { ok: false, status: 403, message: 'Host not allowed' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(target, { signal: controller.signal, redirect: 'error' })
  } catch (e) {
    return { ok: false, status: 502, message: 'Fetch failed: ' + (e?.message || 'unknown') }
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) return { ok: false, status: res.status, message: `Upstream returned ${res.status}` }

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) return { ok: false, status: 413, message: 'File too large' }

  const blob = await res.arrayBuffer()
  if (blob.byteLength > maxBytes) return { ok: false, status: 413, message: 'File too large' }

  return { ok: true, res, blob }
}
