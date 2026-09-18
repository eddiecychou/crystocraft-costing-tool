// Shared helpers for the Product Design (pd-*) Gemini edge functions, ported
// from the standalone Next.js app (V8.16). Deno runtime — no Node Buffer, so
// base64 is done by hand (same approach as enhance-image.js). Lives in lib/
// so Netlify's bundler doesn't try to route it as a function of its own.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// All pd-* text/vision analysis runs on the same model the source app used.
export const PD_MODEL = 'gemini-3.8-flash'

export function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function bytesToBase64(bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Fetch a Storage image URL to base64. Returns { ok, mime, dataB64 } or
// { ok:false, status } — the caller turns a non-ok into a 502.
export async function fetchImageB64(imageUrl) {
  const r = await fetch(imageUrl)
  if (!r.ok) return { ok: false, status: r.status }
  const mime = r.headers.get('content-type') || 'image/jpeg'
  const dataB64 = bytesToBase64(new Uint8Array(await r.arrayBuffer()))
  return { ok: true, mime, dataB64 }
}

// One generateContent call. Returns { ok:true, data } or
// { ok:false, netError } / { ok:false, status, errText }.
export async function callGemini(model, body, apiKey) {
  let res
  try {
    res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { ok: false, netError: e?.message || 'unknown' }
  }
  if (!res.ok) {
    const errText = await res.text()
    return { ok: false, status: res.status, errText }
  }
  return { ok: true, data: await res.json() }
}

export function firstText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null
}
