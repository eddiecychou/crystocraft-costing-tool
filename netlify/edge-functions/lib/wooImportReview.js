// Only an existence check. Invoice/UC identifiers and other fields stay on the server.
export async function findWooImportReview(orderId, wc) {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) throw new Error('Missing ledger configuration')
  const signal = AbortSignal.timeout(8000)

  async function hasMatch(table, filters) {
    const url = new URL(`${base.replace(/\/$/, '')}/rest/v1/${table}`)
    url.search = new URLSearchParams({ select: 'id', limit: '1', ...filters })
    const response = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal,
      redirect: 'error',
    })
    if (!response.ok) throw new Error('Ledger lookup failed')
    const rows = await response.json()
    if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && !Number.isInteger(rows[0]?.id))) {
      throw new Error('Invalid ledger response')
    }
    return rows.length === 1
  }

  if (await hasMatch('app_sales_invoice', { order_id: `eq.woo-${orderId}` })) return 'invoice'

  const response = await wc(`orders/${orderId}`, { _fields: 'id,number' }, { signal, redirect: 'error' })
  if (!response.ok) throw new Error('Woo order lookup failed')
  const order = await response.json()
  if (!(typeof order?.id === 'string' || Number.isSafeInteger(order?.id)) || String(order.id) !== orderId) {
    throw new Error('Woo order identity could not be verified')
  }
  const number = order.number
  if (!(typeof number === 'string' || Number.isSafeInteger(number))) throw new Error('Missing Woo order number')
  const reference = String(number)
  const plain = reference.replace(/^#/, '')
  if (!plain.trim() || plain.startsWith('#') || reference !== reference.trim() || /[\u0000-\u001f\u007f]/u.test(reference)) {
    throw new Error('Invalid Woo order number')
  }

  // PostgREST's quoted in() elements keep punctuation in a display number literal.
  const exact = (...values) => `in.(${values.map(value => JSON.stringify(value)).join(',')})`
  if (await hasMatch('app_sales_invoice', { channel: 'eq.woocommerce', external_order_no: exact(reference) })) {
    return 'invoice'
  }
  if (await hasMatch('uc_registry', { source: 'eq.Online Shop', order_no: exact(plain, `#${plain}`) })) return 'uc'
  return null
}
