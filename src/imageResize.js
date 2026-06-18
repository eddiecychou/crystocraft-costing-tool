// Shared client-side image downscaler. Phone photos are often 4000px+ and
// several MB each; serving those raw makes the storefront crawl. We shrink to a
// max edge and JPEG-compress under a size budget before uploading to Storage.
//
// Returns { blob, orientation, type }. On any failure (unsupported format,
// missing OffscreenCanvas, etc.) it falls back to the original file so uploads
// never break — callers can upload `blob` with `contentType: type`.

export function detectOrientation(width, height) {
  const ratio = width / height
  if (ratio >= 0.85 && ratio <= 1.18) return 'square'
  return ratio > 1 ? 'landscape' : 'portrait'
}

export async function resizeToJpeg(file, { maxPx = 1800, maxBytes = 600 * 1024 } = {}) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      throw new Error('Canvas image APIs unavailable')
    }
    const bitmap = await createImageBitmap(file)
    const orientation = detectOrientation(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    for (const q of [0.90, 0.82, 0.72, 0.60, 0.48]) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q })
      if (blob.size <= maxBytes) return { blob, orientation, type: 'image/jpeg' }
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.38 })
    return { blob, orientation, type: 'image/jpeg' }
  } catch {
    // Fall back to the original file so an upload never fails on a quirky format.
    return { blob: file, orientation: 'square', type: file.type || 'application/octet-stream' }
  }
}
