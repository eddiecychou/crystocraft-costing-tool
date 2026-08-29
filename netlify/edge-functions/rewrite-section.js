import { requireAdmin } from './lib/auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const { section_type, heading, body, guidance, context, max_chars } = await req.json()

  // Optional hard length budget (chars). ProductForm/RangeForm pass this for the
  // marketing_description field, which has a 300-char textarea limit — without
  // it the "3–4 sentences" guidance below routinely overshoots and the client
  // has to chop the result mid-sentence.
  const budget = Number(max_chars) > 0 ? Math.floor(Number(max_chars)) : null

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
${heading !== undefined ? '- Also rewrite the heading if the guidance calls for it, otherwise keep it similar.' : ''}

Return ONLY a valid JSON object:
{
  ${heading !== undefined ? '"heading": "string or null",' : ''}
  "body": "string"
}`

  const models = ['gemini-2.0-flash', 'gemini-2.5-flash']

  for (const model of models) {
    try {
      const genConfig = {
        temperature: 0.75,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      }
      if (model.includes('2.5')) genConfig.thinkingConfig = { thinkingBudget: 0 }

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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (!text) continue

      // When a hard budget was requested, enforce it server-side too: parse
      // the JSON, trim `body` at the last word boundary within the limit, and
      // re-serialise. Same backstop generate-marketing-copy.js applies. If the
      // model didn't return parseable JSON, fall through to the raw text.
      if (budget) {
        try {
          const parsed = JSON.parse(text)
          if (typeof parsed.body === 'string' && parsed.body.length > budget) {
            let b = parsed.body.slice(0, budget).replace(/\s+\S*$/, '').trimEnd()
            if (!/[.!?]$/.test(b)) b += '…'
            parsed.body = b
          }
          return new Response(JSON.stringify(parsed), { headers: { 'Content-Type': 'application/json' } })
        } catch { /* not JSON — return as-is below */ }
      }

      return new Response(text, { headers: { 'Content-Type': 'application/json' } })
    } catch {}
  }

  return new Response(JSON.stringify({ error: 'Rewrite failed — please try again.' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/rewrite-section' }
