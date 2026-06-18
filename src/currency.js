import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Customer-facing currencies (RMB intentionally excluded for the storefront).
export const CUSTOMER_CURRENCIES = ['USD', 'EUR', 'HKD', 'GBP', 'AUD', 'CAD', 'SGD']

// Rates are stored in settings/exchange_rates as HKD per 1 unit of currency.
// HKD is the pivot: 1 USD = rates.USD HKD, etc.
const DEFAULT_RATES = { RMB: 1.09, USD: 7.78, EUR: 8.60, HKD: 1 }

export function useRates() {
  const [rates, setRates] = useState(DEFAULT_RATES)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'exchange_rates')).then(s => {
      if (s.exists()) {
        const data = s.data() || {}
        const numeric = Object.fromEntries(
          Object.entries(data).filter(([, v]) => typeof v === 'number'),
        )
        setRates({ ...DEFAULT_RATES, ...numeric, HKD: 1 })
      }
    }).catch(() => {})
  }, [])
  return rates
}

// Convert a HKD amount into the target currency.
export const fromHKD = (amountHKD, cur, rates) =>
  cur === 'HKD' ? Number(amountHKD) : Number(amountHKD) / (rates[cur] || 1)

// Convert a USD amount into the target currency (USD -> HKD -> target).
export const fromUSD = (amountUSD, cur, rates) => {
  const hkd = Number(amountUSD) * (rates.USD || DEFAULT_RATES.USD)
  return fromHKD(hkd, cur, rates)
}

// Per-currency decimal rules: HKD max 1 dp, everything else max 2 dp.
export const fmtMoney = (val, cur) => {
  if (val == null || val === '' || Number.isNaN(Number(val))) return '—'
  const dp = cur === 'HKD' ? 1 : 2
  return `${cur} ${(Number(val)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })}`
}
