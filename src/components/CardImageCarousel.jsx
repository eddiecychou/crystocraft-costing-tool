import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Swipeable image carousel for a PRODUCT CARD in a catalogue grid — distinct
// from ImageLightbox (the full-screen viewer on a product's DETAIL page).
// This one lets you page through a product's photos without leaving the grid.
//
// `images`: [{ url, caption? }], already screened/ordered by the caller —
// this component has no opinion about visibility rules (a sensitive customer's
// screening happens at the fetch, see CorporateShop's resolveSafeImages).
//
// Cards are wrapped in a <Link>, so every interactive element here must
// preventDefault + stopPropagation: without it, a swipe or an arrow tap
// navigates to the product instead of changing the image. A tap that ISN'T
// a swipe still falls through to the Link on purpose — tapping the photo
// should still open the product.
export default function CardImageCarousel({ images, alt, fallback, imgClassName = 'object-cover' }) {
  const [index, setIndex] = useState(0)
  const touch = useRef(null)      // { x, y, moved }
  const count = images.length

  if (!count) return fallback

  const go = (e, delta) => {
    e.preventDefault(); e.stopPropagation()
    setIndex(i => (i + delta + count) % count)
  }

  function onTouchStart(e) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, moved: false }
  }
  function onTouchMove(e) {
    if (!touch.current) return
    const t = e.touches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    // Only claim the gesture once it's clearly horizontal — otherwise a
    // vertical page scroll that starts on a card would get swallowed here.
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) touch.current.moved = true
  }
  function onTouchEnd(e) {
    const t = touch.current
    touch.current = null
    if (!t?.moved) return           // a plain tap — let the Link handle it
    const dx = e.changedTouches[0].clientX - t.x
    if (Math.abs(dx) < 30) return   // too small to count as a swipe
    e.preventDefault(); e.stopPropagation()
    setIndex(i => (i + (dx < 0 ? 1 : -1) + count) % count)
  }

  return (
    <div className="relative w-full h-full group"
         onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <img src={images[index].url} alt={alt || ''} loading="lazy"
           className={`w-full h-full select-none ${imgClassName}`} draggable={false} />

      {count > 1 && (
        <>
          {/* Desktop arrows — hidden until hover so the grid stays clean;
              always reachable on touch via the swipe above. */}
          <button type="button" onClick={e => go(e, -1)} aria-label="Previous image"
                  className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/35 hover:bg-black/55 text-white rounded-full p-1
                             opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={e => go(e, 1)} aria-label="Next image"
                  className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/35 hover:bg-black/55 text-white rounded-full p-1
                             opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
            <ChevronRight size={14} />
          </button>

          {/* Dots — the affordance that says "there are more photos here",
              which a card with no indicator gives no hint of at all. */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
            {images.map((_, i) => (
              <span key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
