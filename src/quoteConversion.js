import { authHeader } from './firebase'

// An interrupted response has unknown completion. Status/Resume recovers the
// same persisted request; never mint a new identity on timeout.
export async function quoteConversionAction(quoteId, action = 'status', details = {}) {
  const response = await fetch('/api/quote-order-conversion', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote_id: quoteId, action, ...details }),
    signal: AbortSignal.timeout(55000)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || data.error)
    throw Error(
      data?.error ||
        'Conversion confirmation is unavailable. Check the saved request before creating another order.'
    )
  return data
}
