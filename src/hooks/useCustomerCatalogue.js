import { useState, useEffect } from 'react'
import { loadCustomerCatalogue } from '../customerCatalogueApi'

// Authenticated projection replaces raw Firestore listeners. Refresh while open
// and on return to the tab; abandoned responses cannot populate a new identity.
export function useCustomerCatalogue(profile, id) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true, loading = false
    setState({ data: null, error: '', loading: true })
    async function refresh() {
      if (loading || document.hidden) return
      loading = true
      try {
        const data = await loadCustomerCatalogue(id)
        if (alive) setState({ data, error: '', loading: false })
      } catch (err) {
        if (alive) setState({ data: null, error: err.message || 'Catalogue could not load.', loading: false })
      } finally { loading = false }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [profile?.id, profile?.customer_id, profile?.sensitive, id, retry])
  return { ...state, retry: () => setRetry(v => v + 1) }
}
