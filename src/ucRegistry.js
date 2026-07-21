// UC# invoice registry client. Now backed by Supabase (public.uc_registry) via
// the admin-gated /api/uc edge function — one SQL table for the whole registry,
// live + history. (The earlier Firestore version is retired.) UC#s are allocated
// atomically by a Postgres sequence on insert.
import { useEffect, useState } from 'react'
import { authedUser } from './firebase'

// The sales CHANNEL, and only that. Two values were removed on 2026-07-21:
//
// 'ERP' (2,901 rows) was a system's name doing a channel's job, and it never
// meant "the invoice is in JES" — Online Shop (422), Alibaba (152) and Amazon
// (103) invoices are all in JES too. Owner: these are bulk B2B orders, so
// 'Wholesale'. Where an invoice actually lives is now the derived
// `invoice_location` on uc_registry_dated, which is a fact rather than a typed
// field.
//
// 'App' was never a channel either — allocateOrderUc wrote it, so it recorded
// which system minted the UC, not how the sale came in. Nobody ever chose it
// from this list.
export const UC_SOURCES = ['Wholesale', 'Alibaba', 'Amazon', 'Online Shop', 'Retail', 'Other']

// Legacy values still in the table, mapped for display so the rename can be
// applied to the data at any time without the dropdown going blank in between.
const UC_SOURCE_ALIASES = { ERP: 'Wholesale', App: '' }
export const ucSource = (v) => (v in UC_SOURCE_ALIASES ? UC_SOURCE_ALIASES[v] : (v || ''))
export const UC_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP', 'RMB', 'CAD', 'AUD', 'JPY', 'MXN']

async function ucApi(op, extra) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/uc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(' — ') || `UC ${op} failed (${res.status})`)
  return data
}

export const createUcInvoice = (data) => ucApi('create', { data }).then((d) => d.row)
export const updateUcInvoice = (id, data) => ucApi('update', { id, data }).then((d) => d.row)
export const listUc = (filters) => ucApi('list', filters).then((d) => d.rows || [])

// Allocate a FRESH UC# for an app-originated order (used by "Duplicate order").
// Deliberately never copies the source order's UC — a carried-over UC is the
// exact, repeatable slip CuiLing's JES workflow produces (duplicate an order to
// reuse the customer details, then forget to change the UC before the product
// codes). See PROJECT-PLAN.md, "CuiLing's sales walkthrough", 2026-07-20.
// uc_no is allocated server-side by a Postgres sequence; year is derived here
// from today's date, matching the registry's own "/YY" convention.
export async function allocateOrderUc({ customer_name, currency } = {}) {
  const year = '/' + String(new Date().getFullYear() % 100).padStart(2, '0')
  // No `source`: it is the sales channel, and allocating a number tells us
  // nothing about how the sale came in. It gets chosen when the invoice is
  // filled in. (Previously wrote 'App', which asserted a channel that does not
  // exist — see UC_SOURCES.)
  const row = await createUcInvoice({
    year, customer: customer_name || '', currency: currency || 'HKD', status: 'open',
  })
  return { id: row.id, uc_no: row.uc_no, year: row.year, full: `${row.uc_no}${row.year}` }
}

// Debounced, refetchable list. `filters` = { q, source, status, confirmed,
// from, to, limit }. `confirmed` is true/false to filter, or undefined for
// "any"; `from`/`to` are yyyy-mm-dd and filter on effective_date, INCLUSIVE.
//
// The date range is applied server-side on purpose — see the edge function.
export function useUcList(filters) {
  const {
    q = '', source = '', status = '', confirmed, from = '', to = '',
    sort = 'id', dir = 'desc', limit = 300,
  } = filters || {}
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(() => {
      listUc({ q, source, status, confirmed, from, to, sort, dir, limit })
        .then((r) => { if (alive) setRows(r) })
        .catch((e) => { if (alive) { setError(e.message); setRows([]) } })
        .finally(() => { if (alive) setLoading(false) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, source, status, confirmed, from, to, sort, dir, limit, nonce])
  return { rows, loading, error, refresh: () => setNonce((n) => n + 1) }
}
