import { Link } from 'react-router-dom'
import { Gem, Package, Heart } from 'lucide-react'
import { useFavourites, useCart } from './store'

export default function FavouritesPage() {
  const fav = useFavourites()
  const cart = useCart()
  const items = fav?.items || []

  if (items.length === 0) {
    return (
      <div className="text-center py-20 text-ink-60">
        <Heart size={32} className="mx-auto text-ink-30 mb-3" />
        <p>No favourites yet.</p>
        <p className="text-sm text-ink-50 mt-1">Tap the heart on any product to save it here.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl md:text-2xl mb-4">Favourites <span className="text-ink-50 text-base">({items.length})</span></h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {items.map(it => {
          const to = it.type === 'figurine' ? `/shop/figurine/${it.id}` : `/shop/corporate/${it.id}`
          const Icon = it.type === 'figurine' ? Gem : Package
          // Figurines need plating/colour chosen on the detail page, so only
          // corporate (single-SKU) favourites can report an in-enquiry state here.
          const inCart = it.type !== 'figurine' && cart?.has({ type: it.type, id: it.id })
          return (
            <div key={`${it.type}-${it.id}`} className="card overflow-hidden flex flex-col">
              <Link to={to} className="aspect-square bg-white flex items-center justify-center overflow-hidden border-b border-ivory-dark">
                {it.image ? <img src={it.image} alt={it.name} className="w-full h-full object-contain p-2" />
                  : <Icon size={28} className="text-gray-300" />}
              </Link>
              <div className="p-3 flex flex-col gap-1 flex-1">
                <Link to={to}><h3 className="text-sm leading-tight text-ink line-clamp-2">{it.name}</h3></Link>
                {it.code && <p className="text-[11px] text-ink-50 font-mono">{it.code}</p>}
                <div className="mt-auto pt-2 flex items-center gap-2">
                  {inCart ? (
                    <span className="text-xs px-2 py-1 rounded border border-ivory-dark text-ink-40">In enquiry</span>
                  ) : it.type === 'figurine' ? (
                    <Link to={to}
                      className="text-xs px-2 py-1 rounded border border-brand-500 text-brand-600 hover:bg-brand-50">
                      Select options
                    </Link>
                  ) : (
                    <button onClick={() => cart?.add(it)}
                      className="text-xs px-2 py-1 rounded border border-brand-500 text-brand-600 hover:bg-brand-50">
                      Add to enquiry
                    </button>
                  )}
                  <button onClick={() => fav?.toggle(it)} className="text-xs text-ink-40 hover:text-red-500 ml-auto">Remove</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
