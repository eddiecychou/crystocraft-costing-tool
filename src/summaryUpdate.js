import {summaryDays} from './customerSummary.js'

// One update per browser tab. The owner survives route unmounts, but deliberately
// does not persist a running flag across reloads (which interrupt the browser job).
export function createSummaryUpdateStore(generate) {
  let state = {running:false, days:null, progress:'', error:''}
  let active = null
  const listeners = new Set()
  function publish(next) {
    state = {...state, ...next}
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    start(value) {
      if (active) return active
      const days = summaryDays(value)
      // Acquire the lock before notifying subscribers or beginning any async work.
      active = Promise.resolve().then(() => generate(days, (n,total) => {
        publish({progress:`Summarized ${n} of ${total} customers…`})
      })).then(result => {
        active = null
        publish({running:false, progress:''})
        return result
      }, error => {
        active = null
        publish({running:false, progress:'', error:error?.message || 'Could not update AI summaries. Saved summaries are unchanged.'})
        return null // The retained error is rendered by every current/future subscriber.
      })
      publish({running:true, days, progress:'Reading already-synced conversations…', error:''})
      return active
    },
  }
}
