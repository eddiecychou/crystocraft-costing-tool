import { rewriteResult } from './lib/rewriteResult.js'
import { requireModule } from './lib/auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireModule(req, ['products', 'figurine', 'marketing'])
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  let input
  try { input = await req.json() } catch { return json({ error: 'Please send a valid rewrite request.' }, 400) }
  const { section_type, heading, body, guidance, context, max_chars } = input || {}
  if (typeof body !== 'string' || !body.trim() || typeof guidance !== 'string' || !guidance.trim()
    || (heading !== undefined && heading !== null && typeof heading !== 'string')
    || (context !== undefined && typeof context !== 'string')) {
    return json({ error: 'Current copy and rewrite instructions are required.' }, 400)
  }

  // Optional hard length budget (chars). ProductForm/RangeForm pass this for the
  // marketing_description field, which has a 300-char textarea limit — without
  // it the "3–4 sentences" guidance below routinely overshoots and the client
  // has to chop the result mid-sentence.
  const requestedBudget = Number(max_chars)
  const budget = section_type === 'marketing_description' ? 300 : Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.max(1, Math.floor(requestedBudget)) : null

  const prompt = `You are an expert SEO content writer for Crystocraft, a premium Hong Kong corporate gift manufacturer.

The user has reviewed the following ${section_type === 'marketing_description' ? 'product marketing description' : 'blog section'} and wants it rewritten based on their guidance.

Section type: ${section_type || 'content'}
${heading ? `Current heading: ${heading}` : ''}
Current body:
${body}

${context ? `Product / post context:\n${context}\n` : ''}
User's guidance / feedback:
${guidance}

Rewrite rules:
- Apply the user's guidance faithfully — that is the priority.
${budget
  ? `- HARD LIMIT: the "body" must be at most ${budget} characters, including spaces and punctuation. Count as you write and stop before the limit — a complete shorter sentence is always better than a truncated one. Aim for roughly ${Math.max(1, Math.round(budget / 140))}–${Math.round(budget / 110)} sentences.`
  : '- Keep it concise: 1 short paragraph (3–4 sentences max). No padding or repetition.'}
- Tone: confident and editorial, like a premium brand magazine — not a sales brochure.
- NEVER start with "Elevate", "Discover", "Introducing", "Transform", or "Unleash".
- Do NOT mention prices.
- Base factual claims only on the supplied product context and user guidance. Do not invent specifications, tests, certifications or performance claims.
${heading !== undefined ? '- Also rewrite the heading if the guidance calls for it, otherwise keep it similar.' : ''}

Return ONLY a valid JSON object:
{
  ${heading !== undefined ? '"heading": "string or null",' : ''}
  "body": "string"
}`

  const models = ['gemini-3.8-flash', 'gemini-2.5-flash']

  for (const model of models) {
    try {
      const genConfig = {
        temperature: 0.75,
        maxOutputTokens: 2048,
        responseSchema: { type: 'OBJECT', properties: {
          ...(heading !== undefined ? { heading: { type: 'STRING', nullable: true } } : {}),
          body: { type: 'STRING' },
        }, required: ['body', ...(heading !== undefined ? ['heading'] : [])] },
        responseMimeType: 'application/json',
      }
      if (model.includes('2.5') || model.includes('3.8')) genConfig.thinkingConfig = { thinkingBudget: 0 }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genConfig }),
        }
      )
      if (!res.ok) continue
      const data = await res.json()
      const parsed = rewriteResult(data, { budget, withHeading: heading !== undefined })
      return json(parsed)
    } catch {}
  }

  return new Response(JSON.stringify({ error: 'The AI could not finish a valid rewrite. Please try again; your current copy has been kept.' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/rewrite-section' }
