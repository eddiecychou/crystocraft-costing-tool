import { cardImageUrl } from './cardImageUrl.js'

export const CARD_IMAGE_SIZES = '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw'
export function carouselImageSource(url, original = false) {
  const src = original ? url : cardImageUrl(url)
  return { src, srcSet: src !== url ? `${cardImageUrl(url, 320)} 320w, ${src} 640w` : undefined, sizes: CARD_IMAGE_SIZES }
}
export function canWarmCarousel(connection) {
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType)
}

// At most two speculative downloads globally. Explicit navigation can use two
// additional slots and moves ahead of queued warming. Never warm a whole gallery.
export function createCarouselImageLoader(makeImage = () => new Image(), timeoutMs = 20000) {
  const cache = new Map()
  const queue = []
  let active = 0, background = 0
  function pump() {
    while (active < 4) {
      const next = queue.findIndex(job => job.urgent || background < 2)
      if (next < 0) break
      const job = queue.splice(next, 1)[0]
      job.started = true
      active++
      const speculative = !job.urgent
      if (speculative) background++
      const image = makeImage()
      job.image = image
      let finished = false
      const finish = ok => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        image.onload = image.onerror = null
        active--
        if (speculative) background--
        job.done = true
        job.image = null
        if (!ok) cache.delete(job.key)
        job.resolve(ok)
        // Bound metadata as well as network work; the browser owns its image cache.
        for (const [key, item] of cache) {
          if (cache.size <= 128) break
          if (item.done) cache.delete(key)
        }
        pump()
      }
      const timer = setTimeout(() => { finish(false); image.removeAttribute('srcset'); image.removeAttribute('src') }, timeoutMs)
      image.onload = () => {
        // Complete decoding before swapping the visible photo.
        Promise.resolve().then(() => image.decode?.()).then(() => finish(true), () => finish(image.naturalWidth > 0))
      }
      image.onerror = () => finish(false)
      image.decoding = 'async'
      image.fetchPriority = job.urgent ? 'high' : 'low'
      image.sizes = job.source.sizes
      if (job.source.srcSet) image.srcset = job.source.srcSet
      image.src = job.source.src
    }
  }
  return function load(url, { urgent = false, original = false } = {}) {
    const source = carouselImageSource(url, original)
    const key = JSON.stringify([source, typeof window === 'undefined' ? '' : `${window.innerWidth}:${window.devicePixelRatio}`])
    let job = cache.get(key)
    if (job) {
      if (urgent && job.image) job.image.fetchPriority = 'high'
      if (urgent && !job.started) {
        job.urgent = true
        queue.splice(queue.indexOf(job), 1)
        queue.unshift(job)
        pump()
      }
      return job.promise
    }
    job = { key, source, urgent, started: false, done: false }
    job.promise = new Promise(resolve => { job.resolve = resolve })
    cache.set(key, job)
    if (urgent) queue.unshift(job)
    else queue.push(job)
    pump()
    return job.promise
  }
}
export const loadCarouselImage = createCarouselImageLoader()
