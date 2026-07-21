// UC# invoice registry API (read + write) backed by Supabase public.uc_registry.
// Admin-only, same as /api/erp: verifies the caller's Firebase token and that
// their app profile is role:'admin', then talks to Supabase with the secret key
// server-side. The browser never sees the key.
//
//   POST { op: 'list',   q?, source?, status?, limit? }         -> { rows }
//   POST { op: 'create', data }                                 -> { row }   (allocates UC# atomically)
//   POST { op: 'update', id, data }                             -> { row }
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

// Columns the client may set. uc_no is server-allocated (DB default), never client-set.
const WRITABLE = new Set([
  'doc_date', 'year', 'source', 'jes_si', 'order_no', 'customer', 'currency', 'total', 'deposit',
  // shipping_cost and delivery_date are deliberately absent: retired from the
  // registry on 2026-07-21 (Cindy). The columns still hold their history, but
  // nothing may write them again.
  'balance', 'bal_pay_date', 'shipment', 'customs',
  'confirmed', 'pic', 'remarks', 'status',
])
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

function clean(data) {
  const out = {}
  for (const k of Object.keys(data || {})) if (WRITABLE.has(k)) out[k] = data[k]
  // Balance defaults to total − deposit when not given.
  if (out.balance === '' || out.balance == null) out.balance = Math.round((num(out.total) - num(out.deposit)) * 100) / 100
  for (const k of ['total', 'deposit', 'balance']) if (k in out) out[k] = num(out[k])
  out.confirmed = !!out.confirmed
  // open = outstanding/tracked, closed = paid/done, void = cancelled mistake.
  if (!['open', 'closed', 'void'].includes(out.status)) out.status = 'open'
  return out
}

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
  const KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!SUPABASE_URL || !KEY || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  // Auth: signed-in admin only.
  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid, email
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub; email = payload.email || null
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin access required' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json', ...(init?.headers || {}) },
  })

  // ── list / search ──────────────────────────────────────────────────────────
  if (body.op === 'list') {
    const p = new URLSearchParams()
    p.set('select', '*')
    // Sorting is applied by the DATABASE, not the browser. The list is capped
    // (1000 of 3,695 rows), so sorting the fetched page would reorder a slice
    // and look like the whole registry — "sort by customer" would show the
    // A-names of whichever 1000 rows came back, not the A-names of the
    // registry. Same reason the date range is a server filter.
    //
    // Whitelisted, because this value goes straight into a PostgREST order
    // clause. uc_no sorts as text on purpose: every number is UC + 4 digits
    // (UC1353..UC4952), so lexical and numeric order agree, and the suffixed
    // and compound forms still sort next to their base number.
    const SORTABLE = new Set([
      'uc_no', 'effective_date', 'customer', 'jes_si', 'source',
      'total', 'balance', 'status', 'currency', 'id',
    ])
    const sortCol = SORTABLE.has(body.sort) ? body.sort : 'id'
    const sortDir = body.dir === 'asc' ? 'asc' : 'desc'
    // Blanks last whichever way it is sorted — an empty customer or an undated
    // row at the top of the list is never what someone is looking for.
    p.set('order', `${sortCol}.${sortDir}.nullslast`)
    p.set('limit', String(Math.min(Math.max(parseInt(body.limit, 10) || 200, 1), 1000)))
    if (['open', 'closed', 'void'].includes(body.status)) p.set('status', `eq.${body.status}`)
    if (body.source) p.set('source', `eq.${String(body.source).replace(/[^\w /-]/g, '')}`)
    if (body.confirmed === true || body.confirmed === false) p.set('confirmed', `is.${body.confirmed}`)
    // Inclusive date range over effective_date (the invoice's own date when it
    // has one, else the typed doc_date). Strictly validated: these values are
    // interpolated into a PostgREST filter.
    for (const [key, op] of [['from', 'gte'], ['to', 'lte']]) {
      const v = String(body[key] ?? '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) p.append('effective_date', `${op}.${v}`)
    }
    const q = String(body.q ?? '').trim().slice(0, 80).replace(/["\\]/g, ' ')
    if (q) p.set('or', `(uc_no.ilike."*${q}*",customer.ilike."*${q}*",jes_si.ilike."*${q}*",order_no.ilike."*${q}*")`)
    // Reads go through uc_registry_dated, which adds si_date (the invoice's own
    // date, joined from the mirror) and effective_date. Writes below still go to
    // the uc_registry TABLE — the view is read-only by design, since the date is
    // derived and must not be editable where it comes from an invoice.
    const r = await rest(`uc_registry_dated?${p.toString()}`)
    if (!r.ok) return json({ error: 'List failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ rows: await r.json() })
  }

  // ── allocate an invoice + its UC, in ONE Postgres transaction ──────────────
  // The whole point of this op. Previously the UC went to Postgres and the
  // order to Firestore with nothing making them agree, so abandoning the form
  // after allocating burned a UC with no invoice behind it.
  //
  // The invoice NUMBER is derived inside the function from the greater of what
  // the app has issued and what the mirror shows JES issued — no seed to go
  // stale, which is the bug that had to be hand-fixed on 2026-07-21.
  if (body.op === 'allocate_invoice') {
    const yy = String(body.year ?? '').trim()
    if (!/^\d{2}$/.test(yy)) return json({ error: 'Bad year' }, 400)
    const r = await rest('rpc/allocate_sales_invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_year: yy,
        p_customer: String(body.customer ?? '').slice(0, 200),
        p_currency: String(body.currency ?? 'HKD').slice(0, 8),
        p_order_id: body.order_id ? String(body.order_id).slice(0, 64) : null,
        p_uc_id: Number.isFinite(Number(body.uc_id)) && body.uc_id ? Number(body.uc_id) : null,
        p_uc_no: body.uc_no ? String(body.uc_no).slice(0, 64) : null,
        p_created_by: email,
      }),
    })
    if (!r.ok) return json({ error: 'Allocation failed', detail: (await r.text()).slice(0, 300) }, 502)
    const row = (await r.json())[0] || {}
    return json({
      si_no: row.o_si_no, uc_no: row.o_uc_no,
      uc_id: row.o_uc_id, invoice_id: row.o_invoice_id,
    })
  }

  // ── create (allocates UC# via the uc_no column default) ─────────────────────
  if (body.op === 'create') {
    const payload = { ...clean(body.data), created_by: email }
    const r = await rest('uc_registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return json({ error: 'Create failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ row: (await r.json())[0] })
  }

  // ── update by id ────────────────────────────────────────────────────────────
  if (body.op === 'update') {
    const id = parseInt(body.id, 10)
    if (!id) return json({ error: 'Missing id' }, 400)
    const payload = { ...clean(body.data), updated_at: new Date().toISOString(), updated_by: email }
    const r = await rest(`uc_registry?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return json({ error: 'Update failed', detail: (await r.text()).slice(0, 300) }, 502)
    return json({ row: (await r.json())[0] })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}
