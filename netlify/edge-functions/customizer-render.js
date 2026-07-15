// Proxy from the browser to the Fly.io crystal render service.
// Keeps the shared secret (RENDER_TOKEN) server-side — the browser never sees it.
// Browser POSTs the customizer selections as JSON; we forward to <service>/render
// with the X-Render-Token header and stream the PNG (or JSON error) back.
//
// Env (Netlify site vars, server-side only):
//   RENDER_SERVICE_URL  — e.g. https://crystocraft-customizer-render.fly.dev
//   RENDER_TOKEN        — must match the Fly secret of the same name
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }
  const base = Deno.env.get('RENDER_SERVICE_URL')
  const token = Deno.env.get('RENDER_TOKEN')
  if (!base) {
    return new Response(JSON.stringify({ error: 'RENDER_SERVICE_URL not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const body = await req.text()
    const r = await fetch(`${base.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Render-Token': token } : {}),
      },
      body,
    })
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: `render proxy failed: ${err.message}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
