// Shared admin-auth check for edge functions that hold external credentials
// (Gemini, WordPress) or call an AI model on the app's dime — same pattern
// erp.js / uc.js / bank.js already used inline, factored out so it isn't
// re-copied (and subtly drifting) into every function that needs it.
//
// Added (bug-fix pack A-04, 2026-08-17): compose-message.js, extract-pi.js,
// extract-po.js, generate-blog.js, generate-marketing-copy.js,
// process-quote.js, publish-to-wordpress.js, rewrite-section.js and
// scrape-images.js had NO check at all — any unauthenticated request could
// burn Gemini/WordPress credentials this app pays for. All nine are called
// only from admin-only pages (verified by grepping every caller), so
// requireAdmin() is the correct gate — not a customer-accessible one.
//
// Lives in lib/, not the edge-functions root — Netlify's bundler auto-scans
// every top-level .js file in netlify/edge-functions/ and requires a
// default-exported handler, regardless of whether netlify.toml lists it as
// a routed function. Putting this at netlify/edge-functions/_auth.js broke
// the ENTIRE deploy ("Default export ... must be a function") the first
// time it shipped. A subdirectory is not auto-scanned.
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Returns the caller's { role, modules } from users/{uid}. V8.14 flat model:
// a `staff` account's access IS its modules[] list; anyone else gets []. Mirror
// of src/access.js resolveModules.
async function getUserRoleAndModules(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return { role: '', modules: [] }
  const doc = await r.json()
  const role = doc?.fields?.role?.stringValue || ''
  const raw = doc?.fields?.modules?.arrayValue?.values || []
  const modules = role === 'staff' ? raw.map(v => v?.stringValue).filter(Boolean) : []
  return { role, modules }
}
async function getUserRole(uid, idToken, projectId) {
  return (await getUserRoleAndModules(uid, idToken, projectId)).role
}

// Verifies the caller is a signed-in user whose role is in `allowedRoles`.
// Returns { ok: true, uid, email, role } on success, or { ok: false, response }
// — return `response` directly from the handler when ok is false. Today only
// `requireAdmin` uses it; per-capability gating is `requireModule` (V8.14).
export async function requireRole(req, allowedRoles) {
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!PROJECT_ID) return { ok: false, response: json({ error: 'Server not configured' }, 500) }

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return { ok: false, response: json({ error: 'Not signed in' }, 401) }

  let uid, email
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub; email = payload.email || null
  } catch {
    return { ok: false, response: json({ error: 'Invalid or expired session' }, 401) }
  }

  const role = await getUserRole(uid, token, PROJECT_ID)
  if (!allowedRoles.includes(role)) {
    return { ok: false, response: json({ error: 'Access denied' }, 403) }
  }
  return { ok: true, uid, email, role }
}

// Admin-only gate (unchanged contract).
export function requireAdmin(req) {
  return requireRole(req, ['admin'])
}

// V8.14 module gate — admin, OR a staff account whose users/{uid}.modules[]
// contains `moduleKey`. `moduleKey` may be a string or an array of keys
// (any-match) for a function reachable from pages in more than one module
// (e.g. product-copy AI is called from both the products and figurine pages).
// Returns { ok: true, uid, email, role, modules } on success.
export async function requireModule(req, moduleKey) {
  const wanted = Array.isArray(moduleKey) ? moduleKey : [moduleKey]
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!PROJECT_ID) return { ok: false, response: json({ error: 'Server not configured' }, 500) }

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return { ok: false, response: json({ error: 'Not signed in' }, 401) }

  let uid, email
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub; email = payload.email || null
  } catch {
    return { ok: false, response: json({ error: 'Invalid or expired session' }, 401) }
  }

  const { role, modules } = await getUserRoleAndModules(uid, token, PROJECT_ID)
  if (role !== 'admin' && !wanted.some((k) => modules.includes(k))) {
    return { ok: false, response: json({ error: 'Access denied' }, 403) }
  }
  return { ok: true, uid, email, role, modules }
}
