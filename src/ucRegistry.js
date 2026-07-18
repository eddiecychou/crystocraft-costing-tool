// UC# invoice registry client. Now backed by Supabase (public.uc_registry) via
// the admin-gated /api/uc edge function — one SQL table for the whole registry,
// live + history. (The earlier Firestore version is retired.) UC#s are allocated
// atomically by a Postgres sequence on insert.
import { useEffect, useState } from 'react'
import { auth } from './firebase'

export const UC_SOURCES = ['ERP', 'Alibaba', 'Amazon', 'Online Shop', 'Retail', 'Other']
export const UC_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP', 'RMB', 'CAD', 'AUD', 'JPY', 'MXN']

async function ucApi(op, extra) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch('/api/uc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...extra }),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(data.error || `UC ${op} failed (${res.status})`)
  return data
}

export const createUcInvoice = (data) => ucApi('create', { data }).then((d) => d.row)
export const updateUcInvoice = (id, data) => ucApi('update', { id, data }).then((d) => d.row)
export const listUc = (filters) => ucApi('list', filters).then((d) => d.rows || [])

// Debounced, refetchable list. `filters` = { q, source, status, limit }.
export function useUcList(filters) {
  const { q = '', source = '', status = '', limit = 300 } = filters || {}
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(() => {
      listUc({ q, source, status, limit })
        .then((r) => { if (alive) setRows(r) })
        .catch((e) => { if (alive) { setError(e.message); setRows([]) } })
        .finally(() => { if (alive) setLoading(false) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, source, status, limit, nonce])
  return { rows, loading, error, refresh: () => setNonce((n) => n + 1) }
}
