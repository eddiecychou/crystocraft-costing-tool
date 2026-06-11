import { useEffect } from 'react'

// In-memory scroll store, keyed per page (survives SPA navigation, resets on full reload)
const store = new Map()

// Restores the saved scroll position of the main content container for `key`
// once `ready` is true, and returns a `remember()` fn to call right before
// navigating away (on click) — capturing scrollTop while the page is still on
// screen, before the browser clamps it to the shorter destination page.
export default function useScrollMemory(key, ready = true) {
  useEffect(() => {
    if (!ready) return
    const target = store.get(key)
    if (!target) return
    const el = document.getElementById('main-scroll')
    if (!el) return
    // Retry across frames: async Firestore lists/images grow the page height
    // after mount, so keep re-applying until the target is reachable.
    let raf
    let tries = 0
    const tick = () => {
      el.scrollTop = target
      if (Math.abs(el.scrollTop - target) > 2 && tries < 40) {
        tries++
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ready, key])

  return function remember() {
    const el = document.getElementById('main-scroll')
    if (el) store.set(key, el.scrollTop)
  }
}
