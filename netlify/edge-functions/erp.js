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
  item: { view: 'erp_item', search: ['code', 'name', 'description'] },
  sales_invoice: {
    view: 'erp_sales_invoice', hasActive: false, orderBy: 'code.desc',
    search: ['code', 'customer', 'customer_code', 'ref', 'customer_po'],
  },
  sales_order: {
    view: 'erp_sales_order', hasActive: false, orderBy: 'code.desc',
    search: ['code', 'customer', 'customer_code', 'ref', 'customer_po'],
  },
  purchase: {
    view: 'erp_purchase', hasActive: false, orderBy: 'code.desc',
    search: ['code', 'supplier', 'supplier_code', 'ref'],
  },
  uc_archive: {
    view: 'erp_uc_archive', hasActive: false, orderBy: 'src_row.desc',
    search: ['uc_no', 'customer', 'jes_si', 'order_no'],
  },
}

// Header → line-detail + surcharge views, fetched by exact header code (see the
// 'lines' action). Surcharges are freight / delivery / packing / etc. charges.
const LINES = {
  sales_invoice: { view: 'erp_sales_invoice_line', fk: 'invoice_no', surchargeView: 'erp_sales_invoice_surcharge' },
  sales_order: { view: 'erp_sales_order_line', fk: 'order_no', surchargeView: 'erp_sales_order_surcharge' },
  purchase: { view: 'erp_purchase_line', fk: 'po_no', surchargeView: 'erp_purchase_surcharge' },
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// The ERP archive holds costs, margins, and supplier pricing — trade secrets.
// So the whole endpoint is admin-only. "admin" = the app's Firestore
// users/{uid}.role === 'admin' (same rule the app UI uses). We read the caller's
// own profile doc with their token — Firestore rules allow a user to read it.
async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

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
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch {
    return json({ error: 'Invalid or expired session' }, 401)
  }

  // 1b) Admin-only: the ERP archive exposes costs/margins/supplier pricing.
  if (!(await isAdmin(uid, token, PROJECT_ID))) {
    return json({ error: 'Admin access required' }, 403)
  }

  // 2) Parse the request.
  let payload
  try { payload = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  // 2a) BOM explosion: { entity: 'bom', code } → recursive explode_bom() RPC.
  if (payload?.entity === 'bom') {
    const code = String(payload.code ?? '').trim().slice(0, 40)
    if (!code) return json({ error: 'Missing item code' }, 400)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/explode_bom`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({ p_code: code }),
    })
    if (!res.ok) {
      const detail = await res.text()
      return json({ error: 'BOM query failed', status: res.status, detail: detail.slice(0, 300) }, 502)
    }
    return json({ rows: await res.json() })
  }

  // 2b) Line detail: { entity: 'lines', of: 'sales_invoice'|'sales_order', code }.
  //     Returns the header's line items and (for sales docs) its surcharge lines.
  if (payload?.entity === 'lines') {
    const lcfg = LINES[payload?.of]
    if (!lcfg) return json({ error: `Unknown line type: ${payload?.of}` }, 400)
    const code = String(payload.code ?? '').replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 40)
    if (!code) return json({ error: 'Missing header code' }, 400)

    const fetchByHeader = async (view) => {
      const p = new URLSearchParams()
      p.set('select', '*')
      p.set(lcfg.fk, `eq.${code}`)
      p.set('order', 'seq.asc')
      p.set('limit', '1000')
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${p.toString()}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
      })
      if (!r.ok) throw new Error(`${view}: ${r.status} ${(await r.text()).slice(0, 200)}`)
      return r.json()
    }

    try {
      const [rows, surcharges] = await Promise.all([
        fetchByHeader(lcfg.view),
        lcfg.surchargeView ? fetchByHeader(lcfg.surchargeView) : Promise.resolve([]),
      ])
      return json({ rows, surcharges })
    } catch (e) {
      return json({ error: 'Line query failed', detail: String(e.message).slice(0, 300) }, 502)
    }
  }

  // 2c) Otherwise: whitelisted entity search.
  const cfg = ENTITIES[payload?.entity]
  if (!cfg) return json({ error: `Unknown entity: ${payload?.entity}` }, 400)

  const q = String(payload.q ?? '').trim().slice(0, 80)
  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 25, 1), 100)
  const activeOnly = payload.activeOnly === true

  // 3) Build the PostgREST query. Double-quote ilike values so commas/parens in
  //    the search term can't break the or() filter.
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('order', cfg.orderBy || 'code.asc')
  params.set('limit', String(limit))
  if (activeOnly && cfg.hasActive !== false) params.set('active', 'is.true')
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
