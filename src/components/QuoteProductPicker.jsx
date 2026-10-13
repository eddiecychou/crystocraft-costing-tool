import { useEffect, useRef, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { Check, Package } from 'lucide-react'
import { db } from '../firebase'
import { rangeQuoteChoices } from '../rangeQuote'

export default function QuoteProductPicker({ existingKeys, onAdd, onClose }) {
  const [products, setProducts] = useState([])
  const [rangeProducts, setRangeProducts] = useState([])
  const [catalogue, setCatalogue] = useState('products')
  const [selected, setSelected] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState({ products: true, range_products: false })
  const [errors, setErrors] = useState({})
  const requested = useRef(new Set())

  useEffect(() => {
    if (requested.current.has(catalogue)) return
    requested.current.add(catalogue)
    setLoading(s => ({ ...s, [catalogue]: true }))
    const request = catalogue === 'products'
      ? getDocs(query(collection(db, 'products'), orderBy('name')))
      : getDocs(collection(db, 'range_products'))
    request.then(snap => {
      if (catalogue === 'products') setProducts(snap.docs.map(d => ({ id: d.id, ...d.data(), source: 'products', key: `products:${d.id}` })))
      else setRangeProducts(snap.docs.flatMap(d => rangeQuoteChoices({ id: d.id, ...d.data() })))
    }).catch(() => setErrors(s => ({ ...s, [catalogue]: `${catalogue === 'products' ? 'Corporate gifts' : 'Gift Range'} could not be loaded.` })))
      .finally(() => setLoading(s => ({ ...s, [catalogue]: false })))
  }, [catalogue])

  const candidates = catalogue === 'products' ? products : rangeProducts
  const term = search.trim().toLowerCase()
  const filtered = candidates.filter(p => {
    if (existingKeys.includes(p.key)) return false
    return !term || [p.name, p.category, p.sku, p.detail, p.design_code]
      .some(value => String(value || '').toLowerCase().includes(term))
  })

  function toggle(p) {
    setSelected(s => s.some(x => x.key === p.key) ? s.filter(x => x.key !== p.key) : [...s, p])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-warm-grey">
          <h2 className="text-ink mb-3">Add Products to Quote</h2>
          <div className="grid grid-cols-2 gap-2 mb-3" role="tablist" aria-label="Product catalogue">
            {[["products", "Corporate Gifts"], ["range_products", "Gift Range"]].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={catalogue === key}
                onClick={() => { setCatalogue(key); setSearch('') }}
                className={`px-3 py-2 text-xs border rounded-none focus-visible:ring-2 focus-visible:ring-brand-300 ${catalogue === key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-warm-grey text-ink-60 hover:bg-ivory'}`}>
                {label}
              </button>
            ))}
          </div>
          <input type="text" placeholder={catalogue === 'range_products' ? 'Search designs or SKUs…' : 'Search products…'}
            className="input" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          {catalogue === 'range_products' && <p className="text-xs text-ink-60 mt-2">Choose the exact SKU. Listed wholesale USD prices are converted to this quote’s currency; review each price before export. Internal cost and margin are not auto-filled.</p>}
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {loading[catalogue] ? (
            <p className="text-sm text-ink-60 text-center py-8">Loading…</p>
          ) : errors[catalogue] ? (
            <p className="text-sm text-red-600 text-center py-8">{errors[catalogue]} Close and try again.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-8">No products found.</p>
          ) : filtered.map(p => {
            const isSelected = selected.some(x => x.key === p.key)
            const image = p.source === 'range_products' ? p.image : p.heroImage
            return (
              <button type="button" key={p.key} onClick={() => toggle(p)} aria-pressed={isSelected}
                className={`flex items-center gap-3 p-3 w-full text-left rounded-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-300 ${isSelected ? 'bg-brand-50 border border-brand-200' : 'hover:bg-ivory border border-transparent'}`}>
                <div className="w-12 h-12 rounded-none bg-ivory-dark shrink-0 overflow-hidden flex items-center justify-center">
                  {image ? <img src={image} alt="" className="w-full h-full object-cover" />
                    : <Package size={18} strokeWidth={1.5} className="text-platinum" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-60 break-words">{p.source === 'range_products' ? [p.sku || p.detail, p.category].filter(Boolean).join(' · ') : p.category}</p>
                  {p.source === 'range_products' && <p className="text-xs text-ink-60">{Number(p.usdPrice) > 0 ? `Wholesale USD ${Number(p.usdPrice).toFixed(2)}` : 'No listed price — enter one in quote'}</p>}
                </div>
                {isSelected && <Check size={18} className="text-brand-600" />}
              </button>
            )
          })}
        </div>

        <div className="p-4 border-t border-warm-grey flex gap-3 justify-between items-center">
          <p className="text-sm text-ink-60">{selected.length} selected</p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={selected.length === 0} onClick={() => onAdd(selected)}>
              Add {selected.length > 0 ? selected.length : ''} Product{selected.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
