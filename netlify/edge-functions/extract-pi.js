export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const { image, mimeType } = await req.json()

  const prompt = `You are extracting data from a Proforma Invoice (PI) or commercial invoice for a giftware/crystal manufacturer. The document may be a PDF or scanned image, in Chinese or English.

Return ONLY a valid JSON object with these keys (use null when a value is not present):
{
  "pi_no": string or null,
  "customer_name": string or null,
  "order_date": string or null,            // ISO date YYYY-MM-DD if determinable
  "currency": "USD" | "EUR" | "RMB" | "HKD" | null,
  "incoterm": "EXW" | "FOB" | "CIF" | "DAP" | "DDP" | null,
  "lines": [
    {
      "line_no": number or null,
      "item_code": string or null,         // the product/article/item code or SKU
      "description": string or null,
      "qty_ordered": number or null,
      "unit": string or null,              // pcs, set, pair, box…
      "unit_price": number or null
    }
  ]
}

Rules:
- Extract EVERY line item, including charges/fees (tooling, sample, freight, setup) — keep them as lines; do not silently drop them.
- item_code is the supplier/article code (e.g. "D0002-230-C", "U0226", "P-PB007"). If a line has no code (e.g. a pure charge), use null.
- qty_ordered is the ordered quantity as a number only (strip units).
- unit_price is the per-unit price as a number only (strip currency symbols).
- Currency symbols: $ = USD, € = EUR, ¥ or 元 or RMB = RMB, HK$ = HKD.
- Incoterm is often near the totals or shipping terms.
- Return ONLY the JSON object, no commentary.`

  async function callGemini(model) {
    return fetch(
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
  }

  try {
    let res = await callGemini('gemini-2.5-flash')
    if (res.status === 429 || res.status === 503) {
      await new Promise(r => setTimeout(r, 3000))
      res = await callGemini('gemini-2.5-flash')
    }
    if (!res.ok) res = await callGemini('gemini-2.5-pro')

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed.lines)) parsed.lines = []

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ lines: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/extract-pi' }
