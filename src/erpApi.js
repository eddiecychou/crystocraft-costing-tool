// Client for the ERP archive (read-only, in Supabase) via the /api/erp edge
// function. The browser never talks to Supabase directly — it sends the signed-in
// user's Firebase token and the edge function does the query server-side.
import { auth } from './firebase'

// `filters` holds entity-specific equality filters (stock → { warehouse,
// item_type }); `nonZeroOnly` hides stock lines that have netted to zero.
export async function erpLookup(
  entity,
  { q = '', limit = 25, activeOnly = false, filters = {}, nonZeroOnly = false } = {},
) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()

  const res = await fetch('/api/erp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity, q, limit, activeOnly, filters, nonZeroOnly }),
  })

  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `Lookup failed (${res.status})`)
  return data.rows || []
}

// Multi-level BOM explosion for one item code. Returns tree rows:
// { level, parent_code, component_code, component_type, qty, ext_qty, is_assembly, path }
export async function erpBom(code) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()

  const res = await fetch('/api/erp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity: 'bom', code }),
  })

  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `BOM lookup failed (${res.status})`)
  return data.rows || []
}

// Components that CURRENT BOMs use, ranked as likely replacements for a
// superseded code. Suggestions, not answers — the caller shows them to a human.
export async function erpCodeAlternatives(code) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()
  const res = await fetch('/api/erp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity: 'alternatives', code }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `Lookup failed (${res.status})`)
  return data.rows || []
}

// For each code: does it exist in the ERP item master, and how many CURRENT
// BOMs use it? Existence alone is a weak test — FM-K(32).03-C exists and is
// used by ZERO BOMs, while every BOM uses FM-K(32)-C (526). Returns
// { found:Set, usage:{code->bomCount} }. One request per 400 codes.
export async function erpCodesExist(codes) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()

  const all = [...new Set((codes || []).map(c => String(c ?? '').trim()).filter(Boolean))]
  const found = new Set()
  const usage = {}   // code -> how many CURRENT BOMs use it
  for (let i = 0; i < all.length; i += 400) {
    const res = await fetch('/api/erp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entity: 'codes', codes: all.slice(i, i + 400) }),
    })
    let data = {}
    try { data = await res.json() } catch { /* non-JSON error body */ }
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `Code check failed (${res.status})`)
    for (const c of data.found || []) found.add(c)
    Object.assign(usage, data.usage || {})
  }
  return { found, usage }
}

// Detail for one header. `of` is 'sales_invoice' or 'sales_order'; `code` is the
// invoice/order number. Returns { rows, surcharges } (surcharges = freight etc.).
export async function erpLines(of, code) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in to look up ERP data.')
  const token = await user.getIdToken()

  const res = await fetch('/api/erp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity: 'lines', of, code }),
  })

  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `Line lookup failed (${res.status})`)
  return { rows: data.rows || [], surcharges: data.surcharges || [] }
}
