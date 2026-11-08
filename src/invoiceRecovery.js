import { authHeader } from './firebase'

// A timeout means unknown completion, never permission to issue a new request.
export async function invoiceAction(orderId, action = 'status', details = {}) {
  const response = await fetch('/api/invoice-allocation', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, action, ...details }),
    signal: AbortSignal.timeout(55000)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || data.error)
    throw Error(
      data?.error ||
        'Invoice confirmation is unavailable. Reopen this saved order and resume the same request.'
    )
  return data
}
