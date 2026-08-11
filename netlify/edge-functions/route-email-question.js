// V8.1 email ingestion — cheap first pass for CustomerDetail.jsx's
// "Discover more" chat, added 2026-08-12 after a high-volume customer
// (Widdop, 786 ingested threads) made clear that a blind recency cutoff
// (and even a recent+oldest split — see emailSummaryApi.js's
// renderThreadsText) can't answer a specific "what happened in 2020" /
// "earliest order" question when that year's data never made it into the
// context at all.
//
// This does NOT read any email content — only a compact year -> thread
// count index the client builds from threads it's already loaded (see
// buildYearIndex() in emailSummaryApi.js). Given that index and the
// question, DeepSeek picks which year(s) are worth actually fetching full
// content for. The client then filters its already-loaded thread list to
// those years and calls discuss-customer-email.js as normal — this
// function never sees real customer correspondence, just counts.
//
// POST { yearIndex: "2018: 12, 2019: 45, ...", question: string }
//   -> { years: [number, ...] }  (empty = no specific year, use the
//      existing recent+oldest general mix instead)
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

const SYSTEM = 'You are routing a question about a B2B customer\'s email history to the right year(s) before ' +
  'the actual content gets fetched (this saves fetching irrelevant years for a customer with a lot of history). ' +
  'You are given only a count of email threads per year, NOT the email content itself.\n\n' +
  'Rules:\n' +
  '- "earliest"/"first"/"oldest" -> the earliest year(s) that have any threads.\n' +
  '- "latest"/"recent"/"now"/"currently" -> the most recent year(s) that have any threads.\n' +
  '- A specific year or date mentioned in the question -> that year.\n' +
  '- A broad/general question not tied to any particular time ("who are the contacts", "what do we usually ' +
  'discuss") -> return an empty array, meaning "no specific year, use the general mix instead".\n' +
  '- When in doubt, prefer including the most recent 1-2 years that have data, plus the earliest year, over ' +
  'guessing a middle year that seems plausible but isn\'t clearly implied by the question.\n\n' +
  'Return ONLY a valid JSON object: { "years": [array of up to 3 year numbers, most relevant first] }'

async function callDeepSeek(apiKey, yearIndex, question) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Year -> thread count: ${yearIndex}\n\nQuestion: ${question}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0, max_tokens: 100,
        }),
      })
      if (!res.ok) continue
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) continue
      return JSON.parse(text)
    } catch { /* try again, or fall through to null below */ }
  }
  return null
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
  const yearIndex = String(body?.yearIndex || '').trim()
  const question = String(body?.question || '').trim()
  if (!yearIndex) return json({ years: [] }) // nothing to route over — caller falls back to the general mix
  if (!question) return json({ error: 'question is required' }, 400)

  const result = await callDeepSeek(DEEPSEEK_API_KEY, yearIndex, question)
  const years = Array.isArray(result?.years) ? result.years.filter(y => Number.isInteger(y)).slice(0, 3) : []
  return json({ years })
}

export const config = { path: '/api/route-email-question' }
