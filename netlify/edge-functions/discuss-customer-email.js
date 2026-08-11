// V8.1 email ingestion, Phase 2 step 4 — the "Discover more about this
// customer" chat on CustomerDetail.jsx, asking questions of a customer's own
// ingested email history rather than reading a static summary. Same shape as
// discuss-outreach-draft.js: a multi-turn chat where the client keeps the
// running transcript (component state, not persisted — working scratch) and
// resends it each turn; this function holds no state of its own.
//
// Same "stuff every ingested thread into the prompt" approach as
// refresh-email-summary.js — real retrieval (embeddings/vector search) is a
// bigger build than this cycle covers; see that function's MAX_INPUT_CHARS
// comment for the same caveat here.
//
// POST { threadsText, history: [{role:'user'|'assistant', content}], message }
//   -> { reply }
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY — required (shared with the rest of the outreach/email AI functions)
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

const MAX_HISTORY_TURNS = 20
const MAX_INPUT_CHARS = 60000

const SYSTEM = 'You are answering questions about a real B2B customer for the Crystocraft sales owner, using ' +
  'their raw email thread history (exported from the owner\'s live mailbox) as your only source. Answer ONLY ' +
  'from what is actually in the threads provided — if the answer isn\'t there, say so plainly rather than ' +
  'guessing or inventing a plausible-sounding answer. Cite rough dates when relevant. Keep answers to 2-5 ' +
  'sentences unless the owner asks for more detail.\n\n' +
  'For a high-volume customer, the threads below may be split into a "MOST RECENT THREADS" section and an ' +
  '"EARLIEST THREADS ON FILE" section, with a real time gap between them that is NOT included here — do not ' +
  'assume the two sections are contiguous, and if asked about a period that falls in that gap, say the ' +
  'available history does not cover it rather than guessing.\n\n' +
  'Return ONLY a valid JSON object: { "reply": "your answer" }.'

// 2 attempts with backoff per call — rides out a brief transient DeepSeek
// blip (confirmed live: identical request succeeded moments after failing).
// Real failure reason travels back in `reason` regardless.
async function callDeepSeek(apiKey, messages) {
  let reason = 'unknown'
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat', messages,
          response_format: { type: 'json_object' },
          temperature: 0.3, max_tokens: 600,
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
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Admin access required' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const threadsText = String(body?.threadsText || '').trim()
  const message = String(body?.message || '').trim()
  const history = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY_TURNS) : []
  if (!threadsText) return json({ error: 'threadsText is required — nothing ingested for this customer yet' }, 400)
  if (!message) return json({ error: 'message is required' }, 400)

  const buildMessages = (textChars, includeHistory) => [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Email history:\n${threadsText.slice(0, textChars)}` },
    ...(includeHistory ? history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '') })) : []),
    { role: 'user', content: message },
  ]

  // Confirmed live 2026-08-12: a large single-thread threadsText (~56K
  // chars, well under MAX_INPUT_CHARS on its own) succeeded with an empty
  // history, then failed deterministically — same content, same question,
  // repeatable — the moment even a short 2-turn history was added back in.
  // Root cause not confirmed (DeepSeek gave no error, just empty content —
  // possibly a real context-window edge near this size), but retrying the
  // IDENTICAL oversized prompt 4x (the previous fix) was pointless against a
  // deterministic failure, not a transient one. Try progressively smaller
  // prompts instead: full content, then content without history (history is
  // usually short — the bulk of the payload is threadsText), then a halved
  // threadsText with no history, before actually giving up.
  const variants = [
    [MAX_INPUT_CHARS, true],
    [MAX_INPUT_CHARS, false],
    [Math.floor(MAX_INPUT_CHARS / 2), false],
  ]
  let result = null, reason = 'unknown'
  for (const [textChars, includeHistory] of variants) {
    const attempt = await callDeepSeek(DEEPSEEK_API_KEY, buildMessages(textChars, includeHistory))
    if (attempt.result?.reply) { result = attempt.result; break }
    reason = attempt.reason
  }
  if (!result?.reply) return json({ error: `DeepSeek did not return a usable reply: ${reason || 'unknown'}` }, 502)

  return json({ reply: result.reply })
}

export const config = { path: '/api/discuss-customer-email' }
