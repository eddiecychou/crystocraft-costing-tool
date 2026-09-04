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

// Bump whenever PROMPTS / FRAMING / EXCLUDE / COLOR_RULES text changes below.
// Returned alongside the edited image so the caller can save it onto the
// image record — the DeepSeek Artgen engine keeps the same idea in
// art.meta.json (STYLE_VERSION + exact prompt), which is what lets it tell a
// stale review apart from a current one. This retoucher had no equivalent:
// nothing recorded which prompt/model produced a given edit, so there was no
// way to tell later whether an approved "Keep" still matches what these
// prompts do today. Not a provenance system as complete as art.meta.json —
// just enough to answer "was this edited before or after the last prompt
// change" if that question ever matters.
const PROMPT_VERSION = 'v1-2026-09-04'

function bytesToBase64(bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Pixel dimensions from PNG or JPEG header bytes — no Image API in Deno edge.
// Used only to detect the model silently reframing/cropping the product.
function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50) { // PNG — IHDR width/height at 16..24
    return {
      w: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19],
      h: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23],
    }
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) { // JPEG — first SOF marker
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xFF) { o++; continue }
      const marker = bytes[o + 1]
      const len = (bytes[o + 2] << 8) | bytes[o + 3]
      const isSOF = marker >= 0xC0 && marker <= 0xCF &&
        marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
      if (isSOF) return { h: (bytes[o + 5] << 8) | bytes[o + 6], w: (bytes[o + 7] << 8) | bytes[o + 8] }
      o += 2 + len
    }
  }
  return null
}

// Anchors shared by every mode (DETERMINISTIC-ART-GEN §2): stop the image
// model doing what image models do — silently re-zoom, re-crop, rotate, or
// re-centre the subject while it edits the background.
const FRAMING =
  `FRAMING (do not violate): keep the product fully within the frame with even margin on all sides — ` +
  `do not crop, zoom, pan, rotate, re-centre, or change the camera angle. ` +
  `The output must have the SAME pixel dimensions and aspect ratio as the input image.`

// Consolidated negative constraints (DETERMINISTIC-ART-GEN §3).
const EXCLUDE =
  `MUST NOT: add props, text, watermarks, logos, borders, or a second copy of the product; ` +
  `add a gradient, vignette, glow, or coloured cast to the background; ` +
  `add reflections of the old scene; restyle, "beautify", or reinterpret any part of the product.`

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
  `${FRAMING} ${EXCLUDE}\n` +
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

// Two rules to keep in mind when editing any prompt below (learned the hard
// way on a sibling image pipeline — MARKETING-WORKFLOW.md §4a/§6.1a):
// - Don't name example objects in style text. Naming a concrete example
//   ("a red body", "a blue crystal detail") to illustrate a RULE is fine —
//   COLOR_RULES does this on purpose, listing actual product colour classes.
//   The failure mode is naming something NOT already part of the product
//   (an unrelated prop, a background object) just to illustrate a point —
//   an image model tends to take that literally and add the thing.
// - Don't let a prompt invite text. EXCLUDE already forbids text/watermarks/
//   logos outright; keep it that way rather than describing a scene element
//   (a sign, a label, a price tag) that would pull invented text into shot.
const PROMPTS = {
  clean:
    `Edit this product photo of a Crystocraft crystal giftware / corporate gift item. ` +
    `Replace ONLY the background with a clean, pure solid WHITE studio background (#FFFFFF), evenly lit, no shadows behind the object. ` +
    `CRITICAL: keep the product itself PIXEL-IDENTICAL — do not change its shape, proportions, facets, engraving, or any colours. ` +
    `${COLOR_RULES} ` +
    `${FRAMING} ${EXCLUDE} ` +
    `Preserve a soft natural contact shadow under the object. Output only the edited image.`,
  enhance:
    `Edit this product photo of a Crystocraft crystal giftware / corporate gift item for a premium wholesale catalogue. ` +
    `Place it on a clean pure solid WHITE studio background (#FFFFFF) with soft, even, professional product lighting and a subtle natural contact shadow. ` +
    `Gently enhance clarity and make the metal plating (gold or chrome) and the crystal stones read richer and truer to a polished studio shot — improve lighting and sparkle only. ` +
    `CRITICAL: stay faithful to the REAL product — keep the exact shape, proportions, facets, engraving, and all colours. ` +
    `${COLOR_RULES} ` +
    `${FRAMING} ${EXCLUDE} ` +
    `Output only the edited image.`,
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
  // 'clean' and 'recolor' are meant to be pixel-faithful → fully deterministic.
  // 'enhance' is allowed a little latitude for lighting/sparkle.
  const temperature = mode === 'enhance' ? 0.2 : 0
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dataB64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'], temperature },
  }
  const srcSize = imageSize(base64ToBytes(dataB64))

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

    // Reframe guard (DETERMINISTIC-ART-GEN §4 "missing-element audit"): a
    // changed aspect ratio is the strongest signal the model cropped/zoomed
    // the product despite the FRAMING anchor. Non-fatal — the caller shows a
    // before/after and the human decides — but flag it so the UI can warn.
    const outSize = imageSize(base64ToBytes(inline.data))
    let reframed = false
    if (srcSize?.w && outSize?.w) {
      const arSrc = srcSize.w / srcSize.h
      const arOut = outSize.w / outSize.h
      reframed = Math.abs(arSrc - arOut) / arSrc > 0.02
      if (reframed) console.warn(`enhance-image: model reframed ${srcSize.w}x${srcSize.h} -> ${outSize.w}x${outSize.h} (mode ${mode})`)
    }
    return json({
      image: inline.data, mimeType: inline.mime_type || inline.mimeType || 'image/png',
      reframed, model, promptVersion: PROMPT_VERSION,
    })
  }

  // Unreachable (the loop always returns), but keeps this defensive.
  return json({ error: lastError || 'Gemini image generation failed.' }, 502)
}

export const config = { path: '/api/enhance-image' }
