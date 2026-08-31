// V8.2 — transcribes one WhatsApp voice note (.opus) into text via Deepgram.
// Closes the gap flagged when the import was built: a voice-heavy chat's
// .txt transcript has only a placeholder line per voice note, no content —
// see domain/whatsappImport.js's needs_transcription comment (44 of 73
// media files in the first real export checked were voice notes).
//
// Same split as every other AI edge function here (refresh-email-summary.js,
// suggest-tag-merges.js): the browser already has Firestore/Storage access
// and sends the attachment's own download URL (Firebase Storage URLs are
// directly fetchable — the token in the URL IS the access grant, same as an
// <img src>); this function only holds DEEPGRAM_API_KEY and calls Deepgram
// with that URL directly, never touches Storage or Firestore itself. The
// caller (whatsappImport.js's transcribeMessage) writes the result back onto
// the message.
//
// POST { audioUrl, language? } -> { transcript }
//   language — Deepgram language code, defaults to zh-HK (Cantonese). Must
//     be explicit, not detect_language: confirmed against Deepgram's own
//     docs (2026-08-13) that Cantonese is NOT in detect_language's supported
//     list at all, even on nova-3 (only generic Mandarin "zh" is) — so
//     auto-detect can never correctly identify it, and there's no single
//     language setting that serves both a Cantonese-heavy customer and a
//     genuinely English-speaking one like this app's real contacts include.
//     The caller picks per thread (see CustomerDetail.jsx's WhatsApp card);
//     this only defaults to zh-HK since that's the owner's stated common
//     case, and validates against an allowlist rather than passing through
//     an arbitrary client-supplied string to Deepgram unchecked.
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
  // V8.13: front-office — admin OR sales (see lib/auth.js requireFrontOffice)
  return ['admin', 'sales'].includes(doc?.fields?.role?.stringValue)
}

// Deepgram language codes this app actually offers a picker for — the two
// real cases seen so far (Cantonese-heavy customers, and genuinely
// English-speaking ones like Joe Feder). Add more here if a customer turns
// out to need one (e.g. zh for Mandarin) rather than opening this up to any
// string the client sends.
const ALLOWED_LANGUAGES = new Set(['zh-HK', 'en', 'zh'])

async function callDeepgram(apiKey, audioUrl, language) {
  const url = `https://api.deepgram.com/v1/listen?model=nova-3&language=${encodeURIComponent(language)}&smart_format=true&punctuate=true`
  let reason = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${apiKey}` },
        body: JSON.stringify({ url: audioUrl }),
      })
      if (!res.ok) { reason = `Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`; continue }
      const data = await res.json()
      const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
      if (transcript == null) { reason = 'Deepgram response had no transcript field'; continue }
      return { transcript, reason: null }
    } catch (e) {
      reason = `Request failed: ${String(e?.message || e).slice(0, 200)}`
    }
  }
  return { transcript: null, reason }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const DEEPGRAM_API_KEY = Deno.env.get('DEEPGRAM_API_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!DEEPGRAM_API_KEY || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const audioUrl = String(body?.audioUrl || '').trim()
  if (!audioUrl) return json({ error: 'audioUrl is required' }, 400)
  const requestedLanguage = String(body?.language || '').trim()
  const language = ALLOWED_LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'zh-HK'

  const { transcript, reason } = await callDeepgram(DEEPGRAM_API_KEY, audioUrl, language)
  if (transcript == null) return json({ error: `Deepgram could not transcribe this file: ${reason || 'unknown'}` }, 502)

  // An empty-but-successful transcript is real information (silence, or a
  // very short/unclear clip) — return it as-is rather than treating it as
  // an error, so the caller can show "(no speech detected)" instead of a
  // misleading failure. `language` echoed back so the caller can store which
  // one actually got used (relevant since an invalid request value silently
  // fell back to zh-HK above).
  return json({ transcript, language })
}

export const config = { path: '/api/transcribe-whatsapp-audio' }
