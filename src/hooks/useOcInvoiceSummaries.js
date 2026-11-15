import { useEffect, useState } from 'react'
import { authedUser } from '../firebase'

export default function useOcInvoiceSummaries(enabled, uid) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    async function load() {
      try {
        const user = await authedUser()
        if (!user || user.uid !== uid) throw Error('Please sign in again.')
        const token = await user.getIdToken()
        const response = await fetch('/api/oc-invoice-summaries', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          cache: 'no-store',
        })
        if (!response.ok) throw Error('Could not load OC invoice summaries.')
        const data = await response.json()
        if (!Array.isArray(data?.rows)) throw Error('Incomplete OC invoice summaries.')
        if (!controller.signal.aborted) setResult({ uid, attempt, rows: data.rows })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ uid, attempt, error })
      }
    }
    load()
    return () => controller.abort()
  }, [enabled, uid, attempt])

  const current = enabled && result?.uid === uid && result?.attempt === attempt ? result : null
  return { rows: current?.rows, error: current?.error, loading: enabled && !current, retry: () => setAttempt(n => n + 1) }
}
