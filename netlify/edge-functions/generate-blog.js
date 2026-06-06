export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const body = await req.json()
  const { type, product, products, industry, tone } = body

  const audienceContext = `
Target audiences:
- Procurement and HR managers at large corporations
- Marketing and brand teams at premium companies
- Event planners organising corporate events and award ceremonies
- Luxury and premium brands seeking bespoke gifts
- Banks, insurance firms, and financial institutions (e.g. Sun Life type clients)

Crystocraft context:
- Hong Kong-based manufacturer with 30+ years of crystal craftsmanship heritage
- Corporate gift division started 2017, specialising in unique high-end customised gifts
- Known for custom designs like the smooth-spin drinkware, crystal awards, bespoke branded gifts
- Serves international corporations across different countries
- Focus: unique, premium gifts that go beyond generic promotional merchandise
- No prices shown — clients enquire directly for custom quotes
`

  let prompt

  if (type === 'spotlight') {
    prompt = `You are an expert SEO content writer for Crystocraft, a premium Hong Kong corporate gift manufacturer.

${audienceContext}

Write a compelling blog post for the following product. The post should feel authoritative and premium — not salesy. Think high-end brand magazine meets practical buyer's guide.

Product details:
- Name: ${product.name}
- Category: ${product.category}
- Description: ${product.description || ''}
- Marketing copy: ${product.marketing_description || ''}
- Status: ${product.status}
${industry ? `- Primary target industry: ${industry}` : ''}

Return ONLY a valid JSON object with this structure:
{
  "seo_title": "string (max 65 chars, include product name + target keyword)",
  "meta_description": "string (max 155 chars, compelling summary for Google snippet)",
  "slug": "string (URL-friendly slug e.g. smooth-spin-crystal-drinkware-corporate-gift)",
  "hero_alt_text": "string (descriptive alt text for the hero image for SEO)",
  "sections": [
    {
      "type": "intro",
      "heading": null,
      "body": "string (2-3 paragraphs, hooks the reader, establishes the problem this gift solves)"
    },
    {
      "type": "product_story",
      "heading": "string",
      "body": "string (the craft behind it, what makes it unique, materials/process)"
    },
    {
      "type": "use_cases",
      "heading": "string",
      "body": "string (which industries, occasions, and recipient types this suits best — specific examples)"
    },
    {
      "type": "customisation",
      "heading": "string",
      "body": "string (how Crystocraft customises this for each brand — logo, colours, packaging etc)"
    },
    {
      "type": "cta",
      "heading": "string",
      "body": "string (soft CTA — invite enquiry, no pressure, emphasise bespoke service)"
    }
  ],
  "tags": ["array", "of", "5-8", "relevant", "tags"],
  "focus_keyword": "string (primary SEO keyword this post targets)"
}`

  } else if (type === 'roundup') {
    const productList = products.map((p, i) =>
      `${i + 1}. ${p.name} (${p.category}) — ${p.description || p.marketing_description || 'Premium corporate gift'}`
    ).join('\n')

    prompt = `You are an expert SEO content writer for Crystocraft, a premium Hong Kong corporate gift manufacturer.

${audienceContext}

Write a listicle-style blog post featuring multiple products. The post should feel like a curated guide from a trusted industry source.

${industry ? `Theme / target industry: ${industry}` : 'Theme: Premium corporate gifts'}
Tone: ${tone || 'professional and premium'}

Products to feature:
${productList}

Return ONLY a valid JSON object with this structure:
{
  "seo_title": "string (max 65 chars, include number + target keyword e.g. '5 Unique Corporate Gifts for...')",
  "meta_description": "string (max 155 chars)",
  "slug": "string (URL-friendly slug)",
  "intro": {
    "heading": null,
    "body": "string (2 paragraphs — why premium corporate gifts matter for this industry/occasion)"
  },
  "items": [
    {
      "product_name": "string (exact product name from the list)",
      "heading": "string (catchy item heading e.g. '1. The Gift That Keeps Spinning')",
      "body": "string (2-3 paragraphs — why this product, who it suits, how to customise it)",
      "image_caption": "string (caption for the product image)"
    }
  ],
  "conclusion": {
    "heading": "string",
    "body": "string (wrap-up + soft CTA to enquire)"
  },
  "tags": ["array", "of", "5-8", "relevant", "tags"],
  "focus_keyword": "string (primary SEO keyword)"
}`
  }

  async function callGemini(model) {
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
        }),
      }
    )
  }

  try {
    let res = await callGemini('gemini-2.5-flash')
    if (!res.ok) res = await callGemini('gemini-2.5-pro')

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const parsed = JSON.parse(text)

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/generate-blog' }
