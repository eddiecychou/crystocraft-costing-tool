// Daily Drafts re-engagement engine (V7.23) — receives Resend's delivery
// webhook (delivered/opened/clicked/bounced/complained) and records it on
// the matching outreach_drafts doc. Resend has NO visibility into actual
// replies — those arrive as a normal inbound email at sales@uart.com.hk
// (forwarded to the owner), completely outside Resend — so this only ever
// covers what Resend itself can see. Real reply tracking is a manual
// "Mark as replied" toggle in DailyDrafts.jsx.
//
// PUBLIC endpoint — Resend calls this, not a signed-in app user, so (same
// posture as subscribe.js/unsubscribe.js) it authenticates the CALLER via a
// signature check instead of a Firebase session, and writes to Firestore as
// the service account.
//
// Verification is Svix, not the HMAC-token scheme unsubscribe.js uses (that
// one is for a link a human clicks; this is Resend's own webhook signing).
// Headers `svix-id` / `svix-timestamp` / `svix-signature` sign
// `${svix-id}.${svix-timestamp}.${rawBody}` with HMAC-SHA256, using the
// base64 secret Resend issues per-endpoint (after stripping its `whsec_`
// prefix). svix-signature can carry multiple space-separated `v1,<sig>`
// values (secret rotation) — any match is accepted. A timestamp more than 5
// minutes old/future is rejected (replay protection).
//
// Matching: send-personal-email.js tags every send with
// { name: 'draft_id', value: <outreach_drafts doc id> }, which Resend
// echoes back in data.tags — so this is a plain GET/PATCH by known id, not
// a Firestore query (this codebase's established "known doc id" pattern,
// see subscribe.js/unsubscribe.js).
//
// Env (Netlify site vars, server-side only):
//   RESEND_WEBHOOK_SECRET     — from Resend dashboard → Webhooks → this
//     endpoint's signing secret (whsec_...). Set up by the owner: add a
//     webhook at https://<site>/api/resend-webhook for the delivered/
//     opened/clicked/bounced/complained events.
//   VITE_FIREBASE_PROJECT_ID  — reused from the app
//   FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — service-account,
//     shared with subscribe.js/unsubscribe.js
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'

const EVENT_FIELD = {
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

// ── Firestore REST value encoding — same idiom as subscribe.js/unsubscribe.js,
// extended with mapValue since this is the first of the three to write a
// nested object (engagement: { delivered, deliveredAt }).
const fv = (v) => {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fv) } }
  if (typeof v === 'object' && v.__ts) return { timestampValue: v.__ts }
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } }
  return { stringValue: String(v) }
}
const encodeFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, fv(val)]))

// Same PEM-repair + service-account OAuth token as subscribe.js — env UIs
// mangle multi-line secrets in every possible way, this survives all of them.
function normalizePkcs8(input) {
  let s = String(input || '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '')
  const inner = s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
  const bodyB64 = inner.replace(/[^A-Za-z0-9+/=]/g, '')
  const wrapped = bodyB64.match(/.{1,64}/g)?.join('\n') || bodyB64
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

// ── Svix signature verification ─────────────────────────────────────────────
function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
function bytesToBase64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const TOLERANCE_SECONDS = 300 // reject a timestamp more than 5 min off, replay protection

async function verifySvix(secret, svixId, svixTimestamp, svixSignature, rawBody) {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false
  const ts = parseInt(svixTimestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = bytesToBase64(new Uint8Array(sig))

  // svix-signature: space-separated "v1,<base64sig>" values (secret rotation
  // sends more than one) — accept a match against any of them.
  const candidates = svixSignature.split(' ').map(s => s.split(',')[1]).filter(Boolean)
  return candidates.includes(expected)
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const PROJECT = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  const CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''
  if (!WEBHOOK_SECRET || !PROJECT || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return new Response('Server not configured', { status: 500 })
  }

  const rawBody = await req.text()
  const ok = await verifySvix(
    WEBHOOK_SECRET,
    req.headers.get('svix-id'),
    req.headers.get('svix-timestamp'),
    req.headers.get('svix-signature'),
    rawBody,
  )
  if (!ok) return new Response('Invalid signature', { status: 400 })

  let payload
  try { payload = JSON.parse(rawBody) } catch { return new Response('Bad JSON', { status: 400 }) }

  const field = EVENT_FIELD[payload?.type]
  if (!field) return new Response('ok', { status: 200 }) // event type we don't track — accept, don't error

  const draftId = (payload?.data?.tags || []).find(t => t?.name === 'draft_id')?.value
  if (!draftId) return new Response('ok', { status: 200 }) // not a Daily Drafts send (or untagged) — nothing to update

  try {
    const token = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY)
    const nowIso = new Date().toISOString()
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/outreach_drafts/${encodeURIComponent(draftId)}`
    const atField = `${field}At`
    const fields = { engagement: { [field]: true, [atField]: { __ts: nowIso } } }
    const masks = [`engagement.${field}`, `engagement.${atField}`]
      .map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')
    const r = await fetch(`${base}?${masks}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: encodeFields(fields) }),
    })
    // A 404 (draft since deleted, e.g. a test send that got cleared) is fine,
    // not an error — same posture as unsubscribe.js.
    if (!r.ok && r.status !== 404) {
      return new Response(`Firestore write failed: ${(await r.text()).slice(0, 200)}`, { status: 502 })
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    return new Response(String(e?.message || e).slice(0, 300), { status: 500 })
  }
}

export const config = { path: '/api/resend-webhook' }
