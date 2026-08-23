// Daily Drafts re-engagement engine (V8.0 compose phase) — turns a free-text
// topic ("invite long-time customers to try the new customer portal") into
// ONE starting draft, before anyone is targeted. This is deliberately the
// simplest piece of the whole feature: one DeepSeek call, no candidates, no
// scoring — src/marketing/DailyDrafts.jsx's "Draft with AI" button. The
// owner then refines it via discuss-outreach-draft.js (reused unchanged —
// that function only needs {productContext, customerContext, draftSubject,
// draftBody, history, message}, and works fine with customerContext: ''
// since no candidate is chosen yet at this stage) before ever targeting
// anyone. generate-outreach-drafts.js then personalizes the APPROVED
// result per recipient — it does not draft from scratch anymore.
//
// POST { topic } -> { subject, body }
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY — required (shared with generate-outreach-drafts.js / discuss-outreach-draft.js)
//   VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID — for admin-token verification
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'
import { buildMemoryBlock } from './lib/draftMemory.js'

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

// Same model-loop/JSON-mode shape as generate-outreach-drafts.js's
// callDeepSeek — single model (DeepSeek has no flash/pro fallback tier the
// way the Gemini functions do), one retry on failure/empty response.
async function callDeepSeek(apiKey, { system, user }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.8,
          max_tokens: 400,
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

const SYSTEM = 'You are an expert B2B sales assistant for Crystocraft, a premium Hong Kong corporate gift manufacturer. ' +
  'Write a very short, personal, plain-text starting draft for an email the owner (Eddie) will send, based on the topic below.\n\n' +
  'Requirements:\n' +
  '- Use plain English; no HTML or markdown.\n' +
  '- Keep it under 4 sentences.\n' +
  '- Sound like a real person writing a quick personal note, not a marketing robot or corporate announcement.\n' +
  '- Do NOT mention any specific customer name — this is a starting template that gets personalized per recipient later.\n' +
  '- NEVER start with "Elevate", "Discover", "Introducing", "Transform", or "Unleash".\n\n' +
  'Return ONLY a valid JSON object: { "subject": "string", "body": "string" }.'

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
  const topic = String(body?.topic || '').trim().slice(0, 500)
  if (!topic) return json({ error: 'topic is required' }, 400)

  // Draft Memory Layer (V8.9) — Eddie's confirmed global writing rules, so
  // the first draft is written to a standard instead of DeepSeek picking
  // fresh style choices every time. No contact is known yet at this stage,
  // so only globalRules applies here (see lib/draftMemory.js).
  const globalRules = Array.isArray(body?.memory?.globalRules) ? body.memory.globalRules.slice(0, 8) : []
  const memoryBlock = buildMemoryBlock({ globalRules })
  const system = memoryBlock ? `${SYSTEM}\n\n${memoryBlock}` : SYSTEM

  const result = await callDeepSeek(DEEPSEEK_API_KEY, { system, user: `Topic: ${topic}` })
  if (!result?.subject || !result?.body) return json({ error: 'DeepSeek did not return a usable draft — try again.' }, 502)

  return json({ subject: result.subject, body: result.body })
}

export const config = { path: '/api/draft-outreach-topic' }
