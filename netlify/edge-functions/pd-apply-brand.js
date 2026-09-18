// Product Design — produce a NEW prompt JSON that keeps a product's physical
// facts but swaps its graphic surface for a customer's brand identity. Logos /
// on-object text are NEVER emitted as drawable content, only as blank
// reserved_areas for manual compositing. Ported from /api/gemini/apply-brand
// (V8.16). Gated on product_design.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, callGemini, firstText } from './lib/pdGemini.js'

function buildPrompt(baseJson, brandJson) {
  return `You are preparing a Gemini image-generation prompt JSON for a physical product mockup. You're given BASE_JSON (a structured analysis of a real product's existing design) and BRAND_JSON (a target customer's own visual identity).

BASE_JSON:
${JSON.stringify(baseJson, null, 2)}

BRAND_JSON:
${JSON.stringify(brandJson, null, 2)}

Produce a NEW JSON in the same shape as BASE_JSON, with these rules:

1. Any field describing physical construction, material, shape, or dimensions must be copied byte-for-byte unchanged from BASE_JSON. Never alter what is physically true about the product.

2. Fields describing the graphic design surface (theme, illustrated motifs, style, color palette) should be substituted with real equivalent elements from BRAND_JSON — match the SAME NUMBER of distinct illustrated elements BASE_JSON had, not fewer. Where BRAND_JSON has no obvious equivalent for one of BASE_JSON's elements, make a deliberate, sensible substitution and don't invent a generic placeholder.

3. ABSOLUTE RULE — no logo, wordmark, or literal on-object text may appear anywhere in your output's descriptive content, even to describe or forbid it. If BASE_JSON's own "text_and_logo_elements" array (or any similar field) names a text/logo slot, DO NOT copy that content — real or the brand's — into anything that will be rendered. Instead, output a top-level "reserved_areas" array: one entry per such slot, each shaped as { "label": "<what belongs here, e.g. 'customer name plaque'>", "bbox": { "x":0-1, "y":0-1, "width":0-1, "height":0-1 }, "note": "Leave visually blank/plain, consistent with the surrounding material color and texture — applied manually afterward, not by this generation." }. Carry the bbox over from BASE_JSON's own text_and_logo_elements if it had one; estimate reasonably from the composition if not.

4. Do not add a "text_and_logo_elements" field to your output — "reserved_areas" replaces it entirely.

Return ONLY valid JSON. No prose, no markdown fences.`
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { baseJson, brandJson } = payload || {}
  if (!baseJson || !brandJson) return jsonRes({ error: 'baseJson and brandJson are both required' }, 400)

  const body = {
    contents: [{ parts: [{ text: buildPrompt(baseJson, brandJson) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini apply-brand call failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let resultJson
  try { resultJson = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }
  return jsonRes({ resultJson })
}

export const config = { path: '/api/pd-apply-brand' }
