import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import { CATEGORIES, PRODUCT_STATUSES, productStatusOf } from '../constants'
import LoadingBar from '../components/LoadingBar'
import { Package } from 'lucide-react'
import useScrollMemory from '../hooks/useScrollMemory'

export default function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]         = useState(() => sessionStorage.getItem('pf-search') || '')
  const [filterCat, setFilterCat]   = useState(() => sessionStorage.getItem('pf-cat')    || '')
  const [filterStatus, setFilterStatus] = useState(() => sessionStorage.getItem('pf-status') || '')
  const remember = useScrollMemory('products', !loading)

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase())
    const matchCat    = !filterCat || p.category === filterCat
    const matchStatus = !filterStatus || productStatusOf(p.status).value === filterStatus
    return matchSearch && matchCat && matchStatus
  })

  return (
    <div className="p-6">
      {loading && <LoadingBar />}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">{products.length} items in catalogue</p>
        </div>
        <Link to="/products/new" className="btn-primary text-sm">+ New</Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input
          type="text"
          placeholder="Search…"
          className="input w-full sm:flex-1"
          value={search}
          onChange={e => { setSearch(e.target.value); sessionStorage.setItem('pf-search', e.target.value) }}
        />
        <div className="flex gap-2">
          <select className="input flex-1 sm:flex-none sm:w-auto" value={filterCat} onChange={e => { setFilterCat(e.target.value); sessionStorage.setItem('pf-cat', e.target.value) }}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input flex-1 sm:flex-none sm:w-auto" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); sessionStorage.setItem('pf-status', e.target.value) }}>
            <option value="">All statuses</option>
            {PRODUCT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 && !loading ? (
        <div className="text-center py-20 text-gray-400">
          {products.length === 0 ? 'No products yet — add your first one.' : 'No products match your filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => <ProductCard key={p.id} product={p} onNavigate={remember} />)}
        </div>
      )}
    </div>
  )
}

const fmtTierPrice = (val, cur) => {
  const dp = cur === 'HKD' ? 1 : 2
  return (Number(val) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })
}

function ProductCard({ product: p, onNavigate }) {
  const [tiers, setTiers] = useState(null)
  const status = productStatusOf(p.status)
  const isRetired = status.value === 'retired'

  useEffect(() => {
    getDocs(query(collection(db, 'products', p.id, 'pricing_tiers'), orderBy('quantity')))
      .then(snap => setTiers(snap.docs.map(d => d.data()).filter(t => t.price_hkd)))
  }, [p.id])

  return (
    <Link to={`/products/${p.id}`} onClick={onNavigate}
      className={`card hover:shadow-md transition-shadow overflow-hidden flex flex-col ${isRetired ? 'opacity-50 grayscale' : ''}`}>
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        {p.heroImage
          ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" />
          : <Package size={40} strokeWidth={1.25} className="text-gray-300" />
        }
      </div>
      <div className="p-4 flex flex-col gap-1 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight">{p.name}</h3>
          <span className={`badge-${status.value} shrink-0`}>{status.label}</span>
        </div>
        <p className="text-xs text-gray-500">{p.category}</p>
        {p.description && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{p.description}</p>}

        {/* Pricing tiers */}
        {tiers && tiers.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-x-3 gap-y-1">
            {tiers.map(t => (
              // price_hkd (written fresh on every publish, always in HKD) is the single
              // source of truth. Legacy sell_price/sell_currency fields are ignored —
              // they were never updated on publish and caused stale/mislabelled prices.
              <span key={t.quantity} className="text-xs text-gray-700">
                <span className="font-semibold text-gray-900">HKD {fmtTierPrice(t.price_hkd, 'HKD')}</span>
                <span className="text-gray-400"> @ {t.quantity.toLocaleString()} pcs</span>
              </span>
            ))}
          </div>
        )}
        {tiers && tiers.length === 0 && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-300 italic">No pricing set</p>
        )}
      </div>
    </Link>
  )
}
