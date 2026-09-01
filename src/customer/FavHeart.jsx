import { Heart } from 'lucide-react'
import { useFavourites } from './store'

// Heart toggle. `item` = { type, id, name, code, image }.
export default function FavHeart({ item, className = '' }) {
  const fav = useFavourites()
  const active = fav?.has(item.type, item.id)
  return (
    <button
      type="button"
      onClick={e => { e.preventDefault(); e.stopPropagation(); fav?.toggle(item) }}
      aria-label={active ? 'Remove from favourites' : 'Add to favourites'}
      className={`inline-flex items-center justify-center rounded-full p-1.5 bg-white/90 shadow-sm hover:bg-white transition-colors ${className}`}>
      <Heart size={16} className={active ? 'text-red-500 fill-red-500' : 'text-ink-60'} />
    </button>
  )
}
