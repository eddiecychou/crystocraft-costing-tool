// Daily Drafts re-engagement engine (V7.23) — turns a hand-picked product and
// a pre-filtered candidate list into 10-20 AI-drafted, plain-text outreach
// emails for human review (src/marketing/DailyDrafts.jsx). Admin-triggered,
// no cron — same "a human clicks a button" posture as send-campaign.js.
//
// This function does NOT touch Firestore. Candidate eligibility (crm_status,
// cooldown, blockOutreachUntil) is computed client-side in DailyDrafts.jsx
// from data the browser can already read under the existing customers rules
// — the same split Campaigns.jsx uses (it builds segments client-side, the
// edge function only does the part that needs a secret). Once this returns,
// the browser writes the outreach_drafts docs itself via
// domain/outreachDrafts.js.
//
// POST { product: { id, name, description, category },
//        candidates: [{ id, name, email, crm_category, crm_status, notes, erp_code, country, source? }],
//        historicalHints?: string, targetingNote?: string }
//   -> { drafts: [{ customerId, customerEmail, customerName, customerContext,
//                    fitScore, fitReason, draftSubject, draftBody, source }] }
//
// historicalHints — a short client-computed summary of recent skip/send
// outcomes (domain/outreachDrafts.js's listRecentDecisions(), summarized in
// DailyDrafts.jsx), folded into the fit-score prompt as one more paragraph of
// context. This is prompt-engineering, not fine-tuning — DeepSeek has no
// memory or training hook available here; each generate run is still
// stateless, it's just told what happened recently.
//
// targetingNote — free text the owner types on the Generate card, e.g. "I
// want to interact with Crystocraft distributors in Europe". Treated as a
// STRONG steering instruction in the fit-score prompt (unlike
// historicalHints' "soft guidance") — a candidate that plainly doesn't match
// gets scored near 0 rather than just nudged down, since the whole point of
// typing this is to narrow today's batch, not gently bias it.
//
// Env (Netlify site vars, server-side only):
//   DEEPSEEK_API_KEY       — required
//   SUPABASE_URL / SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) — the
//     same ERP-mirror creds erp.js already uses, for the purchase-history pull
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

// Hard ceilings independent of what the client sends — protects DeepSeek rate
// limits and this function's own running time even if a bug ever asks for a
// larger candidate pool than intended.
const MAX_CANDIDATES = 80
const TOP_N = 20
const SCORE_CHUNK = 10

// One DeepSeek JSON-mode call. Single model (unlike the Gemini functions'
// flash/pro fallback list — DeepSeek doesn't have an equivalent tier to fall
// back to), with one retry on failure/empty response before giving up.
async function callDeepSeek(apiKey, { system, user, temperature, maxTokens }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature,
          max_tokens: maxTokens,
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

function fitScorePrompt(product, candidate, historicalHints, targetingNote) {
  return {
    system: 'You are a B2B sales analyst for Crystocraft, a premium Hong Kong corporate gift manufacturer. ' +
      'Given a customer profile and a product, judge how likely that specific customer is to engage with an ' +
      'email introducing this product. Return ONLY a valid JSON object: { "fitScore": number between 0 and 1, "fitReason": "one short sentence" }.' +
      (targetingNote ? `\n\nToday's targeting focus, set by the owner — this is a STRONG requirement, not a preference: "${targetingNote}". A candidate that clearly does not fit this focus should score near 0, even if they would otherwise be a good match for the product.` : '') +
      (historicalHints ? `\n\nKnown patterns from past outreach decisions (use as soft guidance, not a hard rule):\n${historicalHints}` : ''),
    user: `Product: ${product.name}\nCategory: ${product.category || 'n/a'}\nDescription: ${(product.description || '').slice(0, 500)}\n\n` +
      `Customer: ${candidate.name}\nCountry: ${candidate.country || 'unknown'}\nRelationship type: ${candidate.crm_category || 'unknown'}\nStatus: ${candidate.crm_status || 'unknown'}\n` +
      `CRM notes: ${(candidate.notes || 'none').slice(0, 500)}`,
  }
}

function draftPrompt(product, candidate, customerContext) {
  return {
    system: 'You are an expert B2B sales assistant for Crystocraft. Your task is to write a very short, personal, ' +
      'plain-text email from the owner (Eddie) to a customer.\n\n' +
      'Requirements:\n' +
      '- Use plain English; no HTML or markdown.\n' +
      '- Keep it under 4 sentences.\n' +
      '- Mention the product name and why it might interest THIS specific customer, based on their history.\n' +
      '- Sound like a real person, not a marketing robot.\n' +
      '- Do NOT mention any other customer names.\n' +
      '- NEVER start with "Elevate", "Discover", "Introducing", "Transform", or "Unleash".\n\n' +
      'Return ONLY a valid JSON object: { "subject": "string", "body": "string", "explanation": "one short sentence on why this angle" }.',
    user: `Customer context:\n${customerContext}\n\nProduct to introduce: ${product.name} — ${(product.description || '').slice(0, 500)}\nProduct category: ${product.category || 'n/a'}\n\nWrite a friendly email that Eddie could send today.`,
  }
}

// Last 3 sales invoices for this customer's ERP code, via the same curated
// Supabase view erp.js already queries (erp_sales_invoice, searchable by
// customer_code). No self-call to /api/erp — this function already has the
// server creds, so it queries Supabase directly.
async function recentInvoices(supabaseUrl, serviceKey, erpCode) {
  if (!erpCode) return []
  const safe = erpCode.replace(/["\\]/g, ' ')
  const params = new URLSearchParams()
  params.set('select', 'code,customer,order_date,total')
  params.set('order', 'code.desc')
  params.set('limit', '3')
  params.set('customer_code', `ilike.*${safe}*`)
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/erp_sales_invoice?${params.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

function buildCustomerContext(candidate, invoices) {
  const parts = []
  if (candidate.crm_category || candidate.crm_status) {
    parts.push(`Relationship: ${candidate.crm_category || 'unknown'} (${candidate.crm_status || 'unknown'})`)
  }
  if (candidate.notes) parts.push(`CRM notes: ${candidate.notes.slice(0, 800)}`)
  if (invoices.length) {
    const lines = invoices.map(i => `- ${i.code} on ${i.order_date || '?'}: ${i.total ?? '?'}`).join('\n')
    parts.push(`Recent purchases:\n${lines}`)
  } else {
    parts.push('No purchase history on file.')
  }
  return parts.join('\n\n')
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const PROJECT_ID = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!DEEPSEEK_API_KEY || !SUPABASE_URL || !SUPABASE_KEY || !PROJECT_ID) {
    return json({ error: 'Server not configured' }, 500)
  }

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
  const product = body?.product
  const candidates = Array.isArray(body?.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : []
  const historicalHints = String(body?.historicalHints || '').slice(0, 1500)
  const targetingNote = String(body?.targetingNote || '').slice(0, 300)
  if (!product?.id || !product?.name) return json({ error: 'product is required' }, 400)
  if (!candidates.length) return json({ error: 'No candidates supplied' }, 400)

  // 1) Fit-score every candidate, chunked to stay polite to DeepSeek's rate limit.
  const scored = []
  for (let i = 0; i < candidates.length; i += SCORE_CHUNK) {
    const chunk = candidates.slice(i, i + SCORE_CHUNK)
    const results = await Promise.all(chunk.map(async (c) => {
      const r = await callDeepSeek(DEEPSEEK_API_KEY, { ...fitScorePrompt(product, c, historicalHints, targetingNote), temperature: 0.3, maxTokens: 200 })
      return { candidate: c, fitScore: typeof r?.fitScore === 'number' ? r.fitScore : 0, fitReason: r?.fitReason || '' }
    }))
    scored.push(...results)
  }

  // 2) Keep the top N.
  const finalists = scored.sort((a, b) => b.fitScore - a.fitScore).slice(0, TOP_N)

  // 3) For each finalist: pull real purchase history, then draft the email.
  const drafts = await Promise.all(finalists.map(async ({ candidate, fitScore, fitReason }) => {
    const invoices = await recentInvoices(SUPABASE_URL, SUPABASE_KEY, candidate.erp_code)
    const customerContext = buildCustomerContext(candidate, invoices)
    const draft = await callDeepSeek(DEEPSEEK_API_KEY, { ...draftPrompt(product, candidate, customerContext), temperature: 0.8, maxTokens: 400 })
    if (!draft?.subject || !draft?.body) return null
    return {
      customerId: candidate.id,
      customerEmail: candidate.email,
      customerName: candidate.name,
      customerContext,
      source: candidate.source || 'customer',
      fitScore,
      fitReason: fitReason || draft.explanation || '',
      draftSubject: draft.subject,
      draftBody: draft.body,
    }
  }))

  return json({ drafts: drafts.filter(Boolean) })
}

export const config = { path: '/api/generate-outreach-drafts' }
