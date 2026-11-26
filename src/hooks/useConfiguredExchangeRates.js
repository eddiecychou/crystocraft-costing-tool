import { useEffect, useState } from 'react'
import { HKD_ONLY, loadConfiguredExchangeRates } from '../configuredExchangeRates'

const LOADING = { status: 'loading', rates: HKD_ONLY }

export default function useConfiguredExchangeRates() {
  const [result, setResult] = useState(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    loadConfiguredExchangeRates().then(configured => {
      if (active) setResult(configured)
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
