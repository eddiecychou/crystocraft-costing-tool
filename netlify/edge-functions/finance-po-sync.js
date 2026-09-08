// Read-only Purchase Order summary for the separate Finance / Bookkeeping
// app (crystocraft-expenses) to pull instead of a manual CSV export/import.
// Auth is a signed-in costing-tool user's own Firebase ID token, same
// verification as uc.js/erp.js — the caller is a dedicated service account
// (role:'staff', modules including 'supply') that Finance's own server signs
// in as before calling this, so this reuses the exact trust model every
// other endpoint in this family already uses rather than inventing a new
// one (e.g. a shared secret, which can authenticate a caller but still
// couldn't read Firestore without its own separate credential).
//
// purchase_orders has no existing server-side reader (the app only ever
// reads it from the browser via the Firestore SDK + security rules) and no
// updated_at field guaranteed on every doc, so this uses the Firestore
// REST API's own per-document updateTime for the `since` watermark instead
// of trusting a field.
//
// Request:  POST { since?: ISO datetime string }
// Response: { rows: [{ id, pu_number, issued_date, status, supplier_name,
//                       supplier_erp_code, currency, grandTotal, deposit,
//                       balance, updatedAt }] }
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

// Same admin-or-scoped-staff check as uc.js/erp.js.
async function isFrontOffice(uid, idToken, projectId, moduleKey) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  const role = doc?.fields?.role?.stringValue
  if (role === 'admin') return true
  if (role !== 'staff') return false
  const mods = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue)
  return mods.includes(moduleKey)
}

// Ported from src/purchaseOrders.js's poTotals() — small and pure, with no
// dependency on the rest of that module. Kept in sync by hand since PO
// totals math changes rarely; update both if it ever does.
function lineAmount(ln) {
  const q = Number(ln?.qty), p = Number(ln?.unit_price)
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0
}
function adjustmentValue(a) {
  const v = Math.abs(Number(a?.amount))
  if (!Number.isFinite(v) || v === 0) return 0
  return a?.kind === 'discount' ? -v : v
}
function poTotals(po) {
  const lines = po?.lines || []
  const subtotal = lines.reduce((s, ln) => s + lineAmount(ln), 0)
  const adjustments = po?.adjustments || []
  const discountTotal = adjustments.reduce((s, a) => s + Math.max(0, -adjustmentValue(a)), 0)
  const chargeTotal = adjustments.reduce((s, a) => s + Math.max(0, adjustmentValue(a)), 0)
  const grandTotal = subtotal + (chargeTotal - discountTotal)
  const depPct = Number(po?.deposit_pct)
  const deposit = Number.isFinite(depPct) && depPct > 0 ? grandTotal * (depPct / 100) : 0
  return { grandTotal, deposit, balance: grandTotal - deposit }
}

// Minimal Firestore REST field decoder — only the value types purchase_orders
// docs actually use.
function fsValue(v) {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return v.timestampValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue)
  if ('mapValue' in v) return fsDoc(v.mapValue.fields || {})
  return null
}
function fsDoc(fields) {
  const out = {}
  for (const k of Object.keys(fields || {})) out[k] = fsValue(fields[k])
  return out
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isFrontOffice(uid, token, PROJECT_ID, 'supply'))) return json({ error: 'Access denied' }, 403)

  let body = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const sinceMs = body.since ? Date.parse(body.since) : null

  // The collection is small enough (Crystocraft's own PO volume) to fetch
  // whole and filter by updateTime here, rather than a structured :runQuery
  // — simpler, and avoids needing a Firestore index for this one-off filter.
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/purchase_orders?pageSize=1000`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) return json({ error: 'Could not read purchase_orders', detail: (await r.text()).slice(0, 300) }, 502)
  const data = await r.json()

  const rows = (data.documents || [])
    .map(d => ({ id: d.name.split('/').pop(), fields: fsDoc(d.fields), updatedAt: d.updateTime }))
    .filter(d => !sinceMs || Date.parse(d.updatedAt) > sinceMs)
    .map(d => ({
      id: d.id,
      pu_number: d.fields.pu_number || '',
      issued_date: d.fields.issued_date || '',
      status: d.fields.status || 'draft',
      supplier_name: d.fields.supplier_name || '',
      supplier_erp_code: d.fields.supplier_erp_code || '',
      currency: d.fields.currency || '',
      ...poTotals(d.fields),
      updatedAt: d.updatedAt,
    }))

  return json({ rows })
}

export const config = { path: '/api/finance-po-sync' }
