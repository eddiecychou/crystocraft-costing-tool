const STORAGE_IMAGE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
])

// Build one same-origin download URL for every image surface. Only known
// Firebase/Google Storage raster images opt into JPEG normalization; arbitrary
// files (PDF/AI/EPS/Office) and WordPress images retain their original bytes.
export function imageDownloadUrl(fileUrl, filename = 'image.jpg', normalizeImage = false) {
  const params = new URLSearchParams({
    url: fileUrl || '',
    filename: filename || 'image.jpg',
  })
  if (normalizeImage) {
    try {
      if (STORAGE_IMAGE_HOSTS.has(new URL(fileUrl).hostname)) {
        const ext = filename.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1]
        if (ext) params.set('normalize', ext === 'jpg' ? 'jpeg' : ext)
      }
    } catch {}
  }
  return `/api/download-image?${params.toString()}`
}
