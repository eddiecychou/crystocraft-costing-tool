import { requireAdmin } from './lib/auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const { section_type, heading, body, guidance, context } = await req.json()

  const prompt = `You are an expert SEO content writer for Crystocraft, a premium Hong Kong corporate gift manufacturer.

The user has reviewed the following blog section and wants it rewritten based on their guidance.

Section type: ${section_type || 'content'}
${heading ? `Current heading: ${heading}` : ''}
Current body:
${body}

${context ? `Product / post context:\n${context}\n` : ''}
User's guidance / feedback:
${guidance}

Rewrite rules:
- Apply the user's guidance faithfully — that is the priority.
- Keep it concise: 1 short paragraph (3–4 sentences max). No padding or repetition.
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
      return new Response(text, { headers: { 'Content-Type': 'application/json' } })
    } catch {}
  }

  return new Response(JSON.stringify({ error: 'Rewrite failed — please try again.' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/rewrite-section' }
