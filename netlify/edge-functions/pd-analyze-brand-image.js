// Product Design — extract a brand's visual identity from a reference image
// (logo/marketing material), as a design-system profile. Ported from
// /api/gemini/analyze-brand-image (V8.16). Gated on product_design.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, fetchImageB64, callGemini, firstText } from './lib/pdGemini.js'

const BRAND_ANALYZE_PROMPT = `Describe this brand's visual identity from the image, as structured JSON. This is for building a design-system profile of the brand, not for literal reproduction.

Return ONLY valid JSON with these fields:
- "summary": a short (2-4 sentence) narrative of the brand — positioning, values, what it's known for, based only on what's visible in the image. Leave empty if the image doesn't give enough to say anything real.
- "color_palette": array of hex color codes for the brand's real, distinct colors (not incidental photo lighting).
- "core_motifs": array of short strings naming distinct visual/iconographic elements this brand actually uses (shapes, icons, recurring imagery) — not colors, not the logo itself.
- "tone": one short descriptive phrase for the brand's overall mood/feel (e.g. "heritage, formal, trustworthy").
- "negative_space_rule": one short phrase describing how much breathing room this brand's materials typically use, if inferable from the image (e.g. "generous, minimalist"); empty string if not inferable.
- "logo_description": a WORDS-ONLY description of the logo/wordmark for record-keeping (shape, colors, layout) — describe it, do not transcribe exact letterforms as if giving drawing instructions. This field is reference-only and is never used to generate an image.

No prose, no markdown fences.`

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
    contents: [{ parts: [{ text: BRAND_ANALYZE_PROMPT }, { inline_data: { mime_type: img.mime, data: img.dataB64 } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini brand analysis failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let extracted
  try { extracted = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }
  return jsonRes({ extracted })
}

export const config = { path: '/api/pd-analyze-brand-image' }
