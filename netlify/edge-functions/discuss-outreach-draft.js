// Daily Drafts re-engagement engine (V7.23) — a per-draft "discuss with AI"
// chat (src/marketing/DailyDrafts.jsx), so the owner can correct or refine a
// draft conversationally ("they prefer WhatsApp, not email", "wrong angle,
// they're a distributor not a retailer") instead of hand-editing text.
//
// This is the first MULTI-TURN AI call in this codebase — every other AI
// edge function (rewrite-section.js, generate-outreach-drafts.js) sends a
// single system+user pair with no accumulated history. Here the client
// keeps the running transcript (DailyDrafts.jsx component state, not
// persisted to Firestore — a chat is working scratch, not a record worth
// keeping once the email is sent or skipped) and resends it each turn.
//
// The AI ONLY redrafts the email. It never writes to the customer's CRM
// record — that's a separate, explicit "Save as note" action in the UI
// (direct Firestore write, no AI involved in deciding what's worth saving).
//
// POST { productContext, customerContext, draftSubject, draftBody,
//        history: [{role:'user'|'assistant', content}], message }
//   -> { reply, subject, body }
//   reply is shown in the chat transcript; subject/body replace the draft's
//   editable fields only when the AI actually changed them (a pure Q&A turn
//   shouldn't blank out an edit the owner made some other way).
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY — required (shared with generate-outreach-drafts.js)
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

// Hard ceiling on how much conversation gets resent — protects both the
// token budget and this function's running time; a chat this long should
// really just be a fresh draft.
const MAX_HISTORY_TURNS = 20

const SYSTEM = 'You are an expert B2B sales assistant for Crystocraft, helping the owner (Eddie) refine a ' +
  'draft outreach email through conversation. Keep the email itself to the SAME constraints as the original ' +
  'draft: plain English, no HTML/markdown, under 4 sentences, sounds like a real person not a marketing robot, ' +
  'never starts with "Elevate"/"Discover"/"Introducing"/"Transform"/"Unleash".\n\n' +
  'The owner may: ask you to change the tone/angle/wording, correct a fact you got wrong, or just ask a question ' +
  'without wanting the email itself changed. Only change subject/body when the request actually calls for it.\n\n' +
  'IMPORTANT: you can only see and edit THIS ONE email — there may be other draft emails to other customers in ' +
  'the same review batch, but you have no visibility into them and no ability to change them. If the owner asks ' +
  'you to apply something "to all of them", "every thread", "everyone", or similar, still make the requested ' +
  'change to THIS email, but say plainly in your reply that this only updated this one draft and the others ' +
  'would need the same request repeated on each — never imply you touched anything beyond this email.\n\n' +
  'CRITICAL CONSISTENCY RULE: your "reply" text and your subject/body fields must never contradict each other. ' +
  'If your reply says or implies you updated, changed, added something to, or rewrote the email (e.g. "I\'ve ' +
  'updated the email", "here\'s the updated draft", "I\'ve added the link"), then subject and/or body in that ' +
  'SAME response MUST be non-null and MUST actually contain that change. Never claim a change was made while ' +
  'returning null for both — if you are not actually changing the email, your reply must say so plainly instead ' +
  '(e.g. "Got it, but I don\'t think that needs a wording change — let me know if you want me to adjust it anyway").\n\n' +
  'Return ONLY a valid JSON object: { "reply": "short conversational reply to the owner, 1-2 sentences", ' +
  '"subject": "string or null (null = unchanged)", "body": "string or null (null = unchanged)" }.'

async function callDeepSeek(apiKey, messages) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat', messages,
          response_format: { type: 'json_object' },
          temperature: 0.6, max_tokens: 500,
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
  const { productContext, customerContext, draftSubject, draftBody, message } = body || {}
  const history = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY_TURNS) : []
  if (!String(message || '').trim()) return json({ error: 'message is required' }, 400)
  if (!draftSubject || !draftBody) return json({ error: 'draftSubject and draftBody are required' }, 400)

  const intro = `Current draft:\nSubject: ${draftSubject}\nBody: ${draftBody}\n\n` +
    `Product context: ${productContext || 'n/a'}\nCustomer context: ${customerContext || 'n/a'}`

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: intro },
    ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '') })),
    { role: 'user', content: String(message).trim() },
  ]

  const result = await callDeepSeek(DEEPSEEK_API_KEY, messages)
  if (!result?.reply) return json({ error: 'DeepSeek did not return a usable reply — try again.' }, 502)

  return json({
    reply: result.reply,
    subject: result.subject || null,
    body: result.body || null,
  })
}

export const config = { path: '/api/discuss-outreach-draft' }
