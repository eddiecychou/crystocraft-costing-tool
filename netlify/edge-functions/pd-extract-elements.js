// Product Design — given a reference image and a template's current prompt
// JSON, return a flat list of candidate field values to click-apply into the
// unlocked parameters (never auto-applied). Ported from
// /api/gemini/extract-elements (V8.16). Gated on product_design.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, fetchImageB64, callGemini, firstText } from './lib/pdGemini.js'

const EXTRACT_PROMPT = (currentJson) => `Here is the CURRENT prompt JSON for an image-generation template:

${JSON.stringify(currentJson, null, 2)}

Here is a NEW reference image. Extract design elements from it that could
usefully update or enrich the JSON above — colors, motifs, style, materials,
composition, lighting, background, etc.

Return ONLY a JSON array (no prose, no markdown fences). Each entry:
{
  "label": short human label, e.g. "Primary color" or "Motif: pine branch",
  "value": the extracted value as a plain string,
  "suggestedPath": your best-guess dot/bracket path into the JSON above where
    this belongs, e.g. "palette.primary" or "motifs[2]" — reuse an existing
    path if the field already exists, otherwise propose a short new one that
    fits the existing structure,
  "kind": one of "color" | "motif" | "style" | "material" | "composition" | "other"
}

If the image contains a logo, wordmark, or any on-object text, do NOT include
its content as a value anywhere. Instead add one entry with "kind": "reserved_area",
"label": "Logo/text area", "value": a short bbox description like
"x:0.3,y:0.1,w:0.2,h:0.1" (fractional, 0-1, origin top-left), and
"suggestedPath": "reserved_areas[]".`

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { imageUrl, currentJson } = payload || {}
  if (!imageUrl || !currentJson) return jsonRes({ error: 'imageUrl and currentJson are both required' }, 400)

  const img = await fetchImageB64(imageUrl)
  if (!img.ok) return jsonRes({ error: `Could not fetch source image (${img.status || 'error'})` }, 502)

  const body = {
    contents: [{ parts: [{ text: EXTRACT_PROMPT(currentJson) }, { inline_data: { mime_type: img.mime, data: img.dataB64 } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini extraction failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let candidates
  try { candidates = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }
  if (!Array.isArray(candidates)) return jsonRes({ error: "Gemini's response wasn't a JSON array" }, 502)
  return jsonRes({ candidates })
}

export const config = { path: '/api/pd-extract-elements' }
