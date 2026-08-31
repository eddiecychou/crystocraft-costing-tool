import { requireFrontOffice } from './lib/auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireFrontOffice(req)
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const { image, mimeType } = await req.json()

  const prompt = `You are extracting supplier quote data from an image (may be a WeChat/WhatsApp screenshot, PDF, or email). The text may be in Chinese or English.

Extract the following fields and return ONLY a valid JSON object with these keys (use null if not found):
{
  "supplier_name": string or null,
  "unit_cost": number or null,
  "unit_cost_currency": "RMB" | "HKD" | "USD" | "EUR" | null,
  "moq": number or null,
  "tooling_sample_cost": number or null,
  "tooling_sample_cost_currency": "RMB" | "HKD" | "USD" | "EUR" | null,
  "sampling_lead_time_days": number or null,
  "production_lead_time_days": number or null
}

Rules:
- unit_cost is the per-piece/per-unit price
- moq is minimum order quantity in pieces
- tooling_sample_cost is one-time mould/tooling/sample fee
- For lead times: convert weeks to days (1 week = 7 days)
- Currency symbols: ¥ or 元 or RMB = RMB, $ = USD, HK$ = HKD, € = EUR
- Return ONLY the JSON object, no other text`

  async function callGemini(model) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: image } },
            ],
          }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      }
    )
    return res
  }

  try {
    let res = await callGemini('gemini-2.5-flash')

    if (res.status === 429 || res.status === 503) {
      await new Promise(r => setTimeout(r, 3000))
      res = await callGemini('gemini-2.5-flash')
    }

    if (!res.ok) {
      res = await callGemini('gemini-2.5-pro')
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const parsed = JSON.parse(text)

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/process-quote' }
