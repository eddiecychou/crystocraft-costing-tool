import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// Shared customer-facing image carousel/lightbox (bug-fix pack D-02) — both
// CorporateDetail.jsx and FigurineDetail.jsx used to render their gallery as
// a plain static grid with no way to view an image large or page through the
// set. One component so both surfaces behave identically and any future
// product-image gallery gets this for free.
//
// `images`: [{ url, caption? }], already screened/ordered by the caller —
// this component has no opinion about visibility rules, it only displays
// what it's given. `index`/`onIndexChange` are controlled so the caller can
// open the lightbox already pointed at whichever thumbnail was clicked.
export default function ImageLightbox({ images, index, onIndexChange, onClose, altBase }) {
  const count = images.length
  const go = useCallback((delta) => {
    if (count < 2) return
    onIndexChange((index + delta + count) % count)
  }, [index, count, onIndexChange])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  const current = images[index]
  if (!current) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-black/85" onClick={onClose}>
      <button type="button" onClick={onClose}
              className="absolute top-4 right-4 text-white bg-white/15 hover:bg-white/25 rounded-none p-2"
              aria-label="Close">
        <X size={18} />
      </button>

      {count > 1 && (
        <span className="absolute top-4 left-4 text-white/80 text-sm font-mono">{index + 1} / {count}</span>
      )}

      {count > 1 && (
        <button type="button" onClick={e => { e.stopPropagation(); go(-1) }}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white bg-white/15 hover:bg-white/25 rounded-full p-2 sm:p-3"
                aria-label="Previous image">
          <ChevronLeft size={22} />
        </button>
      )}

      <img src={current.url} alt={current.caption || altBase || ''}
           className="max-w-full max-h-[75vh] rounded-none object-contain" onClick={e => e.stopPropagation()} />

      {current.caption && (
        <p className="text-white/80 text-sm mt-3 max-w-lg text-center px-4" onClick={e => e.stopPropagation()}>
          {current.caption}
        </p>
      )}

      {count > 1 && (
        <button type="button" onClick={e => { e.stopPropagation(); go(1) }}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white bg-white/15 hover:bg-white/25 rounded-full p-2 sm:p-3"
                aria-label="Next image">
          <ChevronRight size={22} />
        </button>
      )}

      {/* Thumbnail strip — selected thumbnail highlighted, click to jump */}
      {count > 1 && (
        <div className="mt-4 flex gap-1.5 overflow-x-auto max-w-full px-2 pb-1" onClick={e => e.stopPropagation()}>
          {images.map((im, i) => (
            <button key={i} type="button" onClick={() => onIndexChange(i)}
                    className={`shrink-0 w-12 h-12 rounded-none overflow-hidden border-2 transition-colors ${
                      i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-90'}`}>
              <img src={im.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
