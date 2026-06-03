export default async function handler(req) {
  const url = new URL(req.url).searchParams.get('url')
  if (!url) return new Response('Missing url param', { status: 400 })

  const res = await fetch(url)
  const blob = await res.blob()

  return new Response(blob, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export const config = { path: '/api/download-image' }
