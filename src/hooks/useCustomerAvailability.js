import { useCallback, useEffect, useState } from 'react'
import { auth } from '../firebase'

async function loadAvailability(productId, token, signal) {
  if (!token) throw new Error('Sign in required')
  const response = await fetch('/api/customer-availability', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({productId}), signal, cache: 'no-store',
  })
  if (!response.ok) throw new Error('Availability unavailable')
  const data = await response.json()
  if (data.productId !== productId || !data.availability) throw new Error('Invalid availability')
  return data.availability
}

export function useEnquiryAvailability(ids) {
  const key = JSON.stringify([...new Set(ids.filter(Boolean))].sort())
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const retry = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    const productIds = JSON.parse(key)
    if (!productIds.length) return
    let alive = true, pending = false, controller
    async function refresh() {
      if (pending) return
      pending = true
      controller = new AbortController()
      setLoading(true)
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const token = await auth.currentUser?.getIdToken()
        const values = await Promise.all(productIds.map(async id =>
          [id, await loadAvailability(id, token, controller.signal).catch(() => null)]))
        if (alive) setResult({key, values: Object.fromEntries(values)})
      } catch { if (alive) setResult({key, values: {}}) }
      finally { clearTimeout(timeout); pending = false; if (alive) setLoading(false) }
    }
    refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 30000)
    window.addEventListener('focus', refresh)
    return () => { alive = false; controller?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [key, revision])
  return { values: result?.key === key ? result.values : {}, loading: key !== '[]' && (result?.key !== key || loading), retry }
}

export default function useCustomerAvailability(productId) {
  const { values, loading, retry } = useEnquiryAvailability([productId])
  return { availability: values[productId] || null, loading, retry }
}
