// Read-only JEV pilot for cleaning the imported Mailchimp tag vocabulary.
// It returns classifications and review recommendations only. It never reads
// Firestore and never renames, removes, or writes a tag.
import { choice, noul, TypeSafeClient } from 'https://esm.sh/@typesafe-ai/sdk@0.6.0'
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6'
import {
  JEV_MARKETING_TAG_MODEL,
  normalizeTagInputs,
  buildMarketingTagQuestions,
  sanitizeMarketingTagAnswers,
  needsDeepSeekReview,
  sanitizeDeepSeekTagSuggestions,
  buildDeepSeekVerificationQuestions,
  mergeCascadeResults,
} from './lib/jevMarketingTags.js'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

async function hasMarketingAccess(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!response.ok) return false
  const profile = await response.json()
  const role = profile?.fields?.role?.stringValue
  if (role === 'admin') return true
  if (role !== 'staff') return false
  const modules = (profile?.fields?.modules?.arrayValue?.values || []).map(value => value?.stringValue)
  return modules.includes('marketing')
}

const DEEPSEEK_SYSTEM = `You are the second-stage reviewer for a B2B CRM tag cleanup process.
JEV has already classified the easy tags. You receive only unresolved tags that were ambiguous, low-confidence, or possible removal candidates.

For each tag:
- Explain briefly what it most likely meant in a historical Mailchimp list.
- Recommend keep, normalize, review, or removal_candidate.
- A canonical value may be an approved buyer tag or another exact tag from this unresolved batch. Use null when no true equivalent exists.
- Related concepts are not equivalent. Do not collapse geography into buyer type, campaign names into product interests, or VIP into high volume.
- Be conservative. Unclear tags remain review.

Return only JSON: {"suggestions":[{"tag":"exact input tag","interpretation":"short explanation","action":"keep|normalize|review|removal_candidate","canonical":"string or null","reason":"short reason"}]}`

async function askDeepSeek(apiKey, rows) {
  if (!apiKey || rows.length === 0) return []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-flash', reasoning_effort: 'none',
          messages: [
            { role: 'system', content: DEEPSEEK_SYSTEM },
            { role: 'user', content: JSON.stringify({ unresolved_tags: rows }) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 2400,
        }),
      })
      if (!response.ok) continue
      const data = await response.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) continue
      return sanitizeDeepSeekTagSuggestions(JSON.parse(text)?.suggestions, rows)
    } catch { /* retry once, then leave ambiguous rows for human review */ }
  }
  return []
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('TYPESAFE_API_KEY')
  const deepSeekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
  const baseURL = Deno.env.get('TYPESAFE_BASE_URL')
  const projectId = Deno.env.get('VITE_FIREBASE_PROJECT_ID') || Deno.env.get('FIREBASE_PROJECT_ID')
  if (!apiKey || !projectId) return json({ error: 'JEV pilot is not configured.' }, 500)

  const idToken = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1]
  if (!idToken) return json({ error: 'Not signed in' }, 401)

  let uid
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    })
    uid = payload.sub
  } catch {
    return json({ error: 'Invalid or expired session' }, 401)
  }
  if (!(await hasMarketingAccess(uid, idToken, projectId))) return json({ error: 'Access denied' }, 403)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const tags = normalizeTagInputs(body?.tags)
  if (!tags.length) return json({ results: [], model: JEV_MARKETING_TAG_MODEL })

  try {
    const client = new TypeSafeClient({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      logLevel: 'off',
    })
    const response = await client.systemOne({
      state: { tags },
      questions: buildMarketingTagQuestions(tags, { choice }),
    }, { timeout: 20_000, retry: { maxRetries: 2 } })

    const primaryRows = sanitizeMarketingTagAnswers(tags, response.answers)
    const unresolvedRows = primaryRows.filter(needsDeepSeekReview)
    const suggestions = await askDeepSeek(deepSeekApiKey, unresolvedRows)
    let verificationAnswers = {}
    let verificationUsage = null
    if (suggestions.length) {
      const verification = await client.systemOne({
        state: { suggestions },
        questions: buildDeepSeekVerificationQuestions(suggestions, { noul }),
      }, { timeout: 20_000, retry: { maxRetries: 2 } })
      verificationAnswers = verification.answers
      verificationUsage = verification.usage || null
    }

    return json({
      results: mergeCascadeResults(primaryRows, suggestions, verificationAnswers),
      model: response.model || JEV_MARKETING_TAG_MODEL,
      usage: response.usage || null,
      verificationUsage,
      deepSeekUsed: suggestions.length > 0,
      readOnly: true,
    })
  } catch (error) {
    console.error('JEV marketing-tag pilot failed:', error)
    return json({ error: `JEV could not evaluate this batch: ${String(error?.message || error).slice(0, 200)}` }, 502)
  }
}

export const config = { path: '/api/jev-marketing-tags' }
