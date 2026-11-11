export const validRequestId = (id) =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  )

export function requestUrl(owner, id, params = new URLSearchParams()) {
  const query = new URLSearchParams(params)
  query.set('operator', owner)
  query.set('request', id)
  return '/shipments/new?' + query.toString()
}

export function piObjectPath(owner, id, sha256) {
  return `shipping_pi_originals/${owner}/${id}/${sha256}`
}

// Duplicate copies commercial details and lines, with its own fresh references.
export function copyOrderHeader(source) {
  const { customer_id, customer_name, currency, incoterm, destination, notes } =
    source
  return { customer_id, customer_name, currency, incoterm, destination, notes }
}

export const needsInitialInvoice = (state) =>
  state === 'due' || state === 'pending' || state === 'followups_pending'
