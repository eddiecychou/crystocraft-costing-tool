import { collection, doc, getDocsFromServer, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { costToHKD, isPositiveExchangeRate, normalizeCostCurrency } from './costCurrency'
import { HKD_ONLY, loadConfiguredExchangeRates } from './configuredExchangeRates'
import { isQuoteChoiceSaved } from './quoteProductSearch'
import { quoteItemKey, rangeQuoteItem, rangeWholesaleUsd } from './rangeQuote'

const quoteCurrency = quote => quote.quote_currency || 'HKD'
const quoteRates = quote => ({ HKD: 1, RMB: quote.rmb_to_hkd, USD: quote.usd_to_hkd, EUR: quote.eur_to_hkd })
const savedChoiceKeys = items => new Set(items.map(quoteItemKey).filter(Boolean))

async function readSavedLines(itemsRef) {
  const snapshot = await getDocsFromServer(itemsRef)
  if (snapshot.metadata.hasPendingWrites) throw new Error('Wait for the quote lines to finish saving, then retry.')
  return snapshot.docs.map(item => ({ ...item.data(), id: item.id }))
}

function mutateQuoteItems(quoteId, changesFor) {
  const quoteRef = doc(db, 'client_quotes', quoteId)
  const itemsRef = collection(db, 'client_quotes', quoteId, 'items')
  return runTransaction(db, async transaction => {
    // All membership changes in Quote Detail advance the same header version.
    // The Web SDK lists the collection separately. Repeat the list on every
    // transaction attempt, after reading the header, to include competing saves.
    const header = await transaction.get(quoteRef)
    if (!header.exists()) throw new Error('This quote could not be found. Reopen it before saving.')
    const items = await readSavedLines(itemsRef)
    const { additions = [], removal } = changesFor(header.data(), items)
    const existingIds = new Set(items.map(item => item.id))
    const removed = removal && existingIds.has(removal)

    for (const { ref, data } of additions) {
      if (existingIds.has(ref.id)) throw new Error('A quote line already uses this ID. Reload the quote before saving.')
      transaction.set(ref, { ...data, createdAt: serverTimestamp() })
    }
    if (removed) transaction.delete(doc(itemsRef, removal))
    const itemCount = items.length + additions.length - (removed ? 1 : 0)
    if (additions.length || removed || itemCount !== header.data().item_count) {
      transaction.update(quoteRef, { item_count: itemCount, updatedAt: serverTimestamp() })
    }
    return itemCount
  })
}

function requireQuoteRate(currency, rates, name) {
  const raw = rates[currency]
  const rate = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
  if (!isPositiveExchangeRate(rate)) throw new Error(`Cannot add ${name}. This quote has no valid agreed ${currency} to HKD rate.`)
  return rate
}

async function prepareCorporateChoice(choice, currency, rates) {
  let tiers, parts
  try {
    const [tierSnapshot, componentSnapshot] = await Promise.all([
      getDocsFromServer(query(collection(db, 'products', choice.id, 'pricing_tiers'), orderBy('quantity'))),
      getDocsFromServer(collection(db, 'products', choice.id, 'components')),
    ])
    tiers = tierSnapshot.docs.map(tier => tier.data())
    parts = await Promise.all(componentSnapshot.docs.map(async component => {
      const quotes = await getDocsFromServer(collection(component.ref, 'supplier_quotes'))
      const preferred = quotes.docs.map(quote => quote.data()).find(quote => quote.is_preferred)
      return { preferred, qty: Number(component.data().qty_per_product) || 1 }
    }))
  } catch {
    throw new Error(`Cannot add ${choice.name}. Its pricing tiers or supplier costs could not be loaded.`)
  }

  const row = {
    product_id: choice.id,
    product_collection: 'products',
    product_name: choice.name,
    product_category: choice.category,
    product_description: choice.description || '',
    hero_image: choice.heroImage || null,
    product_unit: choice.unit || 'pcs',
    tiers: tiers.length ? tiers.map(tier => {
      const hkd = tier.price_hkd || 0
      let price = hkd
      // A legacy sell_price in the quote currency is already the selling price.
      if (tier.sell_currency === currency && tier.sell_price != null) price = tier.sell_price
      else if (currency !== 'HKD' && Number(hkd) !== 0) {
        price = +(hkd / requireQuoteRate(currency, rates, choice.name)).toFixed(2)
      }
      if (!Number.isFinite(Number(price))) throw new Error(`Cannot add ${choice.name}. A tier price is invalid.`)
      return { quantity: tier.quantity || 200, price, currency }
    }) : [{ quantity: 200, price: 0, currency }],
    status: choice.status,
  }
  const costs = parts.flatMap(({ preferred, qty }) => {
    if (!preferred) return []
    const amounts = []
    if (preferred.unit_cost) amounts.push({ amount: preferred.unit_cost, currency: preferred.unit_cost_currency, qty })
    if (preferred.tooling_sample_cost) amounts.push({ amount: preferred.tooling_sample_cost, currency: preferred.tooling_sample_cost_currency, qty: 1, tooling: true })
    return amounts
  })
  return { row, costs }
}

async function prepareCatalogueLines(itemsRef, choices, currency, rates) {
  const prepared = await Promise.all(choices.map(async choice => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(choice.key))
    const lineId = 'catalogue-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const ref = doc(itemsRef, lineId)
    if (choice.source !== 'range_products') return { ref, ...await prepareCorporateChoice(choice, currency, rates) }

    let conversionRates = rates
    if (currency !== 'USD' && rangeWholesaleUsd(choice) != null) {
      conversionRates = { ...rates, USD: requireQuoteRate('USD', rates, choice.name), [currency]: requireQuoteRate(currency, rates, choice.name) }
    }
    const row = rangeQuoteItem(choice, currency, conversionRates)
    if (!Number.isFinite(Number(row.tiers[0].price))) throw new Error(`Cannot add ${choice.name}. Its converted price is invalid.`)
    return { ref, row, costs: [] }
  }))

  let supplierRates = HKD_ONLY
  const foreign = prepared.find(({ costs }) => costs.some(cost => normalizeCostCurrency(cost.currency) !== 'HKD'))
  if (foreign) {
    try {
      supplierRates = (await loadConfiguredExchangeRates()).rates
    } catch {
      throw new Error(`Cannot add ${foreign.row.product_name}. Supplier exchange rates could not be loaded from Settings.`)
    }
  }
  return prepared.map(({ ref, row, costs }) => {
    if (row.product_collection === 'range_products') return { ref, data: row }
    let unit = 0
    let tooling = 0
    for (const cost of costs) {
      const hkd = costToHKD(cost.amount, cost.currency, supplierRates)
      if (!Number.isFinite(hkd)) throw new Error(`Cannot add ${row.product_name}. Check the supplier cost and HKD rate for ${normalizeCostCurrency(cost.currency) || 'the missing currency'}.`)
      if (cost.tooling) tooling += hkd
      else unit += hkd * cost.qty
    }
    if (!Number.isFinite(unit) || !Number.isFinite(tooling)) throw new Error(`Cannot add ${row.product_name}. Its total supplier cost is invalid.`)
    return { ref, data: { ...row, unit_cost_hkd: unit || null, tooling_cost_hkd: tooling || null } }
  })
}

export async function addQuoteProducts(quoteId, quote, selection) {
  const itemsRef = collection(db, 'client_quotes', quoteId, 'items')
  const currency = quoteCurrency(quote)
  const rates = quoteRates(quote)
  const choices = [...new Map(selection.map(choice => [choice.key, choice])).values()]
  // A retry can recognize committed choices before re-reading their costs or rates.
  const existing = savedChoiceKeys(await readSavedLines(itemsRef))
  const missing = choices.filter(choice => !isQuoteChoiceSaved(choice, existing))
  const prepared = await prepareCatalogueLines(itemsRef, missing, currency, rates)
  const byKey = new Map(missing.map((choice, index) => [choice.key, prepared[index]]))

  return mutateQuoteItems(quoteId, (header, items) => {
    const latestRates = quoteRates(header)
    if (quoteCurrency(header) !== currency || Object.keys(rates).some(code => !Object.is(rates[code], latestRates[code]))) {
      throw new Error('The quote currency or agreed rates changed. Reload the quote before adding products.')
    }
    const saved = savedChoiceKeys(items)
    const additions = choices.filter(choice => !isQuoteChoiceSaved(choice, saved)).map(choice => {
      const line = byKey.get(choice.key)
      if (!line) throw new Error('A selected line was removed while adding products. Review the quote and retry.')
      return line
    })
    return { additions }
  })
}

export function addCustomQuoteItem(quoteId) {
  const ref = doc(collection(db, 'client_quotes', quoteId, 'items'))
  return mutateQuoteItems(quoteId, quote => ({ additions: [{ ref, data: {
    product_id: null, product_name: '', product_category: '', product_description: '',
    hero_image: null, product_unit: 'pcs', unit_cost_hkd: null, tooling_cost_hkd: null,
    tiers: [{ quantity: '', price: '', currency: quoteCurrency(quote) }],
    is_custom: true, status: 'active',
  } }] }))
}

export function removeQuoteItem(quoteId, itemId) {
  return mutateQuoteItems(quoteId, () => ({ removal: itemId }))
}
