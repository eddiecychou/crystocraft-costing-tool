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
// Request:  POST { entity: "customer"|"supplier"|"item"|"warehouse"|"stock"|…,
//                  q?: string, limit?: number, activeOnly?: bool,
//                  filters?: { warehouse?, item_type? }, nonZeroOnly?: bool }
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
    // Default cap (500) was silently truncating PurchaseOrders.jsx's new
    // "JES limit" selector's 1000 option — owner, 2026-08-07: "we need to
    // parse all PU from JES, have a box limit for 50/100/500/1000".
    maxLimit: 1000,
  },
  warehouse: {
    view: 'erp_warehouse', orderBy: 'code.asc',
    search: ['code', 'name', 'name_zh', 'type'],
  },
  item_type: {
    view: 'erp_item_type', hasActive: false, orderBy: 'code.asc',
    search: ['code', 'name'],
  },
  // Stock on hand, computed from the movement ledger. Filterable by warehouse
  // and item type; one warehouse can hold thousands of lines, hence the cap.
  stock: {
    view: 'erp_stock', hasActive: false, orderBy: 'qty.desc',
    search: ['item_code', 'description'],
    filterCols: ['warehouse', 'item_type'], maxLimit: 500,
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

// The ERP archive holds costs, margins, supplier pricing AND the customer /
// invoice / sales-order history — most of it trade-secret. V8.14: access is
// all-or-nothing. The caller's role + modules[] are read from their Firestore
// users/{uid} doc (with their own token — rules allow a user to read it):
//   admin, or staff holding the `erp` module → every entity.
//   anyone else                              → refused.
async function getRole(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return { role: null, modules: [] }
  const doc = await r.json()
  const role = doc?.fields?.role?.stringValue || null
  const modules = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue).filter(Boolean)
  return { role, modules }
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

  // 1b) V8.14 — one `erp` module = the FULL ERP surface. Admin, or a `staff`
  //     account holding `erp`. No per-entity split (the old production/sales
  //     entity tiers are gone with the flat-role migration).
  const { role, modules } = await getRole(uid, token, PROJECT_ID)
  if (role !== 'admin' && !(role === 'staff' && modules.includes('erp'))) {
    return json({ error: 'Access denied' }, 403)
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

  // 2a1) "What do the BOMs use instead?" — { entity: 'alternatives', code }.
  //      Ranked suggestions from erp_code_alternatives(), which searches only
  //      components CURRENT BOMs use. A plain text search was useless here:
  //      FM-124PT02.01-C reduced to the stem "FM" and returned every FM part.
  if (payload?.entity === 'alternatives') {
    const code = String(payload.code ?? '').trim().slice(0, 60)
    if (!code) return json({ error: 'Missing code' }, 400)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/erp_code_alternatives`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({ p_code: code }),
    })
    if (!res.ok) {
      return json({ error: 'Alternatives query failed', detail: (await res.text()).slice(0, 300) }, 502)
    }
    return json({ rows: await res.json() })
  }

  // 2a2) Bulk existence check: { entity: 'codes', codes: [...] } → { found: [...] }.
  //      Used by the component-code audit, which would otherwise need one
  //      request per component. Returns only the codes that exist in erp_item.
  if (payload?.entity === 'codes') {
    const codes = (Array.isArray(payload.codes) ? payload.codes : [])
      .map((c) => String(c ?? '').trim())
      .filter(Boolean)
      .slice(0, 500)
    if (!codes.length) return json({ found: [] })
    // PostgREST in.() — quote each value so commas/parens in a code can't
    // break out of the filter list.
    const list = codes.map((c) => `"${c.replace(/["\\]/g, '')}"`).join(',')
    const p = new URLSearchParams()
    p.set('select', 'code')
    p.set('code', `in.(${list})`)
    p.set('limit', String(codes.length))
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/erp_item?${p.toString()}`, { headers: h })
    if (!r.ok) {
      return json({ error: 'Code check failed', detail: (await r.text()).slice(0, 300) }, 502)
    }
    // Existence alone is a weak test — a code can exist and be superseded. Also
    // return how many CURRENT BOMs use it; zero means nothing is built from it.
    const u = new URLSearchParams()
    u.set('select', 'code,bom_count'); u.set('code', `in.(${list})`); u.set('limit', String(codes.length))
    const ur = await fetch(`${SUPABASE_URL}/rest/v1/erp_component_usage?${u.toString()}`, { headers: h })
    const usage = ur.ok ? await ur.json() : []
    return json({
      found: (await r.json()).map((x) => x.code),
      usage: Object.fromEntries(usage.map((x) => [x.code, x.bom_count])),
    })
  }

  // 2a3) Sync freshness: { entity: 'sync_status' } → when the mirror last ran
  //      and how current the ERP data in it is. Two different times; see the
  //      erp_sync_status view for why conflating them would mislead.
  if (payload?.entity === 'sync_status') {
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/erp_sync_status?select=*&limit=1`, { headers: h })
    if (!r.ok) return json({ error: 'Sync status failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ status: (await r.json())[0] || null })
  }

  // 2a4) Item images: { entity: 'item_images', paths: ['fm-2hrt.jpg', …] }
  //      → { urls: { 'fm-2hrt.jpg': 'https://…signed…' } }
  //
  //      The erp-item-images bucket is PRIVATE, so the browser cannot fetch an
  //      object directly and there is no public URL to build. This mints
  //      short-lived signed URLs server-side, in one batch call for the whole
  //      visible page.
  //
  //      Signed URLs rather than proxying the bytes through this function: the
  //      browser then loads images straight from Supabase's CDN, so 22,557
  //      thumbnails never touch Netlify's bandwidth.
  if (payload?.entity === 'item_images') {
    const paths = (Array.isArray(payload.paths) ? payload.paths : [])
      .map((p) => String(p ?? '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 100)
    if (!paths.length) return json({ urls: {} })
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/erp-item-images`, {
      method: 'POST',
      // Both auth headers: new-style sb_secret_ keys are only accepted via
      // apikey, legacy service_role JWTs accept either. Same reason as the
      // uploader in erp-sync/sync_images.py.
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      // One hour: long enough to browse, short enough that a copied URL is not
      // a lasting hole in a private bucket.
      body: JSON.stringify({ expiresIn: 3600, paths }),
    })
    if (!r.ok) return json({ error: 'Image signing failed', detail: (await r.text()).slice(0, 300) }, 502)
    const signed = await r.json()
    const urls = {}
    for (const row of Array.isArray(signed) ? signed : []) {
      // A missing object comes back with an error and no signedURL — skipped,
      // so the caller simply gets no image rather than a broken one.
      if (row?.signedURL && !row.error) urls[row.path] = `${SUPABASE_URL}/storage/v1${row.signedURL}`
    }
    return json({ urls })
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
  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 25, 1), cfg.maxLimit || 500)
  const activeOnly = payload.activeOnly === true

  // 3) Build the PostgREST query. Double-quote ilike values so commas/parens in
  //    the search term can't break the or() filter.
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('order', cfg.orderBy || 'code.asc')
  params.set('limit', String(limit))
  if (activeOnly && cfg.hasActive !== false) params.set('active', 'is.true')
  // Optional equality filters (stock → warehouse, item_type). The filterable
  // COLUMNS are fixed by the entity config and never chosen by the caller —
  // only their values come from the request, stripped to a safe charset.
  for (const col of cfg.filterCols || []) {
    const raw = payload.filters?.[col]
    if (!raw) continue
    const val = String(raw).replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 40)
    if (val) params.set(col, `eq.${val}`)
  }
  // Stock only: hide item/warehouse pairs that have netted to zero.
  if (cfg.view === 'erp_stock' && payload.nonZeroOnly === true) params.set('qty', 'neq.0')
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
