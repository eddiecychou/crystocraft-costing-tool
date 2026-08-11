// Daily Drafts re-engagement engine (V7.23) — lets DailyDrafts.jsx search
// PUBLISHED crystocraft.com blog posts to attach a real link to an outreach
// email. A thin server-side proxy rather than the browser calling WordPress
// directly: avoids CORS (WP's public REST API has no guaranteed CORS policy
// for this app's origin) and keeps the same "browser never talks to the
// external service directly" posture as erp.js/publish-to-wordpress.js.
//
// Read-only, published posts only — this is public content already live on
// the site, but gated admin-only anyway for consistency with the rest of
// this feature (no reason for a non-admin to reach it from this app).
//
// POST { q } -> { posts: [{ id, title, link }] }
//
// Env (Netlify site vars, server-side only — same as publish-to-wordpress.js):
//   WP_BASE_URL / WP_USER / WP_PASS
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

// Strip WP's HTML-entity-encoded rendered.title (e.g. "Foo &amp; Bar") down
// to plain text for display in the picker.
function decodeTitle(rendered) {
  return String(rendered || '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–')
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const WP_BASE_URL = Deno.env.get('WP_BASE_URL')
  const WP_USER = Deno.env.get('WP_USER')
  const WP_PASS = Deno.env.get('WP_PASS')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!WP_BASE_URL || !WP_USER || !WP_PASS || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin access required' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const q = String(body?.q || '').trim().slice(0, 100)

  const params = new URLSearchParams({
    status: 'publish', per_page: '10', _fields: 'id,title,link', orderby: 'date', order: 'desc',
  })
  if (q) params.set('search', q)

  try {
    const r = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts?${params.toString()}`, {
      headers: { Authorization: `Basic ${btoa(`${WP_USER}:${WP_PASS}`)}` },
    })
    if (!r.ok) return json({ error: `WordPress search failed (${r.status})` }, 502)
    const rows = await r.json()
    const posts = (Array.isArray(rows) ? rows : []).map(p => ({
      id: p.id, title: decodeTitle(p.title?.rendered), link: p.link,
    }))
    return json({ posts })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
}

export const config = { path: '/api/wp-blog-search' }
