import { useState, useEffect, useCallback, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { RANGE_DESIGN_TYPES, RANGE_PRODUCT_TYPES, designNumber, brandLetter, bodyLetter } from '../constants'
import { CheckSquare, Square } from 'lucide-react'
import LoadingBar from './LoadingBar'

export default function BulkCategoryEditor() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDesign, setFilterDesign] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkDesignType, setBulkDesignType] = useState('')
  const [bulkProductType, setBulkProductType] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'range_products'), orderBy('design_code'))
    return onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const items = useMemo(() => products.map(p => {
    const fallbackBrand = brandLetter(p.design_code) || 'D'
    const designNo = p.design_no || designNumber(p.design_code)
    const body = p.body_code || bodyLetter(p.design_code)
    return {
      id: p.id,
      code: `${fallbackBrand}${body}${designNo}`,
      name: p.description || p.design_name || designNo,
      design_type: p.design_type || p.category || '',
      product_type: p.product_type || '',
    }
  }), [products])

  const existingDesignTypes = useMemo(() => [...new Set(items.map(i => i.design_type).filter(Boolean))].sort(), [items])
  const existingProductTypes = useMemo(() => [...new Set(items.map(i => i.product_type).filter(Boolean))].sort(), [items])
  const allDesignTypes = useMemo(() => [...new Set([...RANGE_DESIGN_TYPES, ...existingDesignTypes])].sort(), [existingDesignTypes])
  const allProductTypes = useMemo(() => [...new Set([...RANGE_PRODUCT_TYPES, ...existingProductTypes])].sort(), [existingProductTypes])

  const filtered = useMemo(() => items.filter(item => {
    const q = search.toLowerCase()
    const matchSearch = !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    const matchDesign = !filterDesign || item.design_type === filterDesign
    const matchProduct = !filterProduct || item.product_type === filterProduct
    return matchSearch && matchDesign && matchProduct
  }), [items, search, filterDesign, filterProduct])

  const allIds = filtered.map(i => i.id)
  const allChecked = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someChecked = allIds.some(id => selected.has(id))
  const nSelected = allIds.filter(id => selected.has(id)).length

  const toggleOne = useCallback(id => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const all = allIds.every(id => prev.has(id))
      const n = new Set(prev)
      all ? allIds.forEach(id => n.delete(id)) : allIds.forEach(id => n.add(id))
      return n
    })
  }, [allIds])

  async function apply() {
    if (!nSelected || (!bulkDesignType && !bulkProductType)) return
    setSaving(true)
    try {
      const ids = [...selected].filter(id => allIds.includes(id))
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db)
        ids.slice(i, i + 400).forEach(id => {
          const patch = { updatedAt: serverTimestamp() }
          if (bulkDesignType) patch.design_type = bulkDesignType
          if (bulkProductType) patch.product_type = bulkProductType
          batch.update(doc(db, 'range_products', id), patch)
        })
        await batch.commit()
      }
      setSelected(new Set())
      setBulkDesignType('')
      setBulkProductType('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingBar />

  const canApply = nSelected > 0 && (bulkDesignType || bulkProductType)

  return (
    <div>
      <p className="text-sm text-ink-60 mb-4">
        Filter to a subset, select rows, then apply a Design Type and/or Product Type to all selected at once.
      </p>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="Search name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input sm:w-48" value={filterDesign} onChange={e => setFilterDesign(e.target.value)}>
          <option value="">All design types</option>
          {allDesignTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input sm:w-48" value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
          <option value="">All product types</option>
          {allProductTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Sticky action bar */}
      <div className="sticky top-0 z-20 bg-white border border-ivory-dark rounded-lg px-4 py-3 mb-4 flex flex-wrap items-center gap-3 shadow-sm">
        <span className="text-sm font-medium text-ink-80 min-w-[90px]">
          {nSelected > 0 ? `${nSelected} selected` : `${filtered.length} rows`}
        </span>
        <div className="flex gap-2 flex-1 flex-wrap">
          <select className="input py-1.5 text-sm flex-1 min-w-[160px]" value={bulkDesignType} onChange={e => setBulkDesignType(e.target.value)}>
            <option value="">— Set design type —</option>
            {allDesignTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input py-1.5 text-sm flex-1 min-w-[160px]" value={bulkProductType} onChange={e => setBulkProductType(e.target.value)}>
            <option value="">— Set product type —</option>
            {allProductTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={apply} disabled={!canApply || saving} className="btn-primary text-sm py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : `Apply to ${nSelected}`}
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ivory-dark bg-ivory text-left text-xs font-medium text-ink-60 uppercase tracking-wide">
              <th className="px-3 py-2.5 w-8">
                <button onClick={toggleAll} className="text-ink-60 hover:text-ink">
                  {allChecked ? <CheckSquare size={16} /> : someChecked ? <CheckSquare size={16} className="opacity-50" /> : <Square size={16} />}
                </button>
              </th>
              <th className="px-3 py-2.5">Code</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5 hidden md:table-cell">Design Type</th>
              <th className="px-3 py-2.5 hidden md:table-cell">Product Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ivory-dark">
            {filtered.map(s => {
              const checked = selected.has(s.id)
              return (
                <tr key={s.id} onClick={() => toggleOne(s.id)}
                    className={`cursor-pointer transition-colors ${checked ? 'bg-brand-50' : 'hover:bg-ivory'}`}>
                  <td className="px-3 py-2.5">
                    <span className={checked ? 'text-brand-600' : 'text-ink-40'}>
                      {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-70 whitespace-nowrap">{s.code}</td>
                  <td className="px-3 py-2.5 text-ink">{s.name}</td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    {s.design_type ? <span className="badge bg-indigo-50 text-indigo-700">{s.design_type}</span> : <span className="text-ink-40 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    {s.product_type ? <span className="badge bg-sky-50 text-sky-700">{s.product_type}</span> : <span className="text-ink-40 text-xs">—</span>}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-ink-40 text-sm">No products match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
