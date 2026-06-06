export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { product, tone = 'professional and premium' } = await req.json()
  if (!product?.name) {
    return new Response(JSON.stringify({ error: 'Product data required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const prompt = `You are a marketing copywriter for Crystocraft, a Hong Kong corporate gift supplier specialising in premium crystal, glassware, and luxury branded merchandise. Our clients are HR, procurement and marketing managers at banks, insurance companies, law firms, hotels, and large corporations.

Write a compelling marketing description for the following product. It will be used in our product catalogue and website.

PRODUCT DETAILS:
Name: ${product.name}
Category: ${product.category || ''}
Spec / Description: ${product.description || ''}
${product.assembly_notes ? `Notes: ${product.assembly_notes}` : ''}

REQUIREMENTS:
- Tone: ${tone}
- Length: 2–4 sentences (50–100 words)
- Focus on the emotional appeal, prestige, and gifting occasion — not just specs
- Highlight customisation potential (logo engraving, branding) naturally if relevant
- Do NOT mention prices
- Write in English only
- Output ONLY the marketing copy — no headings, no labels, no extra text

Marketing description:`

  const models = ['gemini-2.0-flash', 'gemini-2.5-flash']

  for (const model of models) {
    try {
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.75, maxOutputTokens: 1024 },
      }
      // Disable thinking for 2.5-flash — thinking tokens eat into output budget
      if (model === 'gemini-2.5-flash') {
        body.generationConfig.thinkingConfig = { thinkingBudget: 0 }
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      if (!res.ok) continue
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (!text) continue

      return new Response(JSON.stringify({ marketing_description: text }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {}
  }

  return new Response(JSON.stringify({ error: 'Failed to generate copy — please try again.' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/generate-marketing-copy' }
