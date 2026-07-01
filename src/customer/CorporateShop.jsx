import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db, auth } from '../firebase'
import { Package } from 'lucide-react'
import { useRates, convertFromHKD, fmtMoney } from '../currency'
import { isNew, newFirst } from '../newArrivals'
import { productStatusOf } from '../constants'
import CollectionBand from './CollectionBand'
import { collectionProducts } from '../catalogueCollections'
import FavHeart from './FavHeart'
import LoadingBar from '../components/LoadingBar'

export default function CorporateShop({ profile }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [coll, setColl] = useState(null)
  const rates = useRates()
  const cur = profile?.base_currency || 'USD'

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setProducts(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(p => productStatusOf(p.status).value !== 'retired')
          // New-tagged products first (C0), then alphabetical.
          .sort((a, b) => newFirst(a, b) || (a.name || '').localeCompare(b.name || ''))
      )
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
  // Light list the Shop-by band can render image tiles from.
  const bandItems = useMemo(() => products.map(p => ({
    id: p.id, category: p.category || '', is_new: !!p.is_new, image: p.heroImage || '', name: p.name || '',
  })), [products])
  const filtered = useMemo(() => {
    const base = coll ? collectionProducts(coll, products, 'corp_gift') : products
    return base.filter(p => {
      const q = search.toLowerCase()
      const ms = !q || p.name?.toLowerCase().includes(q)
      return ms && (coll || !cat || p.category === cat)
    })
  }, [products, coll, search, cat])

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
      <CollectionBand catalogue="corp_gift" products={bandItems} active={coll}
        onApply={c => { setColl(c); setCat(''); window.scrollTo({ top: 0 }) }} />
      {coll && (
        <div className="flex items-center justify-between gap-2 mb-4 px-3 py-2 rounded-md bg-ink/5 border border-ivory-dark">
          <span className="text-sm text-ink-80">Showing <span className="font-medium">{coll.title}</span></span>
          <button onClick={() => setColl(null)} className="text-sm text-ink-60 hover:text-ink shrink-0">Clear</button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input type="text" placeholder="Search products…" className="input w-full sm:flex-1"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input sm:w-56" value={coll ? '' : cat} onChange={e => { setColl(null); setCat(e.target.value) }}>
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
        setFromPrice(hkds.length ? convertFromHKD(Math.min(...hkds), profile, rates) : null)
      })
      .catch(() => setFromPrice(null))
  }, [p.id, cur, rates, profile?.id, profile?.fx_rate])

  return (
    <Link to={`/shop/corporate/${p.id}`} className="card overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden relative">
        {p.heroImage
          ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
          : <Package size={32} strokeWidth={1.25} className="text-gray-300" />}
        {isNew(p) && (
          <span className="absolute top-1.5 left-1.5 badge bg-emerald-600 text-white" title="New arrival">New</span>
        )}
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
