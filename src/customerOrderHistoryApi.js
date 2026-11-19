import { authedUser } from './firebase'

async function call(body) {
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/customer-order-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw Error(
      res.status === 404 || res.status === 403
        ? 'Original unavailable.'
        : 'Invoice history could not load. Please try again.',
    )
  return res.json()
}

export const myOrderHistory = () => call({ action: 'history' })
export const myOcInvoiceHistory = () => call({ action: 'oc-history' })
export const myInvoiceDetail = (code) => call({ action: 'lines', code })
export const myOcInvoiceDetail = (id, code) => call({ action: 'oc-detail', id, code })
