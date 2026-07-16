// ERP lookup proxy. The browser calls this with the signed-in user's Firebase
// ID token; this function verifies the token, then queries the curated views in
// Supabase using the service-role key (which never leaves the server). The
// browser never touches Supabase directly, so the ERP data — and the service
// key — stay server-side.
//
// Env (set in Netlify → Site config → Environment variables):
//   SUPABASE_URL           e.g. https://vpcwakkotlpfixqpzqmr.supabase.co
//   SUPABASE_SECRET_KEY    Supabase → Project Settings → API Keys → Secret key
//                          (sb_secret_… — the server-side key; NOT the publishable
//                          one). Legacy service_role JWT also works.
//   FIREBASE_PROJECT_ID    your Firebase projectId (token audience)
//
// Request:  POST { entity: "customer"|"supplier", q?: string, limit?: number, activeOnly?: bool }
// Response: { rows: [...] }
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

// Google's public keys for Firebase ID tokens (JWKS form). Cached by jose.
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

// Whitelist: only these entities are queryable, and only these columns are
// searched. Anything else is rejected — no arbitrary table/column access.
const ENTITIES = {
  customer: { view: 'erp_customer', search: ['code', 'name', 'short_name', 'ref_code'] },
  supplier: { view: 'erp_supplier', search: ['code', 'name', 'short_name', 'ref_code'] },
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  // Accept the new "Secret key" (sb_secret_…) or the legacy service_role JWT.
  const SERVICE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  // Reuse the Firebase projectId you already have (VITE_FIREBASE_PROJECT_ID is
  // visible to the edge function too — the VITE_ prefix only affects the browser
  // bundle). FIREBASE_PROJECT_ID is an optional override.
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!SUPABASE_URL || !SERVICE_KEY || !PROJECT_ID) {
    return json({ error: 'Server not configured (missing SUPABASE_URL / SUPABASE_SECRET_KEY / FIREBASE_PROJECT_ID)' }, 500)
  }

  // 1) Require and verify a Firebase ID token — must be a signed-in user of THIS app.
  const authz = req.headers.get('authorization') || ''
  const token = authz.match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  try {
    await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
  } catch {
    return json({ error: 'Invalid or expired session' }, 401)
  }

  // 2) Validate the request against the whitelist.
  let payload
  try { payload = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const cfg = ENTITIES[payload?.entity]
  if (!cfg) return json({ error: `Unknown entity: ${payload?.entity}` }, 400)

  const q = String(payload.q ?? '').trim().slice(0, 80)
  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 25, 1), 100)
  const activeOnly = payload.activeOnly === true

  // 3) Build the PostgREST query. Double-quote ilike values so commas/parens in
  //    the search term can't break the or() filter.
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('order', 'code.asc')
  params.set('limit', String(limit))
  if (activeOnly) params.set('active', 'is.true')
  if (q) {
    const safe = q.replace(/["\\]/g, ' ')
    const or = cfg.search.map((col) => `${col}.ilike."*${safe}*"`).join(',')
    params.set('or', `(${or})`)
  }

  const url = `${SUPABASE_URL}/rest/v1/${cfg.view}?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const detail = await res.text()
    return json({ error: 'Query failed', status: res.status, detail: detail.slice(0, 300) }, 502)
  }
  const rows = await res.json()
  return json({ rows })
}
