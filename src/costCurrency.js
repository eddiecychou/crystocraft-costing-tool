// Supplier-cost currencies use the OC's accounting labels. CNY is the ISO
// spelling commonly returned by sourcing tools, while the OC rate table and
// purchase workflow use RMB; treat them as the same Chinese yuan currency.
export const COST_CURRENCIES = ['RMB', 'HKD', 'USD', 'EUR']

export function normalizeCostCurrency(currency) {
  const code = String(currency || '').trim().toUpperCase()
  return code === 'CNY' ? 'RMB' : code
}

export function hkdRateForCostCurrency(currency, rates) {
  const rate = Number(rates?.[normalizeCostCurrency(currency)])
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

// A missing rate is never a 1:1 conversion. Returning null forces the caller
// to surface the data problem instead of publishing a plausible wrong cost.
export function costToHKD(amount, currency, rates) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  const rate = hkdRateForCostCurrency(currency, rates)
  return rate == null ? null : value * rate
}
