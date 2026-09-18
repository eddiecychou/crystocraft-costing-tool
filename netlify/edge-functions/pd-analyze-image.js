// Product Design — text+vision analysis of a product photo into structured
// JSON (physical facts / graphic surface / text+logo bboxes). Ported from the
// standalone app's /api/gemini/analyze-image (V8.16). Gated on the
// product_design module; holds GEMINI_API_KEY server-side.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, fetchImageB64, callGemini, firstText } from './lib/pdGemini.js'

const ANALYZE_PROMPT = `Describe this product photo in detailed, structured JSON. Reverse-engineer its real design — do not guess or embellish.

Split the JSON into:
1. Physical/construction facts — product type, materials, shape, construction (joints, layering), dimensions_and_form. These describe what is REALLY true about the object and must be precise, not creative.
2. The graphic design surface — theme, illustrated style, individual illustrated motifs (list each distinct element), color palette as hex codes, composition/density (roughly what % of the frame is filled with illustration).
3. Any on-object TEXT or LOGO — if the design includes a name, wordmark, plaque, or printed text anywhere, describe what it says AND estimate its position as a fractional bounding box (bbox: {x, y, width, height}, 0-1 range, origin top-left, x/y = top-left corner). Put this under a top-level "text_and_logo_elements" array, one entry per element, each with "content" (what it says/shows) and "bbox". If there is none, return an empty array.

Return ONLY valid JSON. No prose, no markdown fences.`

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { imageUrl } = payload || {}
  if (!imageUrl) return jsonRes({ error: 'imageUrl is required' }, 400)

  const img = await fetchImageB64(imageUrl)
  if (!img.ok) return jsonRes({ error: `Could not fetch source image (${img.status || 'error'})` }, 502)

  const body = {
    contents: [{ parts: [{ text: ANALYZE_PROMPT }, { inline_data: { mime_type: img.mime, data: img.dataB64 } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini analysis failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let analysisJson
  try { analysisJson = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }
  return jsonRes({ analysisJson })
}

export const config = { path: '/api/pd-analyze-image' }
