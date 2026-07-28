// Public newsletter-signup capture — the WordPress site posts here so signups
// land in the app's `marketing_contacts` Firestore collection instead of (or in
// parallel with) Mailchimp. This is the live-feed half of retiring Mailchimp;
// the one-time Mailchimp export is already imported (see
// migration/import_marketing_contacts.cjs).
//
// PUBLIC endpoint — the visitor filling the form is NOT signed in, so unlike
// /api/erp this cannot verify a Firebase ID token. It authenticates to Firestore
// as the SERVICE ACCOUNT (mint a Google OAuth token from the service-account
// key), which never reaches the browser. Abuse is bounded by a honeypot field
// and strict email validation; there is no other write surface.
//
// POST body (application/json or form-encoded):
//   { email (required), first_name?, last_name?, company?, country?, phone?,
//     source?, page?, hp? }
//   hp = honeypot: any non-empty value is treated as a bot and silently accepted.
//
// Env (Netlify site vars, server-side only):
//   VITE_FIREBASE_PROJECT_ID  — reused from the app (erp.js already uses it)
//   FIREBASE_CLIENT_EMAIL     — service-account client_email
//   FIREBASE_PRIVATE_KEY      — service-account private_key (literal \n allowed)
//   SUBSCRIBE_ALLOWED_ORIGINS — optional CSV of allowed CORS origins
//                               (default: the crystocraft.com origins)
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'

const DEFAULT_ORIGINS = [
  'https://www.crystocraft.com',
  'https://crystocraft.com',
]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const FREEMAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com',
  'qq.com', '163.com', '126.com', 'live.com', 'msn.com', 'protonmail.com', 'gmx.de',
])
const ROLE = new Set([
  'info', 'sales', 'admin', 'contact', 'office', 'support', 'enquiry', 'enquiries',
  'hello', 'marketing', 'export', 'purchasing', 'orders', 'order', 'service', 'mail',
])
// A doc already in one of these states opted OUT (or hard-bounced). A website
// signup must NOT silently resurrect them onto an emailable list — that is the
// legal do-not-email line. We record the request and leave the status alone.
const SUPPRESSED = new Set(['unsubscribed', 'cleaned'])

const corsHeaders = (origin, allowed) => {
  const ok = allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// ── Firestore REST value encoding ────────────────────────────────────────────
// Firestore's REST API types every field. Encode the JS values we use.
const fv = (v) => {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fv) } }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'object' && v.__ts) return { timestampValue: v.__ts }
  return { stringValue: String(v) }
}
const encodeFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fv(v)]))
// Decode just the couple of fields we read back (status, sources).
const dv = (val) => {
  if (!val) return undefined
  if ('stringValue' in val) return val.stringValue
  if ('booleanValue' in val) return val.booleanValue
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(dv)
  if ('integerValue' in val) return Number(val.integerValue)
  return undefined
}

// Rebuild a canonical PKCS#8 PEM from whatever the env var actually holds. Env
// UIs mangle multi-line secrets in every possible way — literal \n, doubled
// \\n, stripped body newlines, surrounding quotes, CRLF — and jose's importPKCS8
// then rejects it with "must be PKCS#8 formatted string". Extract the base64
// body and re-wrap it, so any of those survive. (Verified against all of them.)
function normalizePkcs8(input) {
  let s = String(input || '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '')
  const inner = s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
  const body = inner.replace(/[^A-Za-z0-9+/=]/g, '')
  const wrapped = body.match(/.{1,64}/g)?.join('\n') || body
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`
}

// Google service-account → OAuth2 access token for the Firestore (datastore) API.
async function getAccessToken(clientEmail, privateKeyPem) {
  const key = await importPKCS8(normalizePkcs8(privateKeyPem), 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()).access_token
}

// Same id rule as the Mailchimp import, so a signup lands on the SAME doc as an
// already-imported contact with that email (idempotent, never a duplicate).
const idFor = (email) => email.trim().toLowerCase().replace(/\s+/g, '')

export default async function handler(req) {
  const allowed = (Deno.env.get('SUBSCRIBE_ALLOWED_ORIGINS') || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const origins = allowed.length ? allowed : DEFAULT_ORIGINS
  const origin = req.headers.get('origin') || ''
  const cors = corsHeaders(origin, origins)
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', ...cors },
    })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Accept JSON or form-encoded (WordPress form plugins post either).
  let data = {}
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      data = await req.json()
    } else {
      const form = await req.formData()
      data = Object.fromEntries([...form.entries()])
    }
  } catch {
    return json({ error: 'Invalid body' }, 400)
  }

  // Honeypot: a bot fills every field, including the hidden one. Accept silently
  // (a 200 so the bot sees success) but write nothing.
  if (String(data.hp || '').trim()) return json({ ok: true, skipped: 'hp' })

  const email = String(data.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400)

  const PROJECT = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  const CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''   // normalizePkcs8 handles any formatting
  if (!PROJECT || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return json({ error: 'Server not configured (missing FIREBASE_* env vars)' }, 500)
  }

  const id = idFor(email)
  const domain = email.split('@')[1] || ''
  const local = email.split('@')[0] || ''
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/marketing_contacts/${encodeURIComponent(id)}`

  try {
    const token = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY)
    const authH = { Authorization: `Bearer ${token}` }

    // Read the existing doc (if any) to merge non-destructively and to respect
    // an existing suppression.
    const getR = await fetch(base, { headers: authH })
    const existing = getR.ok ? await getR.json() : null
    const ex = existing?.fields || null
    const prevStatus = ex ? dv(ex.status) : null
    const prevSources = ex ? (dv(ex.sources) || []) : []
    const nowIso = new Date().toISOString()

    const sources = [...new Set([...prevSources, 'wordpress_signup'])]
    const suppressed = prevStatus && SUPPRESSED.has(prevStatus)

    // Fields to write. updateMask means only these are touched — every other
    // field on an existing (e.g. Mailchimp-imported) doc is preserved.
    const fields = {
      email,
      sources,
      wordpress_signup_at: { __ts: nowIso },
      updatedAt: { __ts: nowIso },
    }
    // Fill contact details only when provided (don't blank an existing value).
    const put = (k, v) => { const s = String(v ?? '').trim(); if (s) fields[k] = s }
    put('first_name', data.first_name)
    put('last_name', data.last_name)
    put('company', data.company)
    put('country', data.country)
    put('phone', data.phone)
    put('signup_page', data.page)

    if (!ex) {
      // Brand-new contact — full default record matching the import schema so
      // the Marketing Contacts page renders it identically.
      Object.assign(fields, {
        domain,
        tags: [],
        audiences: ['website'],
        channels: [],
        status: 'subscribed',
        emailable: true,
        is_customer: false,
        relationship: '',
        freemail: FREEMAIL.has(domain),
        role_address: ROLE.has(local),
        member_rating: '',
        optin_time: nowIso,
        possible_customer_match: null,
        source_import: 'wordpress_signup',
        review_status: '',
        app_notes: '',
        createdAt: { __ts: nowIso },
      })
    } else if (suppressed) {
      // Previously unsubscribed / bounced — record the re-opt-in request for a
      // human to review, but do NOT flip them back to emailable automatically.
      fields.resubscribe_requested_at = { __ts: nowIso }
    } else {
      // Existing, not suppressed — a fresh opt-in confirms emailable.
      fields.status = 'subscribed'
      fields.emailable = true
    }

    const masks = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
    const patchR = await fetch(`${base}?${masks}`, {
      method: 'PATCH',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: encodeFields(fields) }),
    })
    if (!patchR.ok) throw new Error(`patch ${patchR.status}: ${(await patchR.text()).slice(0, 200)}`)

    return json({ ok: true, id, created: !ex, suppressed: !!suppressed })
  } catch (e) {
    return json({ error: 'Could not record signup', detail: String(e?.message || e).slice(0, 300) }, 502)
  }
}
