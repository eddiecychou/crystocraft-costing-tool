// V8.2 — TagManager.jsx's "Suggest merges (AI)" action. Customer tags
// accumulated for years as free-typed text (no picklist existed for most of
// that time — see CustomerForm.jsx's TAG_GROUPS, added later) so the same
// real thing often ended up spelled several ways ("jes active customer",
// "JES Active", "active - JES"). This never writes anything itself: it only
// proposes groupings + a canonical spelling for each; TagManager.jsx applies
// an accepted group via renameTagEverywhere() (domain/customer.js), same
// admin-reviews-before-it-lands posture as every other AI feature here.
//
// Same split as refresh-email-summary.js: the browser already has Firestore
// access and sends the flat list of tags in use; this function only holds
// DEEPSEEK_API_KEY and calls the model.
//
// POST { tags: string[] } -> { groups: [{ canonical, tags: string[] }] }
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
  // V8.13: front-office — admin OR sales (see lib/auth.js requireFrontOffice)
  return ['admin', 'sales'].includes(doc?.fields?.role?.stringValue)
}

const SYSTEM = 'You are cleaning up a messy free-text tag list on a B2B customer CRM (a corporate gift/crystal ' +
  'products supplier). Tags were typed in by hand over several years with no fixed vocabulary, so the same real ' +
  'thing is often spelled several different ways: casing differences, singular/plural, abbreviations, punctuation, ' +
  'word order, or near-synonyms that mean the same distinguishing fact about the customer. Find groups of 2 or ' +
  'more tags from the given list that clearly refer to the same real thing, and propose ONE canonical spelling ' +
  'per group (Title Case, concise, no redundant words). Be conservative: only group tags you are genuinely ' +
  'confident mean the same thing — do NOT group tags that are merely related or in the same category (e.g. do ' +
  'not group "Poland" with "Europe", and do not group "VIP" with "High Volume"). A tag that has no clear ' +
  'duplicate should simply not appear in any group. Return ONLY a valid JSON object: ' +
  '{ "groups": [ { "canonical": "string", "tags": ["exact original tag", "..."] } ] }. Every string inside ' +
  '"tags" must be copied EXACTLY (same case, same punctuation) from the input list.'

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
          temperature: 0.2, max_tokens: 2000,
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
  if (!(await isAdmin(uid, token, PROJECT_ID))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const tags = Array.isArray(body?.tags) ? body.tags.map(String).filter(Boolean) : []
  if (tags.length < 2) return json({ groups: [] })

  const { result, reason } = await callDeepSeek(DEEPSEEK_API_KEY, SYSTEM, JSON.stringify(tags))
  if (!result) return json({ error: `DeepSeek did not return usable suggestions: ${reason || 'unknown'}` }, 502)

  // Trust nothing back verbatim — keep only groups whose tags are all real
  // input tags (guards against the model inventing/mangling a spelling) and
  // that still have 2+ members after that filter.
  const tagSet = new Set(tags)
  const groups = (Array.isArray(result.groups) ? result.groups : [])
    .map(g => ({
      canonical: String(g?.canonical || '').trim(),
      tags: Array.isArray(g?.tags) ? [...new Set(g.tags.map(String))].filter(t => tagSet.has(t)) : [],
    }))
    .filter(g => g.canonical && g.tags.length >= 2)

  return json({ groups })
}

export const config = { path: '/api/suggest-tag-merges' }
