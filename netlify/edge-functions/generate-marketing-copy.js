export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured — check your .env file' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  console.log('GEMINI_API_KEY present, length:', GEMINI_API_KEY.length)

  const { product, tone = 'professional and premium', instructions = '' } = await req.json()
  if (!product?.name) {
    return new Response(JSON.stringify({ error: 'Product data required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Optionally fetch the hero image so the model can SEE the product. Firebase
  // Storage download URLs are publicly fetchable (they carry an access token).
  // Vision is best-effort: if the fetch fails we silently fall back to text-only.
  let imagePart = null
  if (product.heroImage) {
    try {
      const imgRes = await fetch(product.heroImage)
      if (imgRes.ok) {
        const mime = imgRes.headers.get('content-type') || 'image/jpeg'
        if (mime.startsWith('image/')) {
          const bytes = new Uint8Array(await imgRes.arrayBuffer())
          // Base64-encode in chunks to avoid call-stack limits on large images.
          let binary = ''
          const CHUNK = 0x8000
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
          }
          imagePart = { inline_data: { mime_type: mime, data: btoa(binary) } }
        }
      }
    } catch (e) {
      console.error('Hero image fetch failed, continuing text-only:', e?.message)
    }
  }

  const prompt = `You are a marketing copywriter for Crystocraft, a Hong Kong corporate gift supplier specialising in premium crystal, glassware, and luxury branded merchandise. Our clients are HR, procurement and marketing managers at banks, insurance companies, law firms, hotels, and large corporations.

Write a compelling marketing description for the following product. It will be used in our product catalogue and website.

PRODUCT DETAILS:
Name: ${product.name}
Category: ${product.category || ''}
Spec / Description: ${product.description || ''}
${product.assembly_notes ? `Notes: ${product.assembly_notes}` : ''}
${instructions ? `\nADDITIONAL INSTRUCTIONS FROM THE TEAM (these take priority — follow them closely):\n${instructions}\n` : ''}
ACCURACY RULES (critical — do not break these):
- Base every factual claim (materials, dimensions, capacity, colour names, finish, packaging) ONLY on the PRODUCT DETAILS text above. If a detail is not provided, do NOT state or invent it.
- Never guess or fabricate specifications, measurements, materials, or certifications.
${imagePart ? `- A product image is provided. You MAY describe visual qualities you can clearly see — shape, form, colour, faceting, how light interacts, and where a logo or engraving could sit — but NEVER infer specs, materials, or measurements from the image. Visual description only.` : ''}

REQUIREMENTS:
- Tone: ${tone}
- Length: 2–4 sentences (50–100 words)
- Focus on the emotional appeal, prestige, and gifting occasion — not just specs
- Highlight customisation potential (logo engraving, branding) naturally if relevant
- Do NOT mention prices
- Write in English only
- Output ONLY the marketing copy — no headings, no labels, no extra text
- NEVER start with "Elevate" — vary your openings each time. Other banned openers: "Discover", "Introducing", "Transform", "Unleash"

Marketing description:`

  const promptParts = imagePart ? [{ text: prompt }, imagePart] : [{ text: prompt }]
  const models = ['gemini-2.0-flash', 'gemini-2.5-flash']

  for (const model of models) {
    try {
      const body = {
        contents: [{ parts: promptParts }],
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

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Gemini ${model} error ${res.status}:`, errText)
        continue
      }
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (!text) { console.error(`Gemini ${model} empty response:`, JSON.stringify(data)); continue }

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
