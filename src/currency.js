import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

import { DEFAULT_RATES } from './domain/customerCurrency'
export { CUSTOMER_CURRENCIES, fromHKD, fromUSD, convertFromUSD, convertFromHKD, wsPriceFactor, fmtMoney } from './domain/customerCurrency'

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
