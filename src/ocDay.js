import { ocDateOnly, untilHongKongMidnight } from './ocTime.js'

// One clock per app, shared by every workspace. Nothing is saved or fetched.
export function createOcDayStore({ now = () => new Date(), host = globalThis.window, doc = globalThis.document } = {}) {
  let day = ocDateOnly(now()), midnight, watchdog
  const listeners = new Set()
  function refresh() {
    const current = now(), nextDay = ocDateOnly(current)
    if (nextDay !== day) {
      day = nextDay
      listeners.forEach(listener => listener())
    }
    host.clearTimeout(midnight)
    midnight = host.setTimeout(refresh, untilHongKongMidnight(current))
  }
  function visible() { if (doc.visibilityState === 'visible') refresh() }
  return {
    getSnapshot: () => day,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && host) {
        refresh()
        // Catch system clock changes even if the page never loses focus.
        watchdog = host.setInterval(refresh, 60_000)
        host.addEventListener('focus', refresh)
        host.addEventListener('pageshow', refresh)
        doc?.addEventListener('visibilitychange', visible)
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size && host) {
          host.clearTimeout(midnight)
          host.clearInterval(watchdog)
          host.removeEventListener('focus', refresh)
          host.removeEventListener('pageshow', refresh)
          doc?.removeEventListener('visibilitychange', visible)
        }
      }
    },
  }
}
