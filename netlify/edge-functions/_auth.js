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
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

// Verifies the caller is a signed-in, approved admin of this app. Returns
// { ok: true, uid, email } on success, or { ok: false, response } — return
// `response` directly from the handler when ok is false.
export async function requireAdmin(req) {
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

  if (!(await isAdmin(uid, token, PROJECT_ID))) {
    return { ok: false, response: json({ error: 'Admin access required' }, 403) }
  }
  return { ok: true, uid, email }
}
