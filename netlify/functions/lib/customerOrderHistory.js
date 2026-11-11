import { customerContext, privateJson as json } from './customerAccess.js'
async function sb(SUPABASE_URL, SERVICE_KEY, path, fetcher) {
  const r = await fetcher(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  })
  if (!r.ok) throw Error('ERP unavailable')
  return r.json()
}

// Safe subset — order-level info a customer already sees on their own
// invoice, nothing cost/margin related (that distinction is what keeps this
// endpoint separate from the admin-only /api/erp — see this file's header).
const HEADER_COLS = 'code,date,status,amount,currency,customer_po,ship_date,ref'
const LINE_COLS = 'item_code,description,qty,unit_price,amount'

export function createCustomerOrderHistoryHandler(deps) {
 return async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
  const { customer } = await customerContext(req, deps)
  const { SUPABASE_URL, SERVICE_KEY } = deps
  let body = {}
  try { body = await req.json() } catch { /* no body = default action */ }
  const action = body?.action === 'lines' ? 'lines' : 'history'

  if (action === 'lines') {
    const code = String(body?.code || '').trim()
    if (!code) return json({ error: 'code is required' }, 400)
    if (!customer?.erp_code || customer?.erp_code_shared) return json({ error: 'Not available' }, 403)
    // Re-verify server-side that this invoice actually belongs to the
    // caller's own erp_code before returning anything — a customer passing
    // an arbitrary SI number must not see someone else's invoice just by
    // guessing one. Fetches the full header in the same call the ownership
    // check needs, so the print page (CustomerInvoicePrint.jsx) gets
    // everything in one round trip.
    const header = await sb(SUPABASE_URL, SERVICE_KEY,
      `erp_sales_invoice?select=${HEADER_COLS},customer_code&code=eq.${encodeURIComponent(code)}&limit=1`, deps.fetcher || fetch)
    if (!header?.length || String(header[0].customer_code || '').toUpperCase() !== customer?.erp_code.toUpperCase()) {
      return json({ error: 'Not found' }, 404)
    }
    const lines = await sb(SUPABASE_URL, SERVICE_KEY,
      `erp_sales_invoice_line?select=${LINE_COLS}&invoice_no=eq.${encodeURIComponent(code)}&order=seq.asc`, deps.fetcher || fetch)
    const { customer_code, ...safeHeader } = header[0]
    return json({ header: safeHeader, lines: lines || [] })
  }

  if (!customer?.erp_code) return json({ rows: [] })
  if (customer?.erp_code_shared) return json({ rows: [], shared: true })

  const rows = await sb(SUPABASE_URL, SERVICE_KEY,
    `erp_sales_invoice?select=${HEADER_COLS}&customer_code=eq.${encodeURIComponent(customer?.erp_code)}&order=date.desc&limit=200`, deps.fetcher || fetch)
  return json({ rows: rows || [] })
  } catch (e) { return json({ error: e.status ? e.message : 'Order history could not load. Please try again.' }, e.status || 503) }
 }
}
