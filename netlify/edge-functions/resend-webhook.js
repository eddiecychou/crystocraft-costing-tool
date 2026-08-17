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
// Matching: send-personal-email.js/send-campaign.js tag every send via
// lib/resendTags.js's resendTag(), which base64url-encodes the real
// Firestore doc id (prefixed, e.g. 'draft_aGVsbG8') — Resend only allows
// [A-Za-z0-9_-] in a tag, and a marketing_contacts doc id is literally the
// contact's own email address, so the raw id can't go through unencoded.
// Resend echoes the tag back unmodified in data.tags; decodeResendTag()
// here reverses the encoding to recover the real doc id. Still a plain
// GET/PATCH by known id, not a Firestore query (this codebase's established
// "known doc id" pattern, see subscribe.js/unsubscribe.js) — the encoding is
// just what travels in between.
//
// Env (Netlify site vars, server-side only):
//   RESEND_WEBHOOK_SECRET     — from Resend dashboard → Webhooks → this
//     endpoint's signing secret (whsec_...). Set up by the owner: add a
//     webhook at https://<site>/api/resend-webhook for the delivered/
//     opened/clicked/bounced/complained events.
//   VITE_FIREBASE_PROJECT_ID  — reused from the app
//   FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — service-account,
//     shared with subscribe.js/unsubscribe.js. All four confirmed set in
//     Netlify 2026-08-11 (owner had never actually added the service-account
//     pair; this whole webhook — and likely subscribe/unsubscribe too — had
//     been silently 500ing "Server not configured" since it shipped).
//     IMPORTANT: do NOT mark these "secret" env vars in Netlify — secret-
//     scoped variables aren't exposed to Edge Functions at all (a platform
//     boundary, not a bug here), which is why the first attempt at setting
//     these still 500'd after a fresh deploy.
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'
import { decodeResendTag } from './lib/resendTags.js'

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
  const svixId = req.headers.get('svix-id')
  let ok
  try {
    ok = await verifySvix(
      WEBHOOK_SECRET,
      svixId,
      req.headers.get('svix-timestamp'),
      req.headers.get('svix-signature'),
      rawBody,
    )
  } catch (e) {
    // Was previously unguarded — a malformed WEBHOOK_SECRET (bad base64,
    // wrong char somewhere) threw here as an opaque platform-level
    // "uncaught exception during edge function invocation" with zero
    // detail, on 2026-08-11 while first configuring this webhook's env
    // vars. Surface the real reason instead.
    return new Response(`Signature check failed: ${String(e?.message || e).slice(0, 200)}`, { status: 500 })
  }
  if (!ok) return new Response('Invalid signature', { status: 400 })

  let payload
  try { payload = JSON.parse(rawBody) } catch { return new Response('Bad JSON', { status: 400 }) }

  const field = EVENT_FIELD[payload?.type]
  if (!field) return new Response('ok', { status: 200 }) // event type we don't track — accept, don't error

  // Resend's webhook payload echoes tags back as a plain { name: value }
  // object — NOT the [{ name, value }] array shape used when SPECIFYING tags
  // on send (send-personal-email.js). Confirmed live 2026-08-12: assuming
  // the array shape here threw "((intermediate value) || []).find is not a
  // function" on every single delivery, an uncaught exception (this line
  // sits before the handler's own try/catch) that surfaced to Resend/Netlify
  // as an opaque 500 with zero detail.
  const tags = payload?.data?.tags || {}
  const draftId = decodeResendTag(tags.draft_id, 'draft')
  // mc_id: the marketing_contacts doc id, tagged by send-campaign.js on
  // every recipient and by send-personal-email.js when the Daily Drafts
  // source was a contact (bug-fix pack C-04) — without this, a campaign
  // bounce had NO tag at all to key off (send-campaign.js sent no tags
  // whatsoever) and was silently discarded below the old `if (!draftId)`
  // guard; even a personal-send bounce only ever touched the draft's own
  // engagement flag, never the contact record that actually bounced.
  const mcId = decodeResendTag(tags.mc_id, 'mc')
  // customer_id: same idea, for a Daily Draft personal send whose source was
  // a real customers/ record rather than a marketing_contacts lead (found
  // real 2026-08-18: a bounce on a customer's email — dead address, company
  // gone out of business, etc. — had no handling at all here before; only
  // the draft's own engagement flag was ever touched, never the customer
  // record or its Interaction Log, so nothing surfaced it as something to
  // check on).
  const customerId = decodeResendTag(tags.customer_id, 'customer')
  if (!draftId && !mcId && !customerId) return new Response('ok', { status: 200 }) // untagged send — nothing to correlate

  // Best-effort human-readable bounce/complaint reason for the Interaction
  // Log entry below — Resend's payload shape for this isn't consistently
  // documented across event types, so take whatever's there rather than
  // asserting a specific field exists.
  const eventReason = payload?.data?.bounce?.message
    || payload?.data?.bounce?.type
    || payload?.data?.reason
    || ''

  try {
    const token = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY)
    const nowIso = new Date().toISOString()
    const writes = []

    if (draftId) {
      const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/outreach_drafts/${encodeURIComponent(draftId)}`
      const atField = `${field}At`
      const fields = { engagement: { [field]: true, [atField]: { __ts: nowIso } } }
      const masks = [`engagement.${field}`, `engagement.${atField}`]
        .map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')
      writes.push({ kind: 'flag', promise: fetch(`${base}?${masks}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(fields) }),
      }) })
    }

    // A hard bounce or spam complaint suppresses future sends to this
    // contact — same vocabulary MarketingContacts.jsx's own edit form uses
    // (MC_STATUSES: subscribed/nonsubscribed/unsubscribed/cleaned; emailable
    // is derived from status). Idempotent: setting the same status twice on
    // a duplicate webhook delivery is a no-op, not a double-suppress.
    if (mcId && (field === 'bounced' || field === 'complained')) {
      const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/marketing_contacts/${encodeURIComponent(mcId)}`
      const fields = { status: 'cleaned', emailable: false }
      const masks = ['status', 'emailable'].map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')
      writes.push({ kind: 'flag', promise: fetch(`${base}?${masks}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(fields) }),
      }) })
    }

    // A customer (a real account, not a marketing lead) doesn't get
    // suppressed the way a contact does — Daily Drafts deliberately still
    // targets quiet/inactive customers (see DailyDrafts.jsx's
    // customerToEntity comment: "Inactive ones are worth trying too unless
    // their email is actually dead" — a hard bounce IS that "actually dead"
    // signal). So this flags the record and logs it, rather than silently
    // suppressing: email_bounced/email_bounced_at/email_bounce_reason are
    // read by customerToEntity to stop suggesting this address, and by
    // CustomerDetail.jsx to show a visible banner — the owner still decides
    // what to do (new contact email on file, phone instead, write the
    // account off as out of business, etc.), same as every other CRM signal
    // in this app.
    if (customerId && (field === 'bounced' || field === 'complained')) {
      // bounced and complained are tracked as SEPARATE flags (not one shared
      // "email_bounced" for both, as this originally shipped) — a spam
      // complaint isn't a dead address, it's a "stop emailing this person"
      // signal, and conflating the two under one field/label would misname
      // whichever one didn't happen. Both still stop DailyDrafts.jsx's
      // customerToEntity from suggesting this customer (see its own comment)
      // and both show a banner on CustomerDetail.jsx.
      const isBounce = field === 'bounced'
      const custBase = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/customers/${encodeURIComponent(customerId)}`
      const flagField = isBounce ? 'email_bounced' : 'email_complained'
      const atField2 = isBounce ? 'email_bounced_at' : 'email_complained_at'
      const reasonField = isBounce ? 'email_bounce_reason' : 'email_complain_reason'
      const custFields = { [flagField]: true, [atField2]: { __ts: nowIso }, [reasonField]: eventReason }
      const custMasks = [flagField, atField2, reasonField]
        .map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')
      writes.push({ kind: 'flag', promise: fetch(`${custBase}?${custMasks}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(custFields) }),
      }) })

      // Interaction Log entry (customers/{id}/enquiries — see
      // DailyDrafts.jsx's own logInteraction() for the same shape/posture;
      // this can't import that client-SDK helper from an edge function, so
      // it's a direct REST create here instead). channel/status/etc. match
      // the enquiry schema CustomerDetail.jsx/EnquiryForm.jsx already read.
      //
      // Deterministic doc id (not addDoc-style auto-id) + a
      // currentDocument.exists=false precondition, keyed off this specific
      // webhook delivery's svix-id — Resend/Svix redeliver on timeout/5xx,
      // and this endpoint has no other dedup, so a retried delivery used to
      // insert a second, near-identical "bounced" entry every time (found
      // during the SU-08 interaction-log audit, 2026-08-18). A precondition
      // failure (the entry already exists — this is a replay) is treated as
      // success below, same as the existing 404 allowance.
      const label = isBounce ? 'bounced' : 'was marked as spam'
      const description = `Automated: a Daily Draft email to this customer ${label}` + (eventReason ? ` (${eventReason})` : '') + '. The email address may be inactive or the company may no longer be reachable at it.'
      const dedupeId = `webhook_${String(svixId || 'noid').replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 200)
      writes.push({ kind: 'log', promise: fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/customers/${encodeURIComponent(customerId)}/enquiries/${dedupeId}?currentDocument.exists=false`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: encodeFields({
              date: { __ts: nowIso },
              contact_id: null,
              description,
              product_interest: [],
              channel: 'Email',
              status: 'Open',
              follow_up_date: null,
              outcome_notes: '',
              linked_quote_ids: [],
              createdAt: { __ts: nowIso },
              updatedAt: { __ts: nowIso },
            }),
          }),
        },
      ) })
    }

    const settled = await Promise.all(writes.map(async w => ({ kind: w.kind, r: await w.promise })))
    for (const { kind, r } of settled) {
      if (r.ok) continue
      if (r.status === 404) continue // record since deleted — fine, same posture as unsubscribe.js
      const text = await r.text()
      // A failed currentDocument.exists=false precondition (this exact
      // webhook delivery was already processed) is an expected, successful
      // outcome for the dedup-keyed log write — not a real error.
      if (kind === 'log' && /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(text)) continue
      return new Response(`Firestore write failed: ${text.slice(0, 200)}`, { status: 502 })
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    return new Response(String(e?.message || e).slice(0, 300), { status: 500 })
  }
}

export const config = { path: '/api/resend-webhook' }
