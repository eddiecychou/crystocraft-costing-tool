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

// Convert a USD (ex-factory base) amount into the customer's display currency,
// honouring a per-account FIXED rate when set. profile.fx_rate = units of the
// customer's base_currency per 1 USD (e.g. HKD 7.80, EUR 0.92). When set (>0) it
// locks the customer's prices regardless of the live daily rates; blank/0 falls
// back to the live global conversion. Customer-facing use only.
export const convertFromUSD = (amountUSD, profile, rates) => {
  if (amountUSD == null) return null
  const fx = Number(profile?.fx_rate)
  if (Number.isFinite(fx) && fx > 0) return Number(amountUSD) * fx
  return fromUSD(amountUSD, profile?.base_currency || 'USD', rates)
}

// Convert a HKD amount into the customer's display currency, honouring the same
// per-account fixed rate. The lock is defined as USD→display (profile.fx_rate),
// so corp-gift HKD prices are first bridged to USD via the live pivot (HKD is
// USD-pegged, so this is effectively stable) then converted at the locked rate.
// Blank/0 fx_rate falls back to the live HKD→currency conversion.
export const convertFromHKD = (amountHKD, profile, rates) => {
  if (amountHKD == null) return null
  const fx = Number(profile?.fx_rate)
  if (Number.isFinite(fx) && fx > 0) {
    const usd = Number(amountHKD) / (rates.USD || DEFAULT_RATES.USD)  // HKD → USD (pegged)
    return usd * fx                                                   // USD → display (locked)
  }
  return fromHKD(amountHKD, profile?.base_currency || 'USD', rates)
}

// The account's "WS %" is the percentage of the list (ex-factory) price the
// customer pays: 100 = list price as-is, 130 = +30% markup, 90 = 10% discount.
// Stored on profile.ws_discount_pct (legacy field name). Blank / 0 / invalid ⇒
// 100 (full list price) so an unconfigured account is never priced at zero.
// Returns a multiplier (1.0 = list price). No upper clamp — markup is allowed.
export const wsPriceFactor = profile => {
  const pct = Number(profile?.ws_discount_pct)
  return Number.isFinite(pct) && pct > 0 ? pct / 100 : 1
}

// Per-currency decimal rules: HKD max 1 dp, everything else max 2 dp.
export const fmtMoney = (val, cur) => {
  if (val == null || val === '' || Number.isNaN(Number(val))) return '—'
  const dp = cur === 'HKD' ? 1 : 2
  return `${cur} ${(Number(val)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })}`
}
