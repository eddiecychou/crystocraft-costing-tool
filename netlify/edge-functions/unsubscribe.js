// Public one-click unsubscribe — the link every campaign send.js message
// carries. The recipient is NOT signed in, so (same posture as subscribe.js)
// this authenticates to Firestore as the service account rather than
// verifying a Firebase session.
//
// GET /api/unsubscribe?id=<contact id>&t=<HMAC token>&col=contacts|customers
//   -> a small confirmation HTML page (this is a link a human clicks from
//      their mail client, not a JSON API caller)
//
// `col` (2026-08-22, Retail Customer Campaigns): send-campaign.js now also
// sends to `customers/{id}` docs (customer_type: 'retail'), which have no
// status/emailable field at all — the two collections need different field
// writes on unsubscribe. Defaults to 'contacts' for every unsubscribe link
// already sent before this existed (they have no col param at all).
//
// The token is HMAC-SHA256(id, RESEND_API_KEY) — see send-campaign.js, which
// mints it. Reusing RESEND_API_KEY as the HMAC secret means no new env var
// had to be provisioned for this to be safe against a guessed contact id.
//
// Env (Netlify site vars, server-side only):
//   RESEND_API_KEY           — required (shared with send-email.js / send-campaign.js)
//   VITE_FIREBASE_PROJECT_ID — reused from the app
//   FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — service-account (shared with subscribe.js)
//   MAIL_FROM / MAIL_ADMIN   — optional; if set, fires a best-effort admin
//     alert to the same destination as subscribe.js's/send-email.js's alerts.
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'

const notifyEsc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
))

async function notifyAdmin(apiKey, subject, bodyHtml) {
  const ADMIN = Deno.env.get('MAIL_ADMIN')
  if (!apiKey || !ADMIN) return
  const FROM = Deno.env.get('MAIL_FROM') || 'Crystocraft <onboarding@resend.dev>'
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: ADMIN, subject, html: bodyHtml }),
    })
  } catch { /* best-effort — never fails the unsubscribe itself */ }
}

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

async function getAccessToken(clientEmail, privateKeyPem) {
  const key = await importPKCS8(normalizePkcs8(privateKeyPem), 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail).setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(key)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()).access_token
}

async function unsubToken(id, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

const fv = (v) => {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'object' && v.__ts) return { timestampValue: v.__ts }
  return { stringValue: String(v) }
}
const encodeFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fv(v)]))

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Crystocraft</title></head>
<body style="margin:0;padding:40px 20px;background:#F7EEE3;font-family:Helvetica,Arial,sans-serif;color:#222;">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E9E8E6;padding:32px 28px;text-align:center;">
<div style="letter-spacing:3px;font-weight:bold;font-size:15px;color:#1C1C1A;margin-bottom:18px;">CRYSTOCRAFT</div>
<h1 style="font-size:18px;font-weight:normal;margin:0 0 12px;">${title}</h1>
<p style="font-size:14px;color:#555;line-height:1.6;">${body}</p>
</div></body></html>`

export default async function handler(req) {
  const html = (title, body, status = 200) =>
    new Response(page(title, body), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

  const url = new URL(req.url)
  const id = (url.searchParams.get('id') || '').trim()
  const t = (url.searchParams.get('t') || '').trim()
  const col = url.searchParams.get('col') === 'customers' ? 'customers' : 'contacts'
  if (!id || !t) return html('Invalid link', 'This unsubscribe link is missing information.', 400)

  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  const PROJECT = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  const CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''
  if (!RESEND_KEY || !PROJECT || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return html('Server not configured', 'Please try again later.', 500)
  }

  const expected = await unsubToken(id, RESEND_KEY)
  if (t !== expected) return html('Invalid link', 'This unsubscribe link is not valid.', 400)

  try {
    const token = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY)
    const nowIso = new Date().toISOString()
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}/${encodeURIComponent(id)}`
    // customers/{id} has no status/emailable concept (that's marketing_contacts-
    // only) — `unsubscribed` is its own dedicated flag (customer.js), checked
    // by eligibleRetailCustomers before any future campaign batch.
    const fields = col === 'customers'
      ? { unsubscribed: true, unsubscribed_at: { __ts: nowIso }, updatedAt: { __ts: nowIso } }
      : { status: 'unsubscribed', emailable: false, unsubscribed_at: { __ts: nowIso }, updatedAt: { __ts: nowIso } }
    const masks = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
    const patchR = await fetch(`${base}?${masks}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: encodeFields(fields) }),
    })
    if (!patchR.ok && patchR.status !== 404) {
      throw new Error(`patch ${patchR.status}: ${(await patchR.text()).slice(0, 200)}`)
    }
    // Awaited (not fire-and-forget) for the same reason as subscribe.js: an
    // edge function's isolate can be torn down right after the response is
    // sent. For a contacts unsubscribe, `id` doubles as the email — it IS
    // the lowercased email under that collection's id scheme (see
    // idFromEmail in marketingContact.js). A customers id has no such
    // guarantee (it may be a WooCommerce-derived key or a plain Firestore
    // auto-id), so this line is only a reliable email address for `col=contacts`.
    await notifyAdmin(RESEND_KEY, `Marketing unsubscribe — ${col} ${id}`,
      `<p><b>Marketing unsubscribe</b></p><p>Email: ${notifyEsc(id)}</p>`)
    return html('You’re unsubscribed', 'You will no longer receive marketing emails from Crystocraft. If this was a mistake, contact us at sales@uart.com.hk.')
  } catch {
    return html('Something went wrong', 'Please try again later, or contact sales@uart.com.hk to be removed manually.', 502)
  }
}
