// Product Design — find near-duplicate entries in a motif/color list and
// propose groups to consolidate (owner accepts/rejects each). Ported from
// /api/gemini/merge-elements (V8.16). Gated on product_design.
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, callGemini, firstText } from './lib/pdGemini.js'

function buildPrompt(itemType, items) {
  const list = items.map((it, i) => `${i}: ${it}`).join('\n')
  if (itemType === 'colors') {
    return `Here is a numbered list of hex color codes for a brand's palette:

${list}

Some may be near-duplicate shades of what is really the same color, restated slightly differently (e.g. two very close navy blues that would read as the same swatch). A genuinely distinct color — even a similar hue at a clearly different lightness or saturation — must NOT be merged.

Group entries that are close enough to be the same real color. For each such group, pick the single clearest hex code to keep (prefer whichever looks most like a "clean" round value). Only include groups with 2+ entries. Return ONLY valid JSON, no prose, no markdown fences, in this shape:
{ "groups": [ { "keep": "#RRGGBB", "merge_indices": [0, 3] } ] }
"merge_indices" lists ALL indices in the group (including the one being kept), from the numbered list above.`
  }
  return `Here is a numbered list of visual motif descriptions for a brand:

${list}

Some entries likely describe the SAME real visual element in different words (e.g. "Shield/Crest" and "school crest" probably both refer to the same shield logo). Group entries that describe the same real element together. Only group entries you're genuinely confident refer to the same thing — when in doubt, leave them separate.

For each group, pick the single clearest, most complete label to keep. Only include groups with 2+ entries. Return ONLY valid JSON, no prose, no markdown fences, in this shape:
{ "groups": [ { "keep": "clearest label", "merge_indices": [0, 5, 9] } ] }
"merge_indices" lists ALL indices in the group (including the one being kept), from the numbered list above.`
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { items, itemType } = payload || {}
  if (!items || items.length < 2 || (itemType !== 'motifs' && itemType !== 'colors')) {
    return jsonRes({ error: "items (2+) and itemType ('motifs' or 'colors') are required" }, 400)
  }

  const body = {
    contents: [{ parts: [{ text: buildPrompt(itemType, items) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini merge call failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let parsed
  try { parsed = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }

  // Validate indices are real and non-overlapping before handing this back —
  // a bad index would silently corrupt the list on accept otherwise.
  const seen = new Set()
  const groups = (parsed.groups || []).filter((g) => {
    if (!g.keep || !Array.isArray(g.merge_indices) || g.merge_indices.length < 2) return false
    for (const i of g.merge_indices) {
      if (i < 0 || i >= items.length || seen.has(i)) return false
    }
    g.merge_indices.forEach((i) => seen.add(i))
    return true
  })
  return jsonRes({ groups })
}

export const config = { path: '/api/pd-merge-elements' }
