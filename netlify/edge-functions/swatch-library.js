// Proxy from the browser to the Fly.io render service's swatch-registry
// endpoints (/swatches, /swatches/image/{filename}) — see
// Crystal_Fabric_Studio_Spec.md §5a/§5b. Those routes are gated on the Fly
// side by a signed `admin_session` cookie (ADMIN_PASSWORD, app.py's
// require_admin/_session_valid) — HTTP Basic auth was removed there on
// 2026-08-11 (browsers cache Basic credentials per-origin with no way to
// clear a stale one; see app.py's module docstring). This function holds
// the matching password server-side (RENDER_ADMIN_PASSWORD) and computes
// that same signed cookie itself (renderSessionCookie, below — same
// `<issued-at>.<hmac-sha256>` scheme as app.py's _session_token/
// _session_valid) rather than sending the password, so the browser never
// sees it — same reasoning as erp.js keeping the Supabase service key
// server-side. V8.1, owner: swatch photos were 401ing for every caller
// (mis-attributed at first to mobile token staleness) once the Fly side's
// auth scheme changed out from under this still-Basic-auth proxy.
//
// Gated on the caller being a signed-in Firebase admin OR an approved
// portal customer (Phase 2b, owner 2026-08-11: "grant every approved
// portal customer" — the crystal fabric line rides on the same corporate
// gift customer base, no separate designer/distributor account type).
// Registry photos are the swatch material itself, not pricing or margin
// data — safe to hand any signed-in customer, unlike /api/erp.
//
// Env (Netlify site vars, server-side only):
//   RENDER_SERVICE_URL     — e.g. https://crystocraft-customizer-render.fly.dev
//   RENDER_ADMIN_PASSWORD  — must equal the Fly service's ADMIN_PASSWORD
//   VITE_FIREBASE_PROJECT_ID (or FIREBASE_PROJECT_ID)
//
// Request:  GET ?action=list                    -> proxies GET /swatches
//           GET ?action=image&file=<filename>    -> proxies GET /swatches/image/<filename>
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Mirrors app.py's _session_token()/_session_valid(): a `<unix-ts>.<hex
// hmac-sha256 of the ts, keyed on ADMIN_PASSWORD>` cookie value. Computed
// fresh per request rather than cached, so there's no separate expiry to
// track here — app.py accepts anything under 30 days old.
async function renderSessionCookie(adminPassword) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(adminPassword), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const payload = String(Math.floor(Date.now() / 1000))
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const mac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${payload}.${mac}`
}

// Same self-read pattern erp.js's isAdmin() uses, widened to "canShop"
// (admin, or an approved customer) — the client-side equivalent this app
// already uses for Firestore rules (canShop() in firestore.rules).
async function canAccess(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  const role = doc?.fields?.role?.stringValue
  const status = doc?.fields?.status?.stringValue
  return role === 'admin' || (role === 'customer' && status === 'approved')
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const base = Deno.env.get('RENDER_SERVICE_URL')
  const adminPassword = Deno.env.get('RENDER_ADMIN_PASSWORD')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!base || !adminPassword || !PROJECT_ID) {
    return json({ error: 'Server not configured' }, 500)
  }

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }

  if (!(await canAccess(uid, token, PROJECT_ID))) return json({ error: 'Approved account required' }, 403)

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const flyAuth = { Cookie: `admin_session=${await renderSessionCookie(adminPassword)}` }

  try {
    if (action === 'image') {
      const file = url.searchParams.get('file') || ''
      const r = await fetch(`${base.replace(/\/$/, '')}/swatches/image/${encodeURIComponent(file)}`, { headers: flyAuth })
      const buf = await r.arrayBuffer()
      return new Response(buf, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'image/jpeg' } })
    }
    const r = await fetch(`${base.replace(/\/$/, '')}/swatches`, { headers: flyAuth })
    const buf = await r.arrayBuffer()
    return new Response(buf, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } })
  } catch (err) {
    return json({ error: `swatch-library proxy failed: ${err.message}` }, 502)
  }
}
