// Transactional email via Resend (https://resend.com).
// Client posts a semantic event; this function owns the templates and decides
// which message(s) to send, so no email markup ever lives in the browser.
//
// Auth (V8.6 security fix — see PROJECT-PLAN.md): this endpoint used to trust
// a client-supplied `payload.email` as the send-to address with NO auth check
// at all — anyone could POST directly and make Crystocraft's Resend account
// mail an arbitrary recipient (open-relay abuse, flagged by an external
// review). Every call now requires a verified Firebase ID token, and the
// recipient/identity fields are derived SERVER-SIDE, never taken from the
// request body:
//   'enquiry'          → any signed-in user; recipient = the token's own
//                         verified email claim (never payload.email)
//   'account_approved' → admin only; payload carries a target `uid`, and
//                         email/company/contact are read from users/{uid}
// 'signup' was removed — the old direct-signup flow it served has no caller
// anywhere in src/ any more (superseded by netlify/functions/portal-invite.js).
//
// POST body: { event, payload }
//
// Env (Netlify site vars, server-side only):
//   RESEND_API_KEY  — required
//   MAIL_FROM       — e.g. "Crystocraft <noreply@crystocraft.com>" (default resend test sender)
//   MAIL_ADMIN      — where admin alerts go (e.g. sales@crystocraft.com)
//   PORTAL_URL      — customer portal base URL (default https://portal.crystocraft.com)
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for ID-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

const BRAND = '#6E2433'   // Bespoke burgundy
const GOLD  = '#C6A664'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ITEMS = 50            // an enquiry cart this large is not realistic — cap it defensively
const MAX_BODY_BYTES = 20_000   // generous for a cart-sized JSON payload, far below abuse territory

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
))

// Minimal, email-safe shell (inline styles; no external fonts).
const shell = (heading, bodyHtml) => `
<div style="margin:0;padding:24px;background:#F7EEE3;font-family:Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E9E8E6;">
    <div style="background:#1C1C1A;padding:18px 24px;">
      <span style="color:#fff;font-size:18px;letter-spacing:3px;font-weight:bold;">CRYSTOCRAFT</span>
      <span style="color:${GOLD};font-size:11px;letter-spacing:2px;display:block;margin-top:2px;">PRODUCT PORTAL</span>
    </div>
    <div style="padding:28px 24px;">
      <h1 style="font-size:19px;color:#222;margin:0 0 16px;font-weight:normal;">${heading}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #E9E8E6;color:#888;font-size:11px;">
      Crystocraft — craftsmanship that catches the light, since 1958.
    </div>
  </div>
</div>`

const p = t => `<p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 14px;">${t}</p>`
const btn = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:11px 22px;font-size:13px;letter-spacing:1px;">${esc(label)}</a>`

function itemsTable(items = []) {
  if (!items.length) return ''
  const rows = items.map(i =>
    `<tr>
       <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;">${esc(i.name || i.code || '—')}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${esc(i.qty ?? '')}</td>
     </tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
    <tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;font-size:11px;color:#888;">ITEM</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;font-size:11px;color:#888;">QTY</th></tr>
    ${rows}
  </table>`
}

async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

// Server-side lookup of a target account's own record — payload.uid is just
// a pointer; the actual email/company/contact that ends up in the message
// always comes from here, never from what the client claims about itself.
async function fetchUserRecord(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return null
  const doc = await r.json()
  const f = doc?.fields || {}
  return {
    email: f.email?.stringValue || '',
    company_name: f.company_name?.stringValue || '',
    contact_name: f.contact_name?.stringValue || '',
  }
}

export default async function handler(req) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!API_KEY) return json({ error: 'RESEND_API_KEY not configured', skipped: true }, 200)

  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  // Every purpose requires a signed-in caller — this endpoint has no public
  // use case any more (see header comment).
  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid, tokenEmail
  try {
    const { payload: claims } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = claims.sub
    tokenEmail = claims.email || ''
  } catch { return json({ error: 'Invalid or expired session' }, 401) }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength && contentLength > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { event, payload = {} } = body || {}

  const FROM       = Deno.env.get('MAIL_FROM')     || 'Crystocraft <onboarding@resend.dev>'
  const ADMIN      = Deno.env.get('MAIL_ADMIN')    || ''
  const REPLY_TO   = Deno.env.get('MAIL_REPLY_TO') || ADMIN   // where customer replies land
  const PORTAL_URL = Deno.env.get('PORTAL_URL')    || 'https://portal.crystocraft.com'

  // Explicit purpose allowlist — only events that actually have a live
  // caller in the codebase today (notify.js). 'signup' was removed (dead
  // code, no caller, one less recipient-controlling surface to reason about).
  const ALLOWED_EVENTS = new Set(['enquiry', 'account_approved'])
  if (!ALLOWED_EVENTS.has(event)) return json({ error: 'Unknown event' }, 400)

  // Least privilege per purpose, and the recipient/identity always comes
  // from a server-side source (the verified token, or a Firestore lookup by
  // uid) — never from payload.email/company_name/contact_name as sent by
  // the client.
  let to, name, company
  if (event === 'account_approved') {
    if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin access required' }, 403)
    const targetUid = String(payload.uid || '').trim()
    if (!targetUid) return json({ error: 'uid is required' }, 400)
    const target = await fetchUserRecord(targetUid, token, PROJECT_ID)
    if (!target || !target.email) return json({ error: 'Target account not found' }, 404)
    to = target.email
    name = target.contact_name || target.company_name || 'there'
    company = target.company_name || target.email
  } else {
    // 'enquiry' — any signed-in user, but always mailed to their OWN
    // verified address, never one supplied in the request body.
    to = tokenEmail
    name = String(payload.contact_name || payload.company_name || 'there').slice(0, 200)
    company = String(payload.company_name || to || 'a customer').slice(0, 200)
  }
  if (!EMAIL_RE.test(to)) return json({ error: 'No valid recipient for this account' }, 400)

  const items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_ITEMS) : []
  const currency = String(payload.currency || '').slice(0, 10)
  const estimatedTotal = payload.estimated_total

  // Build the list of messages to send for this event.
  const msgs = []

  if (event === 'enquiry') {
    msgs.push({
      to,
      subject: 'We’ve received your enquiry — Crystocraft',
      html: shell('Thank you for your enquiry', [
        p(`Dear ${esc(name)},`),
        p('We’ve received your enquiry and our team will review it and get back to you shortly. No payment is taken at this stage.'),
        itemsTable(items),
        estimatedTotal ? p(`<b>Estimated total:</b> ${esc(currency)} ${esc(estimatedTotal)}`) : '',
        p('Thank you for considering Crystocraft.'),
      ].join('')),
    })
    if (ADMIN) msgs.push({
      to: ADMIN,
      subject: `New enquiry — ${company}`,
      html: shell('New enquiry received', [
        p(`<b>Company:</b> ${esc(payload.company_name || '—')}<br><b>Contact:</b> ${esc(payload.contact_name || '—')}<br><b>Email:</b> ${esc(to)}`),
        itemsTable(items),
        estimatedTotal ? p(`<b>Estimated total:</b> ${esc(currency)} ${esc(estimatedTotal)}`) : '',
        btn(`${PORTAL_URL}/portal`, 'Open Portal'),
      ].join('')),
    })
  } else if (event === 'account_approved') {
    msgs.push({
      to,
      subject: 'Your Crystocraft account is approved',
      html: shell('Your account is approved', [
        p(`Dear ${esc(name)},`),
        p('Your Crystocraft portal account has been approved. You can now sign in to view wholesale pricing and submit enquiries.'),
        btn(`${PORTAL_URL}/login`, 'Sign in'),
      ].join('')),
    })
  }

  // Customer-facing mail replies to sales; admin alerts reply to the customer.
  for (const m of msgs) m.replyTo = m.to === ADMIN ? (to || REPLY_TO) : REPLY_TO

  console.log(`[send-email] uid=${uid} event=${event} to=${msgs.map(m => m.to).join(',')}`)

  // Send them all; report per-message result without failing the whole call.
  const results = await Promise.all(msgs.map(async m => {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: m.to, subject: m.subject, html: m.html,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }),
      })
      if (!r.ok) {
        const detail = (await r.text()).slice(0, 200)
        console.error(`[send-email] Resend rejected send to=${m.to} status=${r.status}`)
        return { to: m.to, ok: false, status: r.status, detail }
      }
      return { to: m.to, ok: true }
    } catch (e) {
      console.error(`[send-email] send failed to=${m.to} error=${String(e?.message || e)}`)
      return { to: m.to, ok: false, error: String(e?.message || e) }
    }
  }))

  return json({ ok: results.every(r => r.ok), sent: results.map(r => ({ ok: r.ok })) })
}
