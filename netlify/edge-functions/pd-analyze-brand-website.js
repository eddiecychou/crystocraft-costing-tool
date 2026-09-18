// Product Design — extract a brand's visual identity by reading its own
// website, via Gemini's URL Context tool (server-side page fetch). Ported from
// /api/gemini/analyze-brand-website (V8.16). Gated on product_design.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, callGemini, firstText } from './lib/pdGemini.js'

const WEBSITE_ANALYZE_PROMPT = (url) => `Read this brand's own website: ${url}

Describe the brand's visual identity and positioning as structured JSON, for building a design-system profile — not for literal reproduction.

Return ONLY valid JSON with these fields:
- "summary": a short (2-4 sentence) narrative of the brand — positioning, values, what it's known for. Based on what's actually on the site, not generic filler.
- "color_palette": array of hex color codes for the brand's real, distinct colors as used on the site (not incidental photo lighting).
- "core_motifs": array of short strings naming distinct visual/iconographic elements this brand actually uses (shapes, icons, recurring imagery) — not colors, not the logo itself.
- "tone": one short descriptive phrase for the brand's overall mood/feel.
- "negative_space_rule": one short phrase describing how much breathing room this brand's materials typically use, if inferable; empty string if not.
- "logo_description": a WORDS-ONLY description of the logo/wordmark for record-keeping (shape, colors, layout) — describe it, do not transcribe exact letterforms as if giving drawing instructions. Reference-only, never used to generate an image.

No prose, no markdown fences.`

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { url } = payload || {}
  if (!url) return jsonRes({ error: 'url is required' }, 400)

  const body = {
    contents: [{ parts: [{ text: WEBSITE_ANALYZE_PROMPT(url) }] }],
    tools: [{ url_context: {} }],
    // Gemini rejects tools + responseMimeType:"application/json" together
    // ("Tool use with a response mime type... is unsupported") — rely on the
    // prompt's own "no markdown fences" and parse defensively below.
    generationConfig: { temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini website analysis failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }

  // If the tool couldn't actually retrieve the page, surface it instead of
  // letting the model paper over it with a plausible-sounding guess.
  const metadata = r.data?.candidates?.[0]?.url_context_metadata?.url_metadata
  if (Array.isArray(metadata) && metadata.length > 0) {
    const failed = metadata.filter(
      (m) => m.url_retrieval_status && m.url_retrieval_status !== 'URL_RETRIEVAL_STATUS_SUCCESS',
    )
    if (failed.length === metadata.length) {
      return jsonRes({ error: 'Gemini could not retrieve that page (blocked, JS-heavy, or unreachable) — try a different URL or use an image instead.' }, 502)
    }
  }

  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  let extracted
  try { extracted = JSON.parse(cleaned) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }
  return jsonRes({ extracted })
}

export const config = { path: '/api/pd-analyze-brand-website' }
