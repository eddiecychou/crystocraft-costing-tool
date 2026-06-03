// Proxy for exchangerate-api.com free tier (no API key required)
// Returns CNY, USD, EUR rates relative to HKD
export default async function handler(req, context) {
  try {
    const res = await fetch(
      'https://open.er-api.com/v6/latest/HKD',
      { headers: { 'Accept': 'application/json' } }
    )
    if (!res.ok) throw new Error(`FX API error: ${res.status}`)
    const data = await res.json()

    // Rates are X per 1 HKD, we want HKD per 1 X → invert
    const r = data.rates
    const rates = {
      RMB: r.CNY ? +(1 / r.CNY).toFixed(4) : null,
      USD: r.USD ? +(1 / r.USD).toFixed(4) : null,
      EUR: r.EUR ? +(1 / r.EUR).toFixed(4) : null,
      updatedAt: data.time_last_update_utc || new Date().toUTCString(),
    }

    return new Response(JSON.stringify(rates), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // cache 1 hour
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
