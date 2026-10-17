import { dateOnly } from './customerWorkItems.js'

// Calendar arithmetic follows local midnight, including 23/25-hour DST days.
export function untilLocalMidnight(now) {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - now.getTime())
}

// One clock per app, shared by every workspace. Nothing is saved or fetched.
export function createLocalDayStore({ now = () => new Date(), host = globalThis.window, doc = globalThis.document } = {}) {
  let day = dateOnly(now()), midnight, watchdog
  const listeners = new Set()
  function refresh() {
    const current = now(), nextDay = dateOnly(current)
    if (nextDay !== day) {
      day = nextDay
      listeners.forEach(listener => listener())
    }
    host.clearTimeout(midnight)
    midnight = host.setTimeout(refresh, untilLocalMidnight(current))
  }
  function visible() { if (doc.visibilityState === 'visible') refresh() }
  return {
    getSnapshot: () => day,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && host) {
        refresh()
        // Catch clock/timezone changes even if the page never loses focus.
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
