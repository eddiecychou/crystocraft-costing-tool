// V8.10 — the on-demand "Refresh" action on CustomerDetail.jsx's Alibaba
// Messages card, mirroring refresh-whatsapp-summary.js exactly (same auth/
// DeepSeek-call/error-handling structure). Unlike WhatsApp (structured
// imported threads) and Email (IMAP sync), Alibaba.com's buyer-seller chat
// has NO export — the owner can only copy-paste the raw chat text by hand
// off the Alibaba.com website (src/alibabaSummaryApi.js's
// savePastedAlibabaThread/renderThreadsText). This function only ever sees
// the already-rendered text block, never touches Firestore itself, and
// never knows whether it came from customers/ or marketing_contacts/ — same
// split as every other AI edge function here.
//
// POST { threadsText } -> { summary, recent_activity, open_commitments }
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
  // V8.14: admin, OR a legacy production/sales account (shim), OR a `staff`
  // account whose modules[] contains this function's module key.
  const role = doc?.fields?.role?.stringValue
  if (role === 'admin' || role === 'sales' || role === 'production') return true
  if (role !== 'staff') return false
  const mods = (doc?.fields?.modules?.arrayValue?.values || []).map(v => v?.stringValue)
  return mods.includes(moduleKey)
}

// Matches whatsappSummaryApi.js's own margin under the edge function's cap.
const MAX_INPUT_CHARS = 40000

const SYSTEM = 'You are reading raw text copy-pasted by hand from Alibaba.com\'s own buyer-seller messaging/chat ' +
  'interface (Alibaba.com gives sellers no export or API for this, so the owner selects and copies the ' +
  'conversation directly off the website) between Crystocraft (a Hong Kong corporate-gift and crystal-products ' +
  'manufacturer, an Alibaba.com seller) and an international B2B buyer. Typical content: product inquiries, ' +
  'MOQ/pricing negotiation, sample requests, order status updates, and sometimes shipping or customs questions. ' +
  'Because the text was copy-pasted straight off a web page, it may contain UI chrome, timestamps, sender-name ' +
  'labels, or other interface noise mixed in with the actual messages — look past that noise and focus on the ' +
  'substance. The text may mix languages (e.g. English with Chinese). Read it and produce a factual summary for ' +
  'the owner to review before following up. Do not invent facts not present in the text — if something is ' +
  'unclear or ambiguous (including where noise makes a passage hard to read), say so rather than guessing. ' +
  'Return ONLY a valid JSON object: { "summary": "2-4 sentence overview of the relationship and what is ' +
  'generally discussed", "recent_activity": "1-3 sentences on what happened most recently, with rough dates if ' +
  'available", "open_commitments": ["short bullet", "..."] }'

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
  if (!threadsText) return json({ error: 'threadsText is required — nothing pasted for this record yet' }, 400)

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, SYSTEM, threadsText.slice(0, MAX_INPUT_CHARS))
  if (!result?.summary) return json({ error: `DeepSeek did not return a usable summary: ${reason || 'unknown'}` }, 502)

  return json({
    summary: result.summary,
    recent_activity: result.recent_activity || '',
    open_commitments: Array.isArray(result.open_commitments) ? result.open_commitments : [],
  })
}

export const config = { path: '/api/refresh-alibaba-summary' }
