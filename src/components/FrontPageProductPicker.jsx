import { useState, useEffect } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { normGallery, isStorefrontVisible } from '../constants'
import { Check, Search } from 'lucide-react'

// Two-step "pick a product, then pick one of its gallery photos" modal for
// the homepage Featured Products picker — same shape as LineImagePicker.jsx,
// extended to search BOTH catalogues (range_products AND products), since a
// featured showcase mixes figurines and corporate gifts (CatalogueBand.jsx's
// dual-catalogue product loading is the precedent for unifying the two
// shapes into one search list).
//
// Corporate-gift images are filtered to isStorefrontVisible() and exclude
// anything tagged branded_for_customer_id — this list is a manual choice
// that goes on the PUBLIC homepage every customer sees, so a photo branded
// for one specific client must never even be selectable here (the same leak
// this codebase has hit twice before in other surfaces — see
// sensitiveImages.js and CorporateShop.jsx's resolveSafeImage comment).
export default function FrontPageProductPicker({ onSelect, onClose }) {
  const [products, setProducts] = useState(null) // null = loading
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(null)      // { id, type, name } whose gallery is open
  const [images, setImages] = useState([])
  const [imgLoading, setImgLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'range_products')),
      getDocs(collection(db, 'products')),
    ]).then(([rangeSnap, corpSnap]) => {
      const range = rangeSnap.docs.map(d => {
        const p = d.data()
        return {
          id: d.id, type: 'range',
          name: p.design_name || p.description || p.design_code || d.id,
          cat: p.design_type || p.category || '',
          image: normGallery(p.gallery)[0]?.url || '',
          active: p.active !== false && p.status !== 'retired',
        }
      })
      const corp = corpSnap.docs.map(d => {
        const p = d.data()
        return {
          id: d.id, type: 'corp_gift',
          name: p.name || d.id,
          cat: p.category || '',
          image: p.heroImage || '',
          active: p.active !== false,
        }
      })
      setProducts([...range, ...corp].filter(p => p.active))
    })
  }, [])

  function openProduct(p) {
    setChosen(p)
    setImgLoading(true)
    setImages([])
    if (p.type === 'corp_gift') {
      getDocs(query(collection(db, 'products', p.id, 'images'), orderBy('sort_order')))
        .then(snap => {
          const imgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(im => isStorefrontVisible(im) && !im.branded_for_customer_id)
          setImages(imgs.map(im => ({ id: im.id, url: im.file_url })))
        })
        .finally(() => setImgLoading(false))
    } else {
      // range_products' gallery is a plain array on the doc itself — refetch
      // just that one doc rather than trusting the list snapshot's copy,
      // in case it changed since the initial load.
      getDoc(doc(db, 'range_products', p.id))
        .then(snap => {
          const gallery = normGallery(snap.data()?.gallery)
          setImages(gallery.map((g, i) => ({ id: String(i), url: g.url })))
        })
        .finally(() => setImgLoading(false))
    }
  }

  const filtered = (products || []).filter(p =>
    !search
    || p.name?.toLowerCase().includes(search.toLowerCase())
    || p.cat?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">
            {chosen ? `Choose a photo — ${chosen.name}` : 'Pick a product to feature'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {!chosen && (
          <div className="px-4 pt-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search figurine or corporate gift products…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-4">
          {chosen ? (
            imgLoading ? <p className="text-sm text-gray-400 text-center py-8">Loading photos…</p>
            : images.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No storefront-safe photos found for this product. {chosen.type === 'corp_gift' && 'Check its images aren’t all marked Internal or branded for a specific customer.'}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {images.map(img => (
                  <div key={img.id} onClick={() => onSelect({ product_type: chosen.type, product_id: chosen.id, image_url: img.url })}
                    className="relative cursor-pointer rounded-lg overflow-hidden aspect-square border-2 border-transparent hover:border-brand-300 transition-all">
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )
          ) : products === null ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading products…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No matching products.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map(p => (
                <button key={`${p.type}-${p.id}`} type="button" onClick={() => openProduct(p)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 text-left">
                  <div className="w-10 h-10 rounded bg-gray-100 shrink-0 overflow-hidden">
                    {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400 truncate">{p.cat}</p>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${p.type === 'range' ? 'bg-brand-50 text-brand-700' : 'bg-sapphire/10 text-sapphire'}`}>
                    {p.type === 'range' ? 'Figurine' : 'Corporate'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {chosen && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button type="button" onClick={() => { setChosen(null); setImages([]) }}
              className="btn-secondary text-xs py-1.5 px-3">← Back to products</button>
          </div>
        )}
      </div>
    </div>
  )
}
