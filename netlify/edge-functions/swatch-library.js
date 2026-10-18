// V8.19 protected Firebase images. Storage rules authorize every request.
// This is not an Admin SDK bypass; no Fly credentials or download-token URLs.
import { createSwatchImageHandler } from './lib/swatchImage.js'
export default req => createSwatchImageHandler({
  bucket:Deno.env.get('VITE_FIREBASE_STORAGE_BUCKET'), fetcher:fetch,
})(req)
