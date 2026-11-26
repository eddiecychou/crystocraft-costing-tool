import { useEffect, useState } from 'react'
import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from '../firebase'
import { isPositiveExchangeRate } from '../costCurrency.js'

const HKD_ONLY = { HKD: 1 }
const LOADING = { status: 'loading', rates: HKD_ONLY }

export default function useConfiguredExchangeRates() {
  const [result, setResult] = useState(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    getDocFromServer(doc(db, 'settings', 'exchange_rates')).then(snapshot => {
      if (!active) return
      const configured = Object.fromEntries(Object.entries(snapshot.data() ?? {}).filter(([, rate]) => isPositiveExchangeRate(rate)))
      setResult({ status: snapshot.exists() ? 'ready' : 'missing', rates: { ...configured, ...HKD_ONLY } })
    }).catch(() => {
      if (active) setResult({ status: 'error', rates: HKD_ONLY })
    })
    return () => { active = false }
  }, [attempt])

  function retry() {
    setResult(LOADING)
    setAttempt(n => n + 1)
  }

  return { ...result, retry }
}
