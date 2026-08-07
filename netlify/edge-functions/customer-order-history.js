// Portal order history — lets a signed-in, approved portal customer see
// their OWN JES (legacy ERP) sales invoice history, and the line items of
// one invoice. Separate from /api/erp on purpose: that endpoint is
// deliberately hard admin-only ("the ERP archive holds costs, margins, and
// supplier pricing — trade secrets") — this one exposes only a customer's
// OWN order-level rows (invoice #, date, status, amount, currency) and line
// items (item, qty, unit price, line amount) — the same information they'd
// see on their own invoice — and reads the caller's OWN users/{uid} doc with
// their OWN token (Firestore rules already allow that self-read).
//
// Security note: this endpoint has NO elevated Firestore access — it never
// authenticates as a service account. It TRUSTS erp_code / erp_code_shared
// straight off the caller's own users/{uid} doc. That's only safe because
// firestore.rules locks those two fields (plus `sensitive`) to admin-only
// writes — a customer's own token cannot set them on their own doc. See
// domain/customer.js's mirrorToLinkedAccounts() for where they get written.
// The `lines` action ALSO re-verifies the requested invoice actually belongs
// to the caller's own erp_code server-side before returning anything — a
// customer passing an arbitrary invoice number must not see someone else's
// line items just because they guessed a code.
//
// A handful of JES codes (A29, C13, O07 — confirmed 2026-08-07) are shared
// "bucket" codes used for many different Alibaba/website/walk-in customers,
// not unique per customer — erp_code_shared=true on the caller's profile
// means "don't return history," same guard CustomerDetail.jsx's admin view
// applies, computed the same way (domain/customer.js's saveCustomer).
//
// POST { action?: 'history' | 'lines', code? }  (code required for 'lines')
//   history -> { rows: [] }                      no erp_code on file yet
//           -> { rows: [], shared: true }        erp_code is a shared bucket code
//           -> { rows: [{ code, date, status, amount, currency, ref, ... }] }
//   lines   -> { lines: [{ item_code, description, qty, unit_price, amount }] }
//           -> 403 if `code` doesn't belong to the caller's own erp_code
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY),
//      VITE_FIREBASE_PROJECT_ID (or FIREBASE_PROJECT_ID)
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Same self-read pattern as erp.js's isAdmin(), but returns the fields this
// endpoint actually needs instead of just a boolean.
async function getOwnProfile(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return null
  const doc = await r.json()
  const f = doc?.fields || {}
  return {
    role: f.role?.stringValue || '',
    status: f.status?.stringValue || '',
    erp_code: f.erp_code?.stringValue || '',
    erp_code_shared: f.erp_code_shared?.booleanValue === true,
  }
}

async function sb(SUPABASE_URL, SERVICE_KEY, path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  })
  if (!r.ok) return null
  return r.json()
}

// Safe subset — order-level info a customer already sees on their own
// invoice, nothing cost/margin related (that distinction is what keeps this
// endpoint separate from the admin-only /api/erp — see this file's header).
const HEADER_COLS = 'code,date,status,amount,currency,customer_po,ship_date,ref'
const LINE_COLS = 'item_code,description,qty,unit_price,amount'

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!SUPABASE_URL || !SERVICE_KEY || !PROJECT_ID) {
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

  const profile = await getOwnProfile(uid, token, PROJECT_ID)
  if (!profile || profile.role !== 'customer' || profile.status !== 'approved') {
    return json({ error: 'Approved customer account required' }, 403)
  }

  let body = {}
  try { body = await req.json() } catch { /* no body = default action */ }
  const action = body?.action === 'lines' ? 'lines' : 'history'

  if (action === 'lines') {
    const code = String(body?.code || '').trim()
    if (!code) return json({ error: 'code is required' }, 400)
    if (!profile.erp_code || profile.erp_code_shared) return json({ error: 'Not available' }, 403)
    // Re-verify server-side that this invoice actually belongs to the
    // caller's own erp_code before returning anything — a customer passing
    // an arbitrary SI number must not see someone else's invoice just by
    // guessing one. Fetches the full header in the same call the ownership
    // check needs, so the print page (CustomerInvoicePrint.jsx) gets
    // everything in one round trip.
    const header = await sb(SUPABASE_URL, SERVICE_KEY,
      `erp_sales_invoice?select=${HEADER_COLS},customer_code&code=eq.${encodeURIComponent(code)}&limit=1`)
    if (!header?.length || String(header[0].customer_code || '').toUpperCase() !== profile.erp_code.toUpperCase()) {
      return json({ error: 'Not found' }, 404)
    }
    const lines = await sb(SUPABASE_URL, SERVICE_KEY,
      `erp_sales_invoice_line?select=${LINE_COLS}&invoice_no=eq.${encodeURIComponent(code)}&order=seq.asc`)
    const { customer_code, ...safeHeader } = header[0]
    return json({ header: safeHeader, lines: lines || [] })
  }

  if (!profile.erp_code) return json({ rows: [] })
  if (profile.erp_code_shared) return json({ rows: [], shared: true })

  const rows = await sb(SUPABASE_URL, SERVICE_KEY,
    `erp_sales_invoice?select=${HEADER_COLS}&customer_code=eq.${encodeURIComponent(profile.erp_code)}&order=date.desc&limit=200`)
  return json({ rows: rows || [] })
}
