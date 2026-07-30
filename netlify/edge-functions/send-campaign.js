// Marketing campaign sender — batched, admin-triggered (no cron: the owner
// clicks "Send next batch" in the app; see src/pages/Campaigns.jsx). Same
// admin-token posture as /api/bank.
//
// Sends from news@crystocraft.com. Domain-level, not per-address: Resend only
// needs crystocraft.com verified once (already done for the portal's
// noreply@crystocraft.com), so this needed no new DNS or Resend domain slot —
// deliberately NOT a fresh subdomain, since the free Resend plan caps at one
// verified domain and a second would need Pro.
//
// POST { contacts: [{ id, email, first_name? }], subject, bodyText }
//   -> { ok, results: [{ id, ok, error? }] }
//
// Env (Netlify site vars, server-side only):
//   RESEND_API_KEY        — required (shared with send-email.js)
//   MAIL_REPLY_TO         — where a prospect's reply lands (falls back to MAIL_ADMIN)
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
//   APP_URL                — this app's own origin, for the unsubscribe link
//     (default https://portal.crystocraft.com — matches PORTAL_URL elsewhere)
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

// A hard ceiling independent of whatever the client sends — protects the
// Resend free-plan daily cap (100/day) even if a bug ever asks for more than
// one sane batch at a time.
const MAX_BATCH = 100

async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
))

// Plain-text body → paragraphs. Deliberately simple (no rich-text editor yet —
// "one campaign at a time" scope) — a blank line starts a new paragraph, single
// newlines soft-wrap within one.
function bodyHtml(text) {
  return String(text || '').trim().split(/\n\s*\n/).map(para =>
    `<p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 14px;">${esc(para).replace(/\n/g, '<br>')}</p>`
  ).join('')
}

function emailHtml({ subject, text, unsubUrl }) {
  return `
<div style="margin:0;padding:24px;background:#F7EEE3;font-family:Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E9E8E6;">
    <div style="background:#1C1C1A;padding:18px 24px;">
      <span style="color:#fff;font-size:18px;letter-spacing:3px;font-weight:bold;">CRYSTOCRAFT</span>
    </div>
    <div style="padding:28px 24px;">
      <h1 style="font-size:19px;color:#222;margin:0 0 16px;font-weight:normal;">${esc(subject)}</h1>
      ${bodyHtml(text)}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #E9E8E6;color:#888;font-size:11px;">
      Crystocraft — craftsmanship that catches the light, since 1958.<br>
      <a href="${esc(unsubUrl)}" style="color:#888;">Unsubscribe</a>
    </div>
  </div>
</div>`
}

// HMAC-SHA256(id, RESEND_API_KEY) — a lightweight unsubscribe token so the
// link can't be used to unsubscribe an arbitrary guessed email address.
// Deliberately reuses the API key as the secret rather than provisioning a
// new env var: it's already required for this whole feature to work at all.
async function unsubToken(id, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const API_KEY = Deno.env.get('RESEND_API_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!API_KEY || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

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
  const { subject, bodyText } = body || {}
  const contacts = Array.isArray(body?.contacts) ? body.contacts.slice(0, MAX_BATCH) : []
  if (!subject || !bodyText) return json({ error: 'subject and bodyText are required' }, 400)
  if (!contacts.length) return json({ error: 'No contacts in this batch' }, 400)

  const FROM = 'Crystocraft <news@crystocraft.com>'
  const REPLY_TO = Deno.env.get('MAIL_REPLY_TO') || Deno.env.get('MAIL_ADMIN') || ''
  const APP_URL = Deno.env.get('APP_URL') || 'https://portal.crystocraft.com'

  const results = await Promise.all(contacts.map(async (c) => {
    const id = String(c.id || '').trim()
    const email = String(c.email || '').trim()
    if (!id || !email) return { id, ok: false, error: 'Missing id/email' }
    try {
      const t = await unsubToken(id, API_KEY)
      const unsubUrl = `${APP_URL}/api/unsubscribe?id=${encodeURIComponent(id)}&t=${t}`
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: email, subject,
          html: emailHtml({ subject, text: bodyText, unsubUrl }),
          ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
          headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
        }),
      })
      if (!r.ok) return { id, ok: false, error: (await r.text()).slice(0, 200) }
      return { id, ok: true }
    } catch (e) {
      return { id, ok: false, error: String(e?.message || e) }
    }
  }))

  return json({ ok: true, results })
}
