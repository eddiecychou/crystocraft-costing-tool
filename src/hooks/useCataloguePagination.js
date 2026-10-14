import { useState, useEffect } from 'react'

export const CATALOGUE_PAGE_SIZE = 24

export default function useCataloguePagination(items, storageKey, filterKey, lastIdKey) {
  const [page, setPage] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey))
      if (saved?.filterKey === filterKey && Number.isInteger(saved.count) && saved.count >= CATALOGUE_PAGE_SIZE) return saved
    } catch { /* No saved page. */ }
    return { filterKey, count: CATALOGUE_PAGE_SIZE }
  })
  const lastId = sessionStorage.getItem(lastIdKey)
  const lastIndex = lastId ? items.findIndex(item => item.id === lastId) : -1
  const restoredCount = lastIndex < 0 ? 0 : Math.ceil((lastIndex + 1) / CATALOGUE_PAGE_SIZE) * CATALOGUE_PAGE_SIZE
  const count = Math.max(page.filterKey === filterKey ? page.count : CATALOGUE_PAGE_SIZE, restoredCount)
  useEffect(() => {
    const next = { filterKey, count }
    sessionStorage.setItem(storageKey, JSON.stringify(next))
    if (page.filterKey !== filterKey || page.count !== count) setPage(next)
  }, [filterKey, count, page.filterKey, page.count, storageKey])
  return {
    visible: items.slice(0, count), count,
    loadMore: () => setPage({ filterKey, count: count + CATALOGUE_PAGE_SIZE }),
  }
}
