// Daily Drafts re-engagement engine (V7.23) — sends one reviewed/edited AI
// draft as a real plain-text email, via the same Resend account send-campaign.js
// and send-email.js already use. Admin-gated, same posture as send-campaign.js.
//
// Deliberately does NOT touch Firestore — this function only holds the secret
// (RESEND_API_KEY) the browser can't have. On a successful response the caller
// (DailyDrafts.jsx) marks the draft 'sent' and stamps the customer's
// lastOutreachAt itself via domain/outreachDrafts.js / domain/customer.js,
// same split as Campaigns.jsx (send-campaign.js sends; the page records).
//
// POST { customerEmail, subject, body, draftId?, imageUrls?, blogLink? } -> { ok: true } | { error }
//   imageUrls — up to 2 product-photo URLs (Firebase Storage download URLs,
//     already public — see DailyDrafts.jsx), embedded below the note.
//   blogLink  — { title, url } for one crystocraft.com blog post, linked
//     below the images.
//   draftId   — the outreach_drafts Firestore doc id, sent to Resend as a
//     tag (Resend echoes tags back in webhook payloads — see
//     resend-webhook.js). This is how a later delivered/opened/clicked
//     event gets matched back to the right draft with a plain GET/PATCH by
//     known id, no Firestore query needed. Resend tag values are restricted
//     to [a-zA-Z0-9_-]+, which Firestore's auto-generated ids satisfy.
// Sends BOTH text and html — html renders the images/link inline; text is
// the plain-text fallback (with the blog link appended as a bare URL, since
// images can't degrade into plain text).
//
// Env (Netlify site vars, server-side only):
//   RESEND_API_KEY        — required (shared with send-email.js / send-campaign.js)
//   MAIL_PERSONAL_FROM    — required, e.g. "Eddie Chou <eddie@crystocraft.com>".
//     Must be on a Resend-VERIFIED domain (crystocraft.com already is, via
//     send-campaign.js/send-email.js) — it does NOT need a real mailbox behind
//     it, Resend only needs to be allowed to send as that domain. Distinct
//     from send-campaign.js's news@crystocraft.com so these read as a
//     personal note, not a marketing blast.
//   MAIL_REPLY_TO          — where a customer's reply actually lands (the
//     owner's real inbox, e.g. eddie@uart.com.hk — crystocraft.com has no
//     mailbox to receive at). Shared with send-campaign.js; falls back to
//     MAIL_ADMIN, same as there.
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function isAdmin(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  return doc?.fields?.role?.stringValue === 'admin'
}

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
))

// Plain paragraphs + up to 2 images + one blog link — deliberately NOT a
// styled template (no brand colors/header/footer like send-campaign.js's
// Unlayer output). The whole point of this feature is a personal note, not
// something that reads as a marketing email; images/link are just appended
// plainly below the text.
function buildHtml(text, imageUrls, blogLink) {
  const paragraphs = text.split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 1em;">${escHtml(p).replace(/\n/g, '<br>')}</p>`
  ).join('')
  const images = (imageUrls || []).slice(0, 2).map(url =>
    `<img src="${escHtml(url)}" alt="" style="max-width:420px;width:100%;height:auto;display:block;margin:0 0 12px;">`
  ).join('')
  const link = blogLink?.url
    ? `<p style="margin:12px 0 0;"><a href="${escHtml(blogLink.url)}">${escHtml(blogLink.title || blogLink.url)}</a></p>`
    : ''
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#222;">${paragraphs}${images}${link}</div>`
}

function buildTextFallback(text, blogLink) {
  return blogLink?.url ? `${text}\n\n${blogLink.title || ''}\n${blogLink.url}`.trim() : text
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM = Deno.env.get('MAIL_PERSONAL_FROM')
  const REPLY_TO = Deno.env.get('MAIL_REPLY_TO') || Deno.env.get('MAIL_ADMIN') || ''
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!API_KEY || !FROM || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

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
  const customerEmail = String(body?.customerEmail || '').trim()
  const subject = String(body?.subject || '').trim()
  const text = String(body?.body || '').trim()
  const imageUrls = Array.isArray(body?.imageUrls) ? body.imageUrls.filter(Boolean).slice(0, 2) : []
  const blogLink = body?.blogLink?.url ? { title: String(body.blogLink.title || ''), url: String(body.blogLink.url) } : null
  const draftId = String(body?.draftId || '').trim()
  if (!customerEmail || !subject || !text) return json({ error: 'customerEmail, subject and body are required' }, 400)

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: customerEmail, subject,
        text: buildTextFallback(text, blogLink),
        html: buildHtml(text, imageUrls, blogLink),
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        ...(draftId ? { tags: [{ name: 'draft_id', value: draftId }] } : {}),
      }),
    })
    if (!r.ok) return json({ error: (await r.text()).slice(0, 300) }, 502)
    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
}

export const config = { path: '/api/send-personal-email' }
