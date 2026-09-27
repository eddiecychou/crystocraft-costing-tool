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
      // Added for the WooCommerce Sync "By item" report's turnover-in-HKD
      // conversion (owner, 2026-08-22) — orders come in GBP, which nothing
      // else in the app previously needed a live rate for.
      GBP: r.GBP ? +(1 / r.GBP).toFixed(4) : null,
      // The rest of CUSTOMER_CURRENCIES (src/currency.js). A customer account
      // can be set to any of these, but settings/exchange_rates only ever held
      // RMB/USD/EUR, so their prices silently came out unconverted — see
      // LESSONS-LEARNED L-35. fromHKD() now returns null rather than a wrong
      // number, so without these a GBP/AUD/CAD/SGD account sees no prices at
      // all; these are what make it show the right ones.
      AUD: r.AUD ? +(1 / r.AUD).toFixed(4) : null,
      CAD: r.CAD ? +(1 / r.CAD).toFixed(4) : null,
      SGD: r.SGD ? +(1 / r.SGD).toFixed(4) : null,
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
