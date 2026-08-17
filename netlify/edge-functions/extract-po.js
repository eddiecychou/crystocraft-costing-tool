import { requireAdmin } from './lib/auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return new Response('Missing API key', { status: 500 })

  const { image, mimeType } = await req.json()

  const prompt = `You are extracting data from a supplier PURCHASE ORDER (PO) for a giftware/crystal manufacturer (Crystocraft). The buyer is Crystocraft; the document lists what Crystocraft is buying FROM a supplier. The document may be a PDF or scanned image, in Chinese or English.

Return ONLY a valid JSON object with these keys (use null when a value is not present):
{
  "pu_number": string or null,              // the PO / document number (e.g. "PU260014"). Often labelled "Document No", "PO No", "Ref".
  "supplier_name": string or null,          // the SUPPLIER / vendor name (the party being paid), NOT Crystocraft. English if shown.
  "supplier_name_cn": string or null,       // supplier name in Chinese if shown
  "supplier_code": string or null,          // supplier's short code if shown (e.g. "S11", "F17", "Z06")
  "issued_date": string or null,            // ISO date YYYY-MM-DD if determinable
  "est_ship_date": string or null,          // ISO date YYYY-MM-DD if determinable ("Est. Ship Date", "交期")
  "currency": "RMB" | "HKD" | "USD" | "EUR" | null,
  "payment_terms": "net30" | "net60" | "cash" | "deposit" | "prepaid" | null,
  "deposit_pct": number or null,            // deposit percentage if a deposit split is noted (e.g. 40 for "40% deposit")
  "subtotal": number or null,
  "total_amount": number or null,           // final balance / total payable
  "lines": [
    {
      "line_no": number or null,
      "item_code": string or null,          // the component / article code (e.g. "P-PB00200S-01-03", "FM-GLB-01", "MISC"). null if none printed.
      "description": string or null,
      "qty": number or null,
      "unit": string or null,               // pcs, set, m, kg…
      "unit_price": number or null
    }
  ]
}

Rules:
- pu_number: the PO's own document number, exactly as printed (e.g. "PU260014").
- supplier_name: the SUPPLIER being purchased from — usually near the top labelled "Supplier", "供應商", "廠商", or in the top-left address block. Do NOT return "Crystocraft" or the buyer entity.
- supplier_code: a short alphanumeric code next to the supplier (e.g. "S11", "F17"). null if not shown.
- Extract EVERY line item, including uncoded ones. If a line has no printed code use item_code null (the app will treat it as MISC).
- qty and unit_price are numbers only (strip units and currency symbols).
- Currency symbols: ¥ or 元 or RMB or 人民币 = RMB, HK$ or HKD = HKD, $ = USD, € = EUR.
- payment_terms: map "月結30天"/net 30 -> "net30"; "月結60天" -> "net60"; "現金"/cash -> "cash"; any deposit split (e.g. "40% deposit", "訂金") -> "deposit"; prepaid/預付 -> "prepaid". null if unclear.
- deposit_pct: if a deposit percentage is written (e.g. "40% deposit", "4/6 訂金" meaning 40%), return the number (40). null otherwise.
- Do NOT include subtotal / total / balance rows as line items — those belong only in subtotal/total_amount.
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
          generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    )
  }

  try {
    // gemini-2.5-flash with thinkingBudget:0 — full PDF/vision capability (these
    // ERP POs are image-only scans), no thinking overhead, within the 30s edge limit.
    let res = await callGemini('gemini-2.5-flash')
    if (res.status === 429 || res.status === 503) {
      res = await callGemini('gemini-2.5-flash')
    }
    if (!res.ok) res = await callGemini('gemini-1.5-pro-latest')

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

export const config = { path: '/api/extract-po' }
