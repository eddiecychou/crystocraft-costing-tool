import { useEffect, useMemo, useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { canWarmCarousel, carouselImageSource, loadCarouselImage } from '../carouselImageLoader'
import useInViewOnce from '../hooks/useInViewOnce'

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
export default function CardImageCarousel({ images, alt, fallback, imgClassName = 'object-cover', onImageError }) {
  const [index, setIndex] = useState(0)
  const [displayedUrl, setDisplayedUrl] = useState(images[0]?.url || '')
  const [readyUrl, setReadyUrl] = useState('')
  const [loadError, setLoadError] = useState('')
  const [originalFallbacks, setOriginalFallbacks] = useState({})
  const [carouselRef, inView] = useInViewOnce('160px')
  const touch = useRef(null)
  const errorCallback = useRef(onImageError)
  errorCallback.current = onImageError
  const galleryKey = JSON.stringify(images.map(image => image.url))
  const urls = useMemo(() => JSON.parse(galleryKey), [galleryKey])
  const count = urls.length
  const selected = Math.min(index, Math.max(0, count - 1))
  const requestedUrl = urls[selected] || ''
  const requestedOriginal = Boolean(originalFallbacks[requestedUrl])
  // Removed/replaced photos must disappear immediately, even if previously decoded.
  const originalUrl = urls.includes(displayedUrl) ? displayedUrl : requestedUrl
  const source = carouselImageSource(originalUrl, originalFallbacks[originalUrl])
  const pending = requestedUrl !== originalUrl && loadError !== requestedUrl

  function warmNeighbours(urgent = false) {
    if (count < 2 || !canWarmCarousel(navigator.connection)) return
    const current = urls.indexOf(originalUrl)
    const neighbours = new Set([urls[(current + 1) % count], urls[(current - 1 + count) % count]])
    neighbours.delete(originalUrl)
    for (const url of neighbours) loadCarouselImage(url, { urgent, original: Boolean(originalFallbacks[url]) })
  }
  useEffect(() => {
    if (inView && readyUrl === originalUrl) warmNeighbours()
  }, [inView, readyUrl, originalUrl, galleryKey])

  useEffect(() => {
    if (!requestedUrl || requestedUrl === originalUrl) return
    let cancelled = false
    setLoadError('')
    async function showRequested() {
      let useOriginal = requestedOriginal
      let ok = await loadCarouselImage(requestedUrl, { urgent: true, original: useOriginal })
      if (cancelled) return
      if (!ok && !useOriginal && carouselImageSource(requestedUrl).src !== requestedUrl) {
        useOriginal = true
        ok = await loadCarouselImage(requestedUrl, { urgent: true, original: true })
      }
      if (cancelled) return
      if (ok) {
        if (useOriginal) setOriginalFallbacks(current => ({ ...current, [requestedUrl]: true }))
        setDisplayedUrl(requestedUrl)
      } else {
        setLoadError(requestedUrl)
        errorCallback.current?.()
      }
    }
    showRequested()
    return () => { cancelled = true }
  }, [requestedUrl, originalUrl, requestedOriginal])

  const handleImageError = () => {
    if (source.src !== originalUrl) {
      setOriginalFallbacks(current => ({ ...current, [originalUrl]: true }))
      return
    }
    setLoadError(requestedUrl)
    errorCallback.current?.()
  }

  const go = (e, delta) => {
    e.preventDefault(); e.stopPropagation()
    setLoadError('')
    setIndex((selected + delta + count) % count)
  }

  function onTouchStart(e) {
    warmNeighbours(true)
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
    if (!t?.moved || count < 2) return           // a plain tap — let the Link handle it
    const dx = e.changedTouches[0].clientX - t.x
    if (Math.abs(dx) < 30) return   // too small to count as a swipe
    e.preventDefault(); e.stopPropagation()
    setLoadError('')
    setIndex((selected + (dx < 0 ? 1 : -1) + count) % count)
  }

  return (
    <div ref={carouselRef} className="relative w-full h-full group" aria-busy={pending}
         onMouseEnter={() => warmNeighbours(true)} onFocus={() => warmNeighbours(true)}
         onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {count ? <img key={originalUrl + source.src} src={source.src}
           srcSet={source.srcSet} sizes={source.sizes}
           alt={alt || ''} loading="lazy" decoding="async" onError={handleImageError}
           onLoad={() => setReadyUrl(originalUrl)}
           className={`w-full h-full select-none ${imgClassName}`} draggable={false} /> : fallback}
      {(pending || loadError === requestedUrl && requestedUrl) && <span role="status"
        className="absolute top-1 left-1 bg-ivory/90 text-ink text-xs px-2 py-1 pointer-events-none">
        {pending ? 'Loading photo…' : 'Photo unavailable — try another'}
      </span>}

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
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === selected ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
