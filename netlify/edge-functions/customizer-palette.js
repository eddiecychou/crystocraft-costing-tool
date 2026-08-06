// Proxy from the browser to the Fly.io render service's /palette endpoint.
// Keeps the shared secret (RENDER_TOKEN) server-side — the browser never sees
// it. The customizer fetches this to build its colour pickers from the LIVE
// registry instead of a hard-coded list (which drifted out of sync with the
// photographed swatches and made every render 500 for missing colours).
//
// Env (Netlify site vars, server-side only):
//   RENDER_SERVICE_URL  — e.g. https://crystocraft-customizer-render.fly.dev
//   RENDER_TOKEN        — must match the Fly secret of the same name
export default async function handler() {
  const base = Deno.env.get('RENDER_SERVICE_URL')
  const token = Deno.env.get('RENDER_TOKEN')
  if (!base) {
    return new Response(JSON.stringify({ error: 'RENDER_SERVICE_URL not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/palette`, {
      headers: { ...(token ? { 'X-Render-Token': token } : {}) },
    })
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: `palette proxy failed: ${err.message}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
