import { urlToResizedBase64 } from './imageResize'

// Single shared client for the AI image enhance/background endpoint, used by
// BOTH the corp-gift ImageGallery and the figurine RangeForm so the two can't
// drift apart again.
//
// - Downscales the source and sends it INLINE (base64), so the edge function
//   skips fetching the Storage URL itself — that server-side fetch eats the
//   ~30s edge budget and is a common cause of timeouts, even on small images.
// - Parses defensively: on a platform timeout Netlify returns a plain-text
//   error, not our JSON, which res.json() would blow up on with a cryptic
//   "Unexpected token" error. We surface a clear message instead.
// - Retries once on a timeout (the image model is intermittently slow).
//
// Returns { image, mimeType } (image is base64) or throws an Error.
export async function enhanceProductImage(sourceUrl, { mode = 'clean', colorHint = '', recolorInstructions = '' } = {}) {
  let body = { imageUrl: sourceUrl, mode, colorHint, recolorInstructions }
  try {
    const { base64, mimeType } = await urlToResizedBase64(sourceUrl, 1536, 0.9)
    body = { image: base64, mimeType, mode, colorHint, recolorInstructions }
  } catch { /* odd format / CORS — fall back to letting the server fetch the URL */ }

  const call = async () => {
    const res = await fetch('/api/enhance-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    let data = {}
    try { data = raw ? JSON.parse(raw) : {} }
    catch {
      const timedOut = /time( |d )?out|edge function/i.test(raw)
      const e = new Error(timedOut
        ? 'The AI image server timed out — try again (the model is occasionally slow).'
        : `Image service error: ${raw.slice(0, 120)}`)
      e.timedOut = timedOut
      throw e
    }
    if (!res.ok || !data.image) throw new Error(data.error || 'Enhancement failed')
    return data
  }

  try { return await call() }
  catch (e) { if (e.timedOut) return await call(); throw e }   // one retry on timeout
}
