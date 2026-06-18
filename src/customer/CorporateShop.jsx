import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db, auth } from '../firebase'
import { Package } from 'lucide-react'
import { useRates, fromHKD, fmtMoney } from '../currency'
import FavHeart from './FavHeart'
import LoadingBar from '../components/LoadingBar'

export default function CorporateShop({ profile }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setProducts(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.status !== 'discontinued')
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      )
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
  const filtered = useMemo(() => products.filter(p => {
    const q = search.toLowerCase()
    const ms = !q || p.name?.toLowerCase().includes(q)
    return ms && (!cat || p.category === cat)
  }), [products, search, cat])

  return (
    <div>
      {loading && <LoadingBar />}
      <div className="mb-2">
        <h1 className="text-xl md:text-2xl">Corporate Gifts</h1>
        <p className="text-sm text-ink-60 mt-0.5">{filtered.length} products · indicative prices in {cur}</p>
      </div>
      <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 mb-5">
        Corporate gifts are made to order. Prices shown are indicative reference points only — final pricing varies
        by specification, quantity and customisation. Contact us for a quotation.
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input type="text" placeholder="Search products…" className="input w-full sm:flex-1"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input sm:w-56" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No products match your search.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {filtered.map(p => <CorpCard key={p.id} p={p} cur={cur} rates={rates} profile={profile} />)}
        </div>
      )}
    </div>
  )
}

function CorpCard({ p, cur, rates, profile }) {
  const [fromPrice, setFromPrice] = useState(undefined) // undefined=loading, null=none
  useEffect(() => {
    const uid = profile?.id || auth.currentUser?.uid
    if (!uid) { setFromPrice(null); return }
    getDoc(doc(db, 'products', p.id, 'customer_prices', uid))
      .then(s => {
        const hkds = (s.exists() ? (s.data().tiers || []) : []).map(t => t.price_hkd).filter(v => v != null).map(Number)
        setFromPrice(hkds.length ? fromHKD(Math.min(...hkds), cur, rates) : null)
      })
      .catch(() => setFromPrice(null))
  }, [p.id, cur, rates, profile?.id])

  return (
    <Link to={`/shop/corporate/${p.id}`} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden relative">
        {p.heroImage
          ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
          : <Package size={32} strokeWidth={1.25} className="text-gray-300" />}
        <FavHeart item={{ type: 'corporate', id: p.id, name: p.name, code: '', image: p.heroImage || '' }}
          className="absolute top-1.5 right-1.5" />
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3 className="text-sm leading-tight text-ink line-clamp-2" title={p.name}>{p.name}</h3>
        <p className="text-[11px] text-ink-50">{p.category}</p>
        {p.description && <p className="text-[11px] text-ink-60 line-clamp-2">{p.description}</p>}
        <div className="mt-auto pt-1.5">
          {fromPrice === undefined ? <span className="text-xs text-ink-40">…</span>
            : fromPrice == null ? <span className="text-xs text-ink-40 italic">Enquire for pricing</span>
            : <span className="text-sm text-ink"><span className="text-[11px] text-ink-50">from </span>{fmtMoney(fromPrice, cur)}</span>}
        </div>
      </div>
    </Link>
  )
}
