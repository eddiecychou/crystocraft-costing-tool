export default async function handler(req) {
  const params = new URL(req.url).searchParams
  const url = params.get('url')
  const filename = params.get('filename') || 'image.jpg'

  if (!url) return new Response('Missing url param', { status: 400 })

  const res = await fetch(url)
  if (!res.ok) return new Response('Failed to fetch image', { status: 502 })

  const blob = await res.arrayBuffer()

  return new Response(blob, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

export const config = { path: '/api/download-image' }
