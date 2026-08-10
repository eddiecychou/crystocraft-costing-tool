// Admin-only proxy from the browser to the Fly.io render service's
// swatch-registry endpoints (/swatches, /swatches/image/{filename}) — see
// Crystal_Fabric_Studio_Spec.md §5a. Those routes are gated on the Fly side
// by HTTP Basic auth (ADMIN_PASSWORD, app.py's require_admin) built for
// admin.html's photo-capture tool. This function holds the matching
// password server-side (RENDER_ADMIN_PASSWORD) and sends it as the Basic
// credential itself, so the browser never sees it — same reasoning as
// erp.js keeping the Supabase service key server-side.
//
// Gated on the CALLER being a signed-in Firebase admin (not the shared
// RENDER_TOKEN customizer-palette.js uses) — this exposes the swatch
// registry, an internal sales tool, not customer-facing data.
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

// Same self-read admin check erp.js uses.
async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
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

  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin only' }, 403)

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const flyAuth = { Authorization: `Basic ${btoa(`admin:${adminPassword}`)}` }

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
