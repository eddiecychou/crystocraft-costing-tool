// V8.1 email ingestion — the "reduce" half of the map-reduce rewrite of the
// Discover More chat (owner's suggestion, 2026-08-12): decompose a question
// into independent facets (one per person/keyword, one per routed time
// range — see emailSummaryApi.js's buildKeywordFacets()), answer each facet
// against its OWN full-budget slice of thread content in parallel (the
// "map" step, discuss-customer-email.js called once per facet), then this
// function merges the resulting short partial answers into one coherent
// reply. Never sees raw email content, only the partial answers — stays
// small regardless of how much thread text the map step actually scanned.
//
// POST { question, partials: [{ label, answer }] } -> { reply }
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

async function isFrontOffice(uid, idToken, projectId, moduleKey) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!r.ok) return false
  const doc = await r.json()
  // V8.14: admin, OR a legacy production/sales account (shim), OR a `staff`
  // account whose modules[] contains this function's module key.
  const role = doc?.fields?.role?.stringValue
  if (role === 'admin' || role === 'sales' || role === 'production') return true
  if (role !== 'staff') return false
  const mods = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue)
  return mods.includes(moduleKey)
}

const SYSTEM = 'You are combining several partial answers into one coherent reply for the Crystocraft sales ' +
  'owner. Each partial answer was generated independently, looking at only ONE facet of the customer\'s email ' +
  'history (e.g. one specific person, or one specific time range) — a partial saying "not found" for its own ' +
  'facet does NOT mean the answer doesn\'t exist elsewhere; it only means that facet\'s slice didn\'t have it. ' +
  'Rely on whichever partials actually found something, and combine complementary or even seemingly ' +
  'conflicting facts into one answer rather than picking just one partial. If genuinely none of the partials ' +
  'found anything relevant, say so plainly. Keep the final answer to 2-6 sentences unless the question clearly ' +
  'needs more detail.\n\n' +
  'One of the partials may itself be a clarifying question (a facet\'s own answer decided the question was too ' +
  'ambiguous to answer directly) rather than a factual answer — if so, and the OTHER partials don\'t resolve ' +
  'that ambiguity between them, pass the clarifying question through as the final reply instead of forcing a ' +
  'guess. Only override it with a real combined answer if the other partials actually settle which option was ' +
  'meant.\n\n' +
  'Return ONLY a valid JSON object: { "reply": "your combined answer, OR a clarifying question" }.'

async function callDeepSeek(apiKey, question, partials) {
  const user = `Original question: ${question}\n\n` +
    partials.map(p => `--- Partial answer about "${p.label}" ---\n${p.answer}`).join('\n\n')
  let reason = 'unknown'
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.3, max_tokens: 500,
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
  const question = String(body?.question || '').trim()
  const partials = Array.isArray(body?.partials)
    ? body.partials.filter(p => p?.answer).map(p => ({ label: String(p.label || '').slice(0, 100), answer: String(p.answer).slice(0, 2000) })).slice(0, 10)
    : []
  if (!question) return json({ error: 'question is required' }, 400)
  if (!partials.length) return json({ error: 'partials is required — nothing to compose' }, 400)

  // Skip the LLM entirely when there's only one partial — nothing to
  // reconcile, and it avoids a pointless extra DeepSeek call/latency.
  if (partials.length === 1) return json({ reply: partials[0].answer })

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, question, partials)
  if (!result?.reply) return json({ error: `DeepSeek did not return a usable reply: ${reason || 'unknown'}` }, 502)

  return json({ reply: result.reply })
}

export const config = { path: '/api/compose-email-answer' }
