import { useState, useEffect } from 'react'
import { doc, onSnapshot, collection, query, orderBy, getDocs } from 'firebase/firestore'
import { useParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { Package, ArrowLeft, Check, Plus } from 'lucide-react'
import { useRates, fromHKD, fmtMoney } from '../currency'
import FavHeart from './FavHeart'
import { useCart } from './store'
import LoadingBar from '../components/LoadingBar'

export default function CorporateDetail({ profile }) {
  const { id } = useParams()
  const [p, setP] = useState(undefined)
  const [tiers, setTiers] = useState([])
  const rates = useRates()
  const cart = useCart()
  const cur = profile?.base_currency || 'USD'

  useEffect(() => onSnapshot(doc(db, 'products', id),
    s => setP(s.exists() ? { id: s.id, ...s.data() } : null), () => setP(null)), [id])

  useEffect(() => {
    getDocs(query(collection(db, 'products', id, 'pricing_tiers'), orderBy('quantity')))
      .then(snap => setTiers(snap.docs.map(d => d.data()).filter(t => t.price_hkd != null)))
      .catch(() => setTiers([]))
  }, [id])

  if (p === undefined) return <LoadingBar />
  if (p === null) return (
    <div className="text-center py-20 text-ink-60">
      <p>This product is no longer available.</p>
      <Link to="/shop/corporate" className="text-brand-600 text-sm mt-2 inline-block">Back to catalogue</Link>
    </div>
  )

  const inCart = cart?.has('corporate', p.id)
  const tierQtys = tiers.map(t => Number(t.quantity) || 0).filter(q => q > 0)
  const minQty = tierQtys.length ? Math.min(...tierQtys) : 0

  return (
    <div>
      <Link to="/shop/corporate" className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to Corporate Gifts
      </Link>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="card overflow-hidden bg-gray-100 aspect-square flex items-center justify-center relative">
          {p.heroImage ? <img src={p.heroImage} alt={p.name} className="w-full h-full object-cover" />
            : <Package size={56} className="text-gray-300" />}
          <FavHeart item={{ type: 'corporate', id: p.id, name: p.name, code: '', image: p.heroImage || '' }} className="absolute top-3 right-3" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl text-ink">{p.name}</h1>
          {p.category && <p className="text-sm text-ink-50 mt-1">{p.category}</p>}
          {p.description && <p className="text-sm text-ink-70 mt-3">{p.description}</p>}

          <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 mt-4">
            Made to order. Prices below are indicative reference points only — final pricing varies by
            specification, quantity and customisation.
            {minQty > 0 && <span className="block mt-1 font-medium">Minimum order: {minQty.toLocaleString()} pcs per design.</span>}
          </div>

          <div className="mt-5">
            <button onClick={() => cart?.add({ type: 'corporate', id: p.id, name: p.name, code: '', image: p.heroImage || '', qty: minQty || 1, moq: minQty })}
              disabled={inCart}
              className={`btn-primary ${inCart ? 'opacity-60 pointer-events-none' : ''}`}>
              {inCart ? <><Check size={16} /> In enquiry</> : <><Plus size={16} /> Add to enquiry</>}
            </button>
            {inCart && <span className="ml-3 text-xs text-ink-50">Adjust quantity in your enquiry list</span>}
          </div>

          {tiers.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">Indicative prices ({cur})</p>
              <div className="card divide-y divide-ivory-dark">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-60">{Number(t.quantity).toLocaleString()} pcs</span>
                    <span className="text-ink font-medium">{fmtMoney(fromHKD(t.price_hkd, cur, rates), cur)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
