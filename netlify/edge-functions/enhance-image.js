// Product-image enhancement via Gemini's image model (nano-banana).
// Takes a product image (URL or base64) and a mode, returns an edited image:
//   mode 'clean'   — place on a clean solid-white studio background, keep the
//                    product pixel-faithful (no colour/shape changes).
//   mode 'enhance' — clean white bg + soft even studio lighting and richer,
//                    truer plating (gold/chrome) and crystal-stone colour.
// Image-in / image-out. Reuses GEMINI_API_KEY. Returns { image, mimeType } where
// image is base64. Faithfulness is enforced by the prompt; the caller always
// shows a before/after and only replaces on explicit Keep.

// gemini-2.5-flash-image (the original "nano-banana") is scheduled to shut
// down 2026-10-02 (checked ai.google.dev/gemini-api/docs/deprecations,
// 2026-08-23). Keeping it primary for now — it's what every existing prompt
// here has actually been tuned against — but falling back automatically to
// gemini-3.1-flash-image (the stable GA successor; NOT the "-preview"
// variant, which has its own 2026-06-25 shutdown) on any failure. Once 2.5
// actually goes away this starts serving every request from the fallback
// with no further deploy needed. Same request/response contract on both —
// this is the "flash image" family's shared interface, not model-specific.
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image']

function bytesToBase64(bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Plating and crystal recolor — targeted change, everything else preserved.
const RECOLOR_PROMPT = instructions =>
  `You are editing a product photo of a Crystocraft crystal giftware item. ` +
  `Apply ONLY the following colour change(s) to the product — do not alter anything else:\n\n` +
  `${instructions}\n\n` +
  `CRITICAL — keep ALL of the following IDENTICAL:\n` +
  `- Background (colour, style, and any shadows exactly as-is)\n` +
  `- Product shape, proportions, and silhouette\n` +
  `- All surface facets, engravings, and fine details\n` +
  `- Lighting direction and intensity\n` +
  `- Every colour NOT explicitly mentioned in the change instructions above\n` +
  `Output only the edited image.`

const COLOR_RULES =
  `COLOR PRESERVATION (absolute — never violate these): ` +
  `Every coloured part of the product must keep its exact original hue in the output. ` +
  `Red areas must stay red, not become white or pink. ` +
  `Blue areas must stay blue, not become clear or white. ` +
  `Gold/chrome plating must keep its metallic colour. ` +
  `Crystal stones must keep their tint (clear, amber, rose, green, etc). ` +
  `If any area of the product is the same colour as white, leave it white — but do NOT whiten areas that are coloured in the original. ` +
  `When the product contains transparent or translucent areas, preserve those as transparent/translucent — do not fill them white.`

const PROMPTS = {
  clean:
    `Edit this product photo of a Crystocraft crystal giftware / corporate gift item. ` +
    `Replace ONLY the background with a clean, pure solid WHITE studio background (#FFFFFF), evenly lit, no shadows behind the object, no props, no reflections of the old scene. ` +
    `CRITICAL: keep the product itself PIXEL-IDENTICAL — do not change its shape, proportions, facets, engraving, or any colours. ` +
    `${COLOR_RULES} ` +
    `Preserve a soft natural contact shadow under the object. Output only the edited image.`,
  enhance:
    `Edit this product photo of a Crystocraft crystal giftware / corporate gift item for a premium wholesale catalogue. ` +
    `Place it on a clean pure solid WHITE studio background (#FFFFFF) with soft, even, professional product lighting and a subtle natural contact shadow. ` +
    `Gently enhance clarity and make the metal plating (gold or chrome) and the crystal stones read richer and truer to a polished studio shot — improve lighting and sparkle only. ` +
    `CRITICAL: stay faithful to the REAL product — keep the exact shape, proportions, facets, engraving, and all colours. ` +
    `${COLOR_RULES} ` +
    `Do NOT invent, add, remove, or restyle any detail. Output only the edited image.`,
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500)

  let payload
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { imageUrl, image, mimeType, mode = 'clean', colorHint = '', recolorInstructions = '' } = payload || {}

  // Resolve the source image to base64 (accept a Storage URL or inline base64).
  let dataB64 = image
  let mime = mimeType || 'image/jpeg'
  if (!dataB64 && imageUrl) {
    try {
      const r = await fetch(imageUrl)
      if (!r.ok) return json({ error: `Could not fetch source image (${r.status})` }, 502)
      mime = r.headers.get('content-type') || mime
      dataB64 = bytesToBase64(new Uint8Array(await r.arrayBuffer()))
    } catch (e) {
      return json({ error: 'Source image fetch failed: ' + (e?.message || 'unknown') }, 502)
    }
  }
  if (!dataB64) return json({ error: 'No image provided (imageUrl or image required)' }, 400)

  let prompt
  if (mode === 'recolor' && recolorInstructions.trim()) {
    prompt = RECOLOR_PROMPT(recolorInstructions.trim())
  } else {
    const colorHintBlock = colorHint.trim()
      ? `\nUSER-PROVIDED COLOUR DESCRIPTION (trust this — it describes the real product):\n"${colorHint.trim()}"\nUse this to confirm which colours belong to the product and must be preserved exactly.\n`
      : ''
    prompt = (PROMPTS[mode] || PROMPTS.clean) + colorHintBlock
  }
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dataB64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'], temperature: 0.2 },
  }

  let lastError = null
  for (let i = 0; i < IMAGE_MODELS.length; i++) {
    const model = IMAGE_MODELS[i]
    const isLastModel = i === IMAGE_MODELS.length - 1

    let res
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      )
    } catch (e) {
      lastError = 'Gemini request failed: ' + (e?.message || 'unknown')
      console.error(`Gemini ${model} request failed:`, e)
      if (isLastModel) return json({ error: lastError }, 502)
      continue
    }

    if (!res.ok) {
      const errText = await res.text()
      console.error(`Gemini ${model} error ${res.status}:`, errText)
      // 404 / model-not-found → this model isn't available on this key —
      // exactly the retirement case, so fall through to the next one rather
      // than failing outright.
      if (!isLastModel) { lastError = errText; continue }
      const hint = res.status === 404 || /not found|not supported|image/i.test(errText)
        ? 'The image model may not be enabled on this API key.'
        : ''
      return json({ error: `Gemini image generation failed (${res.status}). ${hint}`.trim(), detail: errText.slice(0, 500) }, 502)
    }

    const data = await res.json()
    const parts = data.candidates?.[0]?.content?.parts || []
    const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data)
    const inline = imgPart?.inline_data || imgPart?.inlineData
    if (!inline?.data) {
      console.error(`Gemini ${model} returned no image part:`, JSON.stringify(data).slice(0, 800))
      if (!isLastModel) { lastError = 'No image part returned'; continue }
      return json({ error: 'No image returned by the model — try again or use the other mode.' }, 502)
    }

    if (model !== IMAGE_MODELS[0]) console.log(`enhance-image: served by fallback model ${model} after ${IMAGE_MODELS[0]} failed`)
    return json({ image: inline.data, mimeType: inline.mime_type || inline.mimeType || 'image/png' })
  }

  // Unreachable (the loop always returns), but keeps this defensive.
  return json({ error: lastError || 'Gemini image generation failed.' }, 502)
}

export const config = { path: '/api/enhance-image' }
