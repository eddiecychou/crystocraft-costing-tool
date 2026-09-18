// Product Design — apply one owner-described change to an existing prompt
// JSON, restoring any locked field the model drifted. Ported from
// /api/gemini/tweak-json (V8.16). Gated on product_design. The path helpers
// mirror src/lib/jsonPaths.ts (inlined — edge functions can't import browser
// code).
import { requireModule } from './lib/auth.js'
import { PD_MODEL, jsonRes, callGemini, firstText } from './lib/pdGemini.js'

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function parsePath(path) {
  const parts = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let m
  while ((m = re.exec(path))) parts.push(m[2] !== undefined ? Number(m[2]) : m[1])
  return parts
}
function getPath(obj, path) {
  const parts = parsePath(path)
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}
function cloneToParent(obj, parts) {
  const root = Array.isArray(obj) ? [...obj] : { ...obj }
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    let next = cur[key]
    if (next == null) next = typeof parts[i + 1] === 'number' ? [] : {}
    const cloned = Array.isArray(next) ? [...next] : isPlainObject(next) ? { ...next } : next
    cur[key] = cloned
    cur = cloned
  }
  return { root, parent: cur }
}
function setPath(obj, path, newValue) {
  const parts = parsePath(path)
  const { root, parent } = cloneToParent(obj, parts)
  parent[parts[parts.length - 1]] = newValue
  return root
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const TWEAK_PROMPT = (currentJson, instruction, lockedPaths) => `Here is a Gemini image-generation prompt JSON:

${JSON.stringify(currentJson, null, 2)}

Apply this specific change: "${instruction}"

Rules:
1. Apply ONLY what the instruction asks. Every other field must come back byte-for-byte identical to the input — do not "improve" or rephrase anything else.
${lockedPaths.length > 0 ? `2. These fields are LOCKED by the owner and must come back with their exact original value, even if the instruction seems to imply changing them: ${lockedPaths.join(', ')}. If the instruction conflicts with a locked field, apply everything else it implies and leave the locked field untouched.\n` : ''}3. If a "reserved_areas" array is present, keep it (adjust its bbox only if the instruction is specifically about logo/text placement) — never fill it with literal logo or text content, even if the instruction seems to ask for that. If the instruction asks to add real on-object text or a logo as drawable content, apply everything else the instruction implies but leave that specific part alone, and don't explain why in the JSON itself.
4. If the instruction is ambiguous about which field it means, make the most reasonable interpretation given the existing structure rather than asking a question you can't ask.

Return ONLY the complete resulting JSON. No prose, no markdown fences.`

export default async function handler(req) {
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405)
  const auth = await requireModule(req, 'product_design')
  if (!auth.ok) return auth.response

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return jsonRes({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return jsonRes({ error: 'Invalid JSON body' }, 400) }
  const { currentJson, instruction, lockedPaths = [] } = payload || {}
  if (!currentJson || !instruction?.trim()) return jsonRes({ error: 'currentJson and instruction are both required' }, 400)

  const body = {
    contents: [{ parts: [{ text: TWEAK_PROMPT(currentJson, instruction, lockedPaths) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  const r = await callGemini(PD_MODEL, body, GEMINI_API_KEY)
  if (!r.ok) {
    if (r.netError) return jsonRes({ error: 'Gemini request failed: ' + r.netError }, 502)
    return jsonRes({ error: `Gemini tweak call failed (${r.status})`, detail: (r.errText || '').slice(0, 500) }, 502)
  }
  const text = firstText(r.data)
  if (!text) return jsonRes({ error: 'Gemini returned no text part' }, 502)
  let resultJson
  try { resultJson = JSON.parse(text) } catch { return jsonRes({ error: "Gemini's response wasn't valid JSON", detail: text.slice(0, 500) }, 502) }

  // Belt-and-suspenders: restore any locked field the model drifted rather
  // than rejecting the whole tweak.
  let restoredCount = 0
  for (const path of lockedPaths) {
    const before = getPath(currentJson, path)
    const after = getPath(resultJson, path)
    if (!deepEqual(before, after)) {
      resultJson = setPath(resultJson, path, before)
      restoredCount++
    }
  }
  return jsonRes({ resultJson, restoredCount })
}

export const config = { path: '/api/pd-tweak-json' }
