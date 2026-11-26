import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from './firebase'
import { isPositiveExchangeRate } from './costCurrency.js'

export const HKD_ONLY = { HKD: 1 }

export async function loadConfiguredExchangeRates() {
  const snapshot = await getDocFromServer(doc(db, 'settings', 'exchange_rates'))
  const configured = Object.fromEntries(Object.entries(snapshot.data() ?? {}).filter(([, rate]) => isPositiveExchangeRate(rate)))
  return { status: snapshot.exists() ? 'ready' : 'missing', rates: { ...configured, ...HKD_ONLY } }
}
