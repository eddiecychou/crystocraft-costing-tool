import { authedUser } from './firebase'

async function call(body, signal) {
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/customer-order-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok)
    throw Error(
      res.status === 404 || res.status === 403
        ? 'Original unavailable.'
        : 'Invoice history could not load. Please try again.',
    )
  return res.json()
}

async function history(action, numberField, signal) {
  const result = await call({ action }, signal)
  if (!Array.isArray(result?.rows) || !result.rows.every(row =>
    typeof row?.[numberField] === 'string' && row[numberField].trim())) {
    throw Error('Invoice history could not load. Please try again.')
  }
  return result
}

export const myOrderHistory = signal => history('history', 'code', signal)
export const myOcInvoiceHistory = signal => history('oc-history', 'no', signal)
export const myInvoiceDetail = (code) => call({ action: 'lines', code })
export const myOcInvoiceDetail = (id, code) => call({ action: 'oc-detail', id, code })
