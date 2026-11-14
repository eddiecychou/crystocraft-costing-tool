import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, runTransaction,
} from 'firebase/firestore'
import { db } from './firebase'
import { orderRequestAction } from './shippingOrderApi.js'
import { FREIGHT_INCOTERMS, freightPackingBasis, normFreightQuote } from './freightQuoteModel.js'

export { FREIGHT_INCOTERMS, QUOTE_SOURCES, freightScenarioCargo, normFreightQuote } from './freightQuoteModel.js'

// Logistics & Freight — vendor knowledge base + freight-quote cost history.
// Phase 13.x of the Shipping module. Deliberately NO standing rate cards
// (guardrail 7): we store coverage tags + reliability + actual past quotes only;
// live price always comes from a fresh RFQ.
//
// Two collections:
//   logistics_vendors — the 50–100 specialist forwarders (KB)
//   freight_quotes    — every quote (RFQ reply or WeChat bootstrap); this IS the
//                       cost history, normalised to HKD via settings/exchange_rates.

// ── Constants ─────────────────────────────────────────────────────────────────

// Freight modes. Value is stored; label is shown.
export const FREIGHT_MODES = [
  { value: 'courier_direct',       label: 'Courier (direct)' },
  { value: 'courier_consolidated', label: 'Courier (consolidated)' },
  { value: 'air',                  label: 'Air freight' },
  { value: 'sea_lcl',              label: 'Sea LCL' },
  { value: 'sea_fcl',              label: 'Sea FCL' },
  { value: 'rail_europe',          label: 'Rail (Europe)' },
  { value: 'truck_regional',       label: 'Truck (regional)' },
]
export const modeLabel = v => FREIGHT_MODES.find(m => m.value === v)?.label || v

// Graded coverage strength for a region/country a vendor serves.
export const COVERAGE_STRENGTH = [
  { value: 'strong', label: 'Strong', style: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'ok',     label: 'OK',     style: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'avoid',  label: 'Avoid',  style: 'bg-red-50 text-red-600 border-red-200' },
]
export const strengthOf = v => COVERAGE_STRENGTH.find(s => s.value === v) || COVERAGE_STRENGTH[1]

const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)
const str = v => (v == null ? '' : String(v)).trim()

// ── logistics_vendors ─────────────────────────────────────────────────────────

const VENDORS = () => collection(db, 'logistics_vendors')

// One coverage entry: a region/country + graded strength + optional mode subset.
const normCoverage = c => ({
  region: str(c.region),
  strength: ['strong', 'ok', 'avoid'].includes(c.strength) ? c.strength : 'ok',
  modes: Array.isArray(c.modes) ? c.modes.filter(Boolean) : [],
  notes: str(c.notes),
})

const normContact = c => ({
  name: str(c.name), wechat: str(c.wechat), whatsapp: str(c.whatsapp),
  phone: str(c.phone), email: str(c.email),
})

export const normVendor = v => ({
  name: str(v.name),
  name_cn: str(v.name_cn),
  contacts: (Array.isArray(v.contacts) ? v.contacts : []).map(normContact)
    .filter(c => c.name || c.wechat || c.whatsapp || c.phone || c.email),
  modes: Array.isArray(v.modes) ? v.modes.filter(Boolean) : [],
  coverage: (Array.isArray(v.coverage) ? v.coverage : []).map(normCoverage)
    .filter(c => c.region),
  incoterms_supported: (Array.isArray(v.incoterms_supported) ? v.incoterms_supported : [])
    .filter(x => FREIGHT_INCOTERMS.includes(x)),
  payment_terms: str(v.payment_terms),
  reliability_rating: numOrNull(v.reliability_rating),  // 1–5, set by hand
  damage_notes: str(v.damage_notes),
  notes: str(v.notes),
})

const vendorFromDoc = d => ({ id: d.id, ...normVendor(d.data()) })

export async function loadVendors() {
  const snap = await getDocsFromServer(query(VENDORS(), orderBy('name')))
  return snap.docs.map(vendorFromDoc)
}

export async function getVendor(id) {
  const snap = await getDoc(doc(db, 'logistics_vendors', id))
  return snap.exists() ? vendorFromDoc(snap) : null
}

export async function saveVendor(id, data) {
  const payload = { ...normVendor(data), updatedAt: serverTimestamp() }
  if (id) {
    await updateDoc(doc(db, 'logistics_vendors', id), payload)
    return id
  }
  const ref = await addDoc(VENDORS(), { ...payload, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteVendor(id) {
  await deleteDoc(doc(db, 'logistics_vendors', id))
}

// Live KB hook (sorted by name).
export function useVendors() {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(
    query(VENDORS(), orderBy('name')),
    snap => { setVendors(snap.docs.map(vendorFromDoc)); setLoading(false) },
    () => setLoading(false),
  ), [])
  return { vendors, loading }
}

// ── freight_quotes (cost history) ─────────────────────────────────────────────

const QUOTES = () => collection(db, 'freight_quotes')
const quoteRef = id => doc(QUOTES(), id)
const decisionRef = orderId => doc(db, 'freight_decisions', orderId)

const quoteFromDoc = d => ({ ...d.data(), id: d.id })

export function newFreightQuoteId() {
  return doc(QUOTES()).id
}

export async function createOrderFreightQuote(id, data, rates, scenarioSnapshot) {
  const quote = normFreightQuote({ ...data, is_chosen: false }, rates)
  return orderRequestAction('create_freight_quote', {
    order_id: quote.order_id,
    id,
    quote,
    basis: scenarioSnapshot ? freightPackingBasis(scenarioSnapshot) : null,
  })
}

// Legacy choices are read until the first explicit decision. An ambiguous
// legacy order is shown for review and is resolved by choosing a quote.
export function freightChoice(quotes, decision) {
  if (decision) return { chosenId: decision.quote_id, ambiguous: false }
  const legacy = quotes.filter(quote => quote.is_chosen)
  return { chosenId: legacy.length === 1 ? legacy[0].id : null, ambiguous: legacy.length > 1 }
}

export async function loadOrderFreight(orderId) {
  const [snap, decision] = await Promise.all([
    getDocsFromServer(query(QUOTES(), where('order_id', '==', orderId))),
    getDocFromServer(decisionRef(orderId)),
  ])
  // Sort client-side to avoid a composite index.
  const quotes = snap.docs.map(quoteFromDoc)
    .sort((a, b) => (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity))
  return { quotes, choice: freightChoice(quotes, decision.data()) }
}

export async function setFreightChoice(orderId, id, choose) {
  const ref = decisionRef(orderId)
  return runTransaction(db, async tx => {
    const current = (await tx.get(ref)).data()
    const quote = (await tx.get(quoteRef(id))).data()
    if (quote?.order_id !== orderId) throw Error('Freight quote is no longer available for this order.')
    const chosenId = current ? current.quote_id : (quote.is_chosen ? id : null)
    // A stale Unmark must never clear a different quote chosen in another tab.
    if (!choose && chosenId !== id) return { chosenId, ambiguous: false }
    const next = choose ? id : null
    if (!current || chosenId !== next) tx.set(ref, { quote_id: next, updated_at: serverTimestamp() })
    return { chosenId: next, ambiguous: false }
  })
}

export async function deleteOrderFreightQuote(orderId, id) {
  const ref = decisionRef(orderId)
  return runTransaction(db, async tx => {
    const current = (await tx.get(ref)).data()
    const target = quoteRef(id)
    const quote = (await tx.get(target)).data()
    if (!quote) return current
    if (quote.order_id !== orderId) throw Error('Freight quote belongs to another order.')
    if (current?.quote_id === id) {
      tx.set(ref, { quote_id: null, updated_at: serverTimestamp() })
      tx.delete(target)
      return { quote_id: null }
    }
    tx.delete(target)
    return current
  })
}

// Cost history for a vendor, or for a lane (dest country) — both feed routing.
export async function loadVendorQuotes(vendorId) {
  try {
    const snap = await getDocs(query(QUOTES(), where('vendor_id', '==', vendorId)))
    return snap.docs.map(quoteFromDoc)
  } catch (e) {
    console.error('loadVendorQuotes failed', e)
    return []
  }
}

export async function loadAllQuotes() {
  try {
    const snap = await getDocs(query(QUOTES(), orderBy('createdAt', 'desc')))
    return snap.docs.map(quoteFromDoc)
  } catch (e) {
    console.error('loadAllQuotes failed', e)
    return []
  }
}
