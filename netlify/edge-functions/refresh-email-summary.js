// V8.1 email ingestion, Phase 2 step 4 — the on-demand "Refresh" action on
// CustomerDetail.jsx's Email Summary card. Deliberately NOT run at ingest
// time (email-sync/sync.py never calls DeepSeek) — summaries are generated
// only when an admin actually wants one, over whatever's been ingested so
// far, same "draft the admin reviews/refreshes" posture as Daily Drafts.
//
// Same split every other AI edge function in this codebase uses: the browser
// already has Firestore read/write access via the SDK (it's a signed-in
// admin, firestore.rules allows it), so it reads customers/{id}/email_threads
// itself and sends the rendered text here; this function only holds the
// DEEPSEEK_API_KEY secret and calls the model. The browser is responsible
// for writing the result back onto customers/{id}.email_summary — this
// function never touches Firestore.
//
// POST { threadsText, threadCount } -> { summary, recent_activity, open_commitments }
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY — required (shared with generate-outreach-drafts.js /
//     discuss-outreach-draft.js)
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (b, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function isFrontOffice(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  // V8.13: front-office — admin OR sales (see lib/auth.js requireFrontOffice)
  return ['admin', 'sales'].includes(doc?.fields?.role?.stringValue)
}

// Cap what actually reaches the model — a customer with a long ingested
// history could otherwise blow past deepseek-chat's context window. This is
// the "stuff everything in the prompt" retrieval the Phase 1 spike used,
// carried forward deliberately (see PROJECT-PLAN.md's V8.1 entry) — real
// retrieval (embeddings/vector search) is a bigger build than this cycle
// covers; if/when a customer's ingested history regularly exceeds this, that
// gap needs to be closed before trusting summaries again.
const MAX_INPUT_CHARS = 60000

const SYSTEM = 'You are reading a real B2B sales email history between Crystocraft (a corporate gift/crystal ' +
  'products supplier) and one of its customers, exported from the sales owner\'s live mailbox. Read the threads ' +
  'and produce a factual summary for the owner to review before a sales call. Do not invent facts not present ' +
  'in the emails — if something is unclear, say so rather than guessing. Return ONLY a valid JSON object: ' +
  '{ "summary": "2-4 sentence overview of the relationship and what is generally discussed", ' +
  '"recent_activity": "1-3 sentences on what happened most recently, with rough dates", ' +
  '"open_commitments": ["short bullet", "..."] }\n\n' +
  'For a high-volume customer, the threads below may be split into a "MOST RECENT THREADS" section and an ' +
  '"EARLIEST THREADS ON FILE" section, with a real time gap between them that is NOT included here — the ' +
  '"recent_activity" field should describe the MOST RECENT section specifically, not assume it covers everything.'

// Was 2 attempts, no delay, no visibility into WHY a call failed — see
// discuss-customer-email.js's identical fix for the live symptom that
// exposed this (rapid-fire questions eating a transient DeepSeek 429/5xx/
// empty-response blip with nothing left to debug from). 4 attempts with a
// longer backoff, real failure reason returned in `reason`.
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
  if (!(await isFrontOffice(uid, token, PROJECT_ID))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const threadsText = String(body?.threadsText || '').trim()
  if (!threadsText) return json({ error: 'threadsText is required — nothing ingested for this customer yet' }, 400)

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, SYSTEM, threadsText.slice(0, MAX_INPUT_CHARS))
  if (!result?.summary) return json({ error: `DeepSeek did not return a usable summary: ${reason || 'unknown'}` }, 502)

  return json({
    summary: result.summary,
    recent_activity: result.recent_activity || '',
    open_commitments: Array.isArray(result.open_commitments) ? result.open_commitments : [],
  })
}

export const config = { path: '/api/refresh-email-summary' }
