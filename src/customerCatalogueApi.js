import { authedUser } from './firebase'

// Coalesce concurrent mounts only; no persistent cache across users or requests.
const pending = new Map()
export async function loadCustomerCatalogue(id) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const key = `${user.uid}:${id || ''}`
  if (pending.has(key)) return pending.get(key)
  const request = (async () => {
    const token = await user.getIdToken()
    const res = await fetch('/api/customer-catalogue' + (id ? `?id=${encodeURIComponent(id)}` : ''), {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Catalogue could not load.')
    return data
  })()
  pending.set(key, request)
  try { return await request } finally { if (pending.get(key) === request) pending.delete(key) }
}
export async function loadCustomerProduct(id) {
  return (await loadCustomerCatalogue(id)).products[0] || null
}
export async function loadCustomerBrandedImages(customerId) {
  const { products } = await loadCustomerCatalogue()
  return products.flatMap(p => p.images.filter(im => im.branded_for_customer_id === customerId)
    .map(im => ({ ...im, product_id: p.id, product_name: p.name })))
}
