import { useEffect, useState } from 'react'
import { catalogueFilterValue } from '../catalogueFilter'

// Match the rendered control and predicate immediately, then repair its saved value.
// Callers mark dynamic options ready only after a successful catalogue snapshot.
export default function useCatalogueFilter(key, options, ready, fallback = '') {
  const [saved, setSaved] = useState(() => sessionStorage.getItem(key) || fallback)
  const value = catalogueFilterValue(saved, options, ready, fallback)
  useEffect(() => {
    if (!ready || saved === value) return
    sessionStorage.setItem(key, value)
    setSaved(value)
  }, [key, ready, saved, value])
  return [value, setSaved]
}
