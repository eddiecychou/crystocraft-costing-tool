// Dashboard "This Week" section (V8.15) — one batched DeepSeek call covering
// every customer active in the last 7 days, instead of one call per
// customer (weekly_summary.js's generateWeeklySummary() already did the
// gathering/filtering client-side; this only turns each customer's raw
// text into a short digest). Same split as refresh-email-summary.js: the
// browser holds Firestore access and does the reading/writing, this
// function only holds the DEEPSEEK_API_KEY secret.
//
// POST { customers: [{ id, name, text }] } -> { digests: [{ id, digest }] }
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
  const role = doc?.fields?.role?.stringValue
  if (role === 'admin') return true
  if (role !== 'staff') return false
  const mods = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue)
  return mods.includes(moduleKey)
}

// Cap total customers per call and per-customer text (weeklySummary.js
// caps each customer's text at 6000 chars, up from 4000 when the window was
// widened 7d->30d, 2026-09-17). MAX_TOTAL_INPUT_CHARS is a second, blunter
// safety net on the JOINED prompt: a genuinely busy month across many
// customers (up to MAX_CUSTOMERS_PER_CALL of them) is real headroom beyond
// what a busy WEEK ever needed — better to truncate the tail of the prompt
// than send an oversized request and get an opaque failure back.
const MAX_CUSTOMERS_PER_CALL = 40
const MAX_TOTAL_INPUT_CHARS = 180000

const SYSTEM = 'You are reading the last 30 days\' activity for several B2B customers of Crystocraft (a corporate ' +
  'gift/crystal products supplier), across two channels: a manually-logged CRM Interaction Log, and recent ' +
  'email. For EACH customer block below, write a short digest (1-2 sentences) of what happened this month and ' +
  'what (if anything) is outstanding — factual only, do not invent details not present in the text. ' +
  'Return ONLY a valid JSON object: { "digests": [ { "id": "<the customer id exactly as given>", ' +
  '"digest": "1-2 sentence summary" }, ... ] } — one entry per customer id given, in any order.'

async function callDeepSeek(apiKey, system, user) {
  let reason = 'unknown'
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-flash', reasoning_effort: 'none',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.3, max_tokens: 2000,
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
  const customers = Array.isArray(body?.customers) ? body.customers.slice(0, MAX_CUSTOMERS_PER_CALL) : []
  if (customers.length === 0) return json({ error: 'customers[] is required' }, 400)

  const userPrompt = customers
    .map(c => `--- Customer id="${c.id}" name="${c.name}" ---\n${c.text}`)
    .join('\n\n')
    .slice(0, MAX_TOTAL_INPUT_CHARS)

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, SYSTEM, userPrompt)
  if (!Array.isArray(result?.digests)) return json({ error: `DeepSeek did not return usable digests: ${reason || 'unknown'}` }, 502)

  return json({ digests: result.digests })
}

export const config = { path: '/api/weekly-digest' }
