// V8.2 — the on-demand "Refresh" action on CustomerDetail.jsx's WhatsApp
// card, mirroring refresh-email-summary.js exactly (same split, same
// posture: generated only when an admin wants one, over whatever's been
// imported so far — never automatic). This is also what makes WhatsApp
// correspondence usable by Daily Drafts (generate-outreach-drafts.js): that
// function reads the cached customers/{id}.whatsapp_summary field, the same
// way it already reads .email_summary, rather than re-rendering raw threads
// for every candidate on every batch run.
//
// Same split every other AI edge function here uses: the browser already
// has Firestore read access via the SDK and renders customers/{id}/
// whatsapp_threads itself (whatsappSummaryApi.js's renderThreadsText), so
// this function only holds DEEPSEEK_API_KEY and calls the model. The
// browser writes the result back onto customers/{id}.whatsapp_summary —
// this function never touches Firestore.
//
// POST { threadsText, threadCount } -> { summary, recent_activity, open_commitments }
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY — required (shared with every other DeepSeek feature)
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function isFrontOffice(uid, idToken, projectId, moduleKey) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  // V8.14: admin, OR a `staff` account whose modules[] contains this key.
  const role = doc?.fields?.role?.stringValue
  if (role === 'admin') return true
  if (role !== 'staff') return false
  const mods = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue)
  return mods.includes(moduleKey)
}

// WhatsApp chats are far shorter-lived than the email archive this pattern
// was built for (tens of threads, not hundreds) — no recency/oldest split
// needed, just a cap as a safety net.
const MAX_INPUT_CHARS = 40000

const SYSTEM = 'You are reading real WhatsApp chat history between Crystocraft (a Hong Kong corporate gift/crystal ' +
  'products supplier) and one of its customers, exported by the sales owner from WhatsApp Business or their ' +
  'personal WhatsApp. Messages are often short, informal, and mix Cantonese and English — some are voice-note ' +
  'transcripts, marked as such; a voice note with no transcript yet has no content to read. Read the chats and ' +
  'produce a factual summary for the owner to review before a sales call. Do not invent facts not present in the ' +
  'messages — if something is unclear or a voice note lacks a transcript, say so rather than guessing. Return ' +
  'ONLY a valid JSON object: { "summary": "2-4 sentence overview of the relationship and what is generally ' +
  'discussed", "recent_activity": "1-3 sentences on what happened most recently, with rough dates", ' +
  '"open_commitments": ["short bullet", "..."] }'

async function callDeepSeek(apiKey, system, user) {
  let reason = 'unknown'
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.3, max_tokens: 700,
        }),
      })
      if (!res.ok) { reason = `DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}`; continue }
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) { reason = 'DeepSeek returned an empty response'; continue }
      try {
        return { result: JSON.parse(text), reason: null }
      } catch {
        reason = `DeepSeek returned non-JSON: ${text.slice(0, 200)}`
        continue
      }
    } catch (e) {
      reason = `Request failed: ${String(e?.message || e).slice(0, 200)}`
    }
  }
  return { result: null, reason }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!DEEPSEEK_API_KEY || !PROJECT_ID) return json({ error: 'Server not configured' }, 500)

  const token = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!token) return json({ error: 'Not signed in' }, 401)
  let uid
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID,
    })
    uid = payload.sub
  } catch { return json({ error: 'Invalid or expired session' }, 401) }
  if (!(await isFrontOffice(uid, token, PROJECT_ID, 'customers'))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const threadsText = String(body?.threadsText || '').trim()
  if (!threadsText) return json({ error: 'threadsText is required — nothing imported for this customer yet' }, 400)

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, SYSTEM, threadsText.slice(0, MAX_INPUT_CHARS))
  if (!result?.summary) return json({ error: `DeepSeek did not return a usable summary: ${reason || 'unknown'}` }, 502)

  return json({
    summary: result.summary,
    recent_activity: result.recent_activity || '',
    open_commitments: Array.isArray(result.open_commitments) ? result.open_commitments : [],
  })
}

export const config = { path: '/api/refresh-whatsapp-summary' }
