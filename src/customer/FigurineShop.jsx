import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Gem } from 'lucide-react'
import { designNumber, brandLetter, bodyLetter } from '../constants'
import { useRates, fromUSD, fmtMoney } from '../currency'
import LoadingBar from '../components/LoadingBar'

function docVariants(p) {
  if (Array.isArray(p.variants) && p.variants.length) return p.variants
  return (p.finishes || []).map(f => ({
    plating_name: f.finish_name, sku: f.sku,
    ws_price_usd: f.ws_price_usd, stock_finished: f.stock_finished, image: f.image,
  }))
}

export default function FigurineShop({ profile }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'
  const disc = Math.max(0, Math.min(100, Number(profile?.ws_discount_pct) || 0)) / 100

  useEffect(() => {
    const q = query(collection(db, 'range_products'), orderBy('design_code'))
    return onSnapshot(q, snap => {
      // Only show active/published designs to customers.
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.active !== false))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const net = usd => usd == null ? null : fromUSD(usd * (1 - disc), cur, rates)

  const items = useMemo(() => products.map(p => {
    const designNo = p.design_no || designNumber(p.design_code)
    const body = p.body_code || bodyLetter(p.design_code)
    const variants = docVariants(p)
    const fallbackBrand = brandLetter(p.design_code) || 'D'
    const brands = [...new Set(variants.map(v => v.brand_code || fallbackBrand).filter(Boolean))]
    const prices = variants.map(v => v.ws_price_usd).filter(x => x != null)
    const image = variants.find(v => v.image)?.image || (Array.isArray(p.gallery) && p.gallery[0]) || ''
    const code = [`${brands.length === 1 ? brands[0] : ''}${body}${designNo}`, p.format_code].filter(Boolean).join('-')
    return {
      id: p.id, code,
      name: p.description || p.design_name || code,
      design_type: p.design_type || p.category || '',
      size: p.size, image,
      platings: [...new Set(variants.map(v => v.plating_name).filter(Boolean))],
      minNet: prices.length ? net(Math.min(...prices)) : null,
      maxNet: prices.length ? net(Math.max(...prices)) : null,
    }
  }), [products, rates, cur, disc])

  const categories = useMemo(() => [...new Set(items.map(s => s.design_type).filter(Boolean))].sort(), [items])
  const filtered = useMemo(() => items.filter(s => {
    const q = search.toLowerCase()
    const ms = !q || s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q)
    return ms && (!cat || s.design_type === cat)
  }), [items, search, cat])

  const priceLabel = s => {
    if (s.minNet == null) return 'Enquire'
    return s.minNet === s.maxNet ? fmtMoney(s.minNet, cur) : `${fmtMoney(s.minNet, cur)}–${fmtMoney(s.maxNet, cur)}`
  }

  return (
    <div>
      {loading && <LoadingBar />}
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl">Figurine Gifts</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          {filtered.length} designs · wholesale prices in {cur}
          {disc > 0 ? ` (your ${(disc * 100).toFixed(disc * 100 % 1 ? 1 : 0)}% discount applied)` : ''}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input type="text" placeholder="Search name or code…" className="input w-full sm:flex-1"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input sm:w-56" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No designs match your search.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {filtered.map(s => (
            <div key={s.id} className="card overflow-hidden flex flex-col">
              <div className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark">
                {s.image
                  ? <img src={s.image} alt={s.name} className="w-full h-full object-contain p-2" loading="lazy" />
                  : <Gem size={30} strokeWidth={1.25} className="text-gray-300" />}
              </div>
              <div className="p-3 flex flex-col gap-1 flex-1">
                <h3 className="text-sm leading-tight text-ink line-clamp-2" title={s.name}>{s.name}</h3>
                <p className="text-[11px] text-ink-60 font-mono">{s.code}</p>
                <p className="text-[11px] text-ink-60">{s.size}</p>
                <p className="text-[11px] text-ink-50 truncate">{s.platings.join(' · ')}</p>
                <div className="mt-auto pt-1.5">
                  <span className="text-base text-ink font-medium">{priceLabel(s)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
