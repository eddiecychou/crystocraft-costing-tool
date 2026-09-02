// Re-serves a Firebase Storage file at a clean, extension-terminated URL with
// the correct Office MIME type, so Microsoft's Office Online viewer
// (view.officeapps.live.com) can fetch and render it.
//
// Why this is needed: a Firebase getDownloadURL() looks like
//   …/o/suppliers%2F<id>%2Fcatalogs%2F123_deck.pptx?alt=media&token=<uuid>
// — the ".pptx" is URL-encoded mid-path, not at the end, and the object is
// often stored as application/octet-stream. The MS viewer keys off the URL's
// trailing extension AND the served Content-Type, so it rejects that URL with
// "File not found / not publicly accessible". Routing through
//   /api/office-file/<name>.pptx?src=<firebase url>
// gives it both. Streams the body through (no buffering) so a large deck
// doesn't hit the edge function's memory ceiling.
//
// Unauthenticated + host-allowlisted, same posture as image-proxy.js — the
// src must be a Firebase Storage URL and nothing else.
const CONTENT_TYPE = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt:  'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  csv:  'text/csv',
  pdf:  'application/pdf',
}

export default async function handler(req) {
  const u = new URL(req.url)
  const src = u.searchParams.get('src')
  if (!src) return new Response('Missing src', { status: 400 })

  let parsed
  try { parsed = new URL(src) } catch { return new Response('Invalid src', { status: 400 }) }
  if (!parsed.hostname.endsWith('firebasestorage.googleapis.com')) {
    return new Response('Forbidden', { status: 403 })
  }

  const name = decodeURIComponent(u.pathname.split('/').pop() || 'file')
  const ext = name.split('.').pop().toLowerCase()

  let upstream
  try { upstream = await fetch(src, { redirect: 'follow' }) } catch (err) {
    return new Response(String(err), { status: 502 })
  }
  if (!upstream.ok) return new Response(`Upstream ${upstream.status}`, { status: 502 })

  // The MS Office Online viewer caps at ~10 MB anyway; refuse bigger so a
  // huge supplier deck can't OOM the edge function buffering it.
  const declared = parseInt(upstream.headers.get('content-length') || '0', 10)
  if (declared > 15 * 1024 * 1024) return new Response('Too large to preview', { status: 413 })

  // Buffer so we can send an explicit Content-Length — the Office Online
  // viewer rejects a chunked / length-less response for an Office file.
  const bytes = await upstream.arrayBuffer()
  const headers = {
    'Content-Type': CONTENT_TYPE[ext] || upstream.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
    'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600',
  }
  return new Response(bytes, { headers })
}

export const config = { path: '/api/office-file/*' }
