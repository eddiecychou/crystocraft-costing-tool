// Fetch one or more crystocraft.com pages server-side and return the list of
// full-size product images found on them. Done in an edge function so the admin
// browser sidesteps cross-origin restrictions when reading the blog pages.
//
// POST { urls: string[] }  ->  { images: [{ url, filename, alt }], errors: [...] }
// Only crystocraft.com URLs are allowed.

const ALLOWED_HOST = 'crystocraft.com'

function isAllowed(u) {
  try {
    const h = new URL(u).hostname
    return h === ALLOWED_HOST || h.endsWith('.' + ALLOWED_HOST)
  } catch { return false }
}

// Strip a WordPress "-WIDTHxHEIGHT" size suffix so we keep the original file.
function toFullSize(url) {
  return url.replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, '$1$2')
}

function extractImages(html) {
  const out = new Map() // url -> alt (deduped by full-size url)
  const imgRe = /<img\b[^>]*>/gi
  let m
  while ((m = imgRe.exec(html))) {
    const tag = m[0]
    const srcM = tag.match(/\bsrc=["']([^"']+)["']/i)
    if (!srcM) continue
    const raw = srcM[1]
    if (!/wp-content\/uploads\/.+\.(?:jpg|jpeg|png|webp)/i.test(raw)) continue
    const full = toFullSize(raw)
    // Skip obvious non-product assets (logos, icons).
    if (/logo|icon|placeholder|spinner/i.test(full)) continue
    const altM = tag.match(/\balt=["']([^"']*)["']/i)
    if (!out.has(full)) out.set(full, altM ? altM[1] : '')
  }
  return out
}

import { requireAdmin } from './_auth.js'

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const urls = Array.isArray(body?.urls) ? body.urls : []
  if (!urls.length) return json({ error: 'No urls provided' }, 400)

  const merged = new Map()
  const errors = []
  for (const u of urls) {
    if (!isAllowed(u)) { errors.push({ url: u, error: 'Host not allowed' }); continue }
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 CrystocraftImporter' } })
      if (!res.ok) { errors.push({ url: u, error: 'HTTP ' + res.status }); continue }
      const html = await res.text()
      for (const [url, alt] of extractImages(html)) {
        if (!merged.has(url)) merged.set(url, alt)
      }
    } catch (err) {
      errors.push({ url: u, error: String(err?.message || err) })
    }
  }

  const images = [...merged.entries()].map(([url, alt]) => ({
    url,
    filename: url.split('/').pop().replace(/\.[a-z]+$/i, ''),
    alt,
  }))
  return json({ images, errors })
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export const config = { path: '/api/scrape-images' }
