import { authHeader } from './firebase'

export async function orderRequestAction(action, details = {}) {
  const response = await fetch('/api/shipping-order-request', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...details }),
    signal: AbortSignal.timeout(55000)
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.error)
    throw Object.assign(
      Error(result?.error || 'Could not confirm the order. Check the saved request.'),
      { code: result?.code }
    )
  return result
}

export function deleteOrder(id, base) {
  return orderRequestAction('delete_unused_draft', { order_id: id, base })
}
