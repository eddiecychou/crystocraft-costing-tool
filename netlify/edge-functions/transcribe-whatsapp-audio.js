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
// POST { audioUrl } -> { transcript }
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

// Explicit language=zh-HK (Cantonese Traditional), not detect_language —
// the first real transcription attempt (owner, 2026-08-12) came back
// "no speech detected" on a real Cantonese voice note using nova-2 +
// detect_language=true. Confirmed against Deepgram's own docs: Cantonese
// auto-detection isn't reliably covered, and nova-2 has weaker Cantonese
// support than nova-3, which added it properly. Since the owner's audio is
// mostly Cantonese, forcing the known-good explicit path beats gambling on
// auto-detect. Deepgram's Cantonese model still handles short embedded
// English phrases reasonably (real chats mix the two), so this isn't a
// pure regression for the English-heavy messages.
const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=zh-HK&smart_format=true&punctuate=true'

async function callDeepgram(apiKey, audioUrl) {
  let reason = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch(DEEPGRAM_URL, {
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
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin access required' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const audioUrl = String(body?.audioUrl || '').trim()
  if (!audioUrl) return json({ error: 'audioUrl is required' }, 400)

  const { transcript, reason } = await callDeepgram(DEEPGRAM_API_KEY, audioUrl)
  if (transcript == null) return json({ error: `Deepgram could not transcribe this file: ${reason || 'unknown'}` }, 502)

  // An empty-but-successful transcript is real information (silence, or a
  // very short/unclear clip) — return it as-is rather than treating it as
  // an error, so the caller can show "(no speech detected)" instead of a
  // misleading failure.
  return json({ transcript })
}

export const config = { path: '/api/transcribe-whatsapp-audio' }
