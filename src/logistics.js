import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

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

// Incoterms a forwarder can quote on (subset relevant to freight; the full
// commercial set lives on the order).
export const FREIGHT_INCOTERMS = ['FOB', 'DAP', 'DDP']

export const QUOTE_SOURCES = [
  { value: 'rfq',              label: 'RFQ reply' },
  { value: 'wechat_bootstrap', label: 'WeChat history' },
  { value: 'manual',           label: 'Manual entry' },
]

const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)
const str = v => (v == null ? '' : String(v)).trim()

// HKD per 1 unit of currency (same convention as currency.js / rangeCosting.js).
// CNY is aliased to the RMB rate — same currency, and the rates table (settings/
// exchange_rates) only carries one entry for it; FreightComparison.jsx's own
// currency picker offers both codes.
//
// `rates?.[currency] || 1` used to silently treat ANY currency missing from the
// rates table as 1:1 with HKD — comparing a USD quote against an RMB quote as
// if both were HKD. Returns null now instead (bug-fix pack B-05), so a caller
// can show "rate unavailable" rather than a wrong number that looks legitimate.
const toHKD = (amount, currency, rates) => {
  const a = numOrNull(amount)
  if (a == null) return null
  if (currency === 'HKD') return a
  const rate = rates?.[currency === 'CNY' ? 'RMB' : currency]
  return Number.isFinite(rate) ? a * rate : null
}

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
  try {
    const snap = await getDocs(query(VENDORS(), orderBy('name')))
    return snap.docs.map(vendorFromDoc)
  } catch (e) {
    console.error('loadVendors failed', e)
    return []
  }
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

export const normFreightQuote = (q, rates) => {
  const total = numOrNull(q.quoted_total)
  const currency = str(q.currency) || 'USD'
  return {
    vendor_id: str(q.vendor_id),
    vendor_name: str(q.vendor_name),
    order_id: q.order_id || null,
    scenario_id: q.scenario_id || null,
    scenario_label: str(q.scenario_label),
    lane: {
      origin: str(q.lane?.origin) || 'Shenzhen',
      dest_country: str(q.lane?.dest_country),
      dest_city: str(q.lane?.dest_city),
    },
    mode: str(q.mode),
    incoterm: FREIGHT_INCOTERMS.includes(q.incoterm) ? q.incoterm : 'FOB',
    cargo_basis: {
      chargeable_weight_kg: numOrNull(q.cargo_basis?.chargeable_weight_kg),
      cbm: numOrNull(q.cargo_basis?.cbm),
      cartons: numOrNull(q.cargo_basis?.cartons),
    },
    quoted_total: total,
    currency,
    // Normalised to HKD so quotes across currencies are comparable in history.
    quoted_total_hkd: rates ? toHKD(total, currency, rates) : numOrNull(q.quoted_total_hkd),
    breakdown: {
      freight: numOrNull(q.breakdown?.freight),
      destination_charges: numOrNull(q.breakdown?.destination_charges),
      customs: numOrNull(q.breakdown?.customs),
      duties_included: !!q.breakdown?.duties_included,
    },
    transit_days: numOrNull(q.transit_days),
    valid_until: q.valid_until || null,
    source: QUOTE_SOURCES.some(s => s.value === q.source) ? q.source : 'manual',
    source_file: q.source_file || null,
    quote_date: q.quote_date || null,
    is_chosen: !!q.is_chosen,
    decision_notes: str(q.decision_notes),
  }
}

const quoteFromDoc = d => ({ id: d.id, ...d.data() })

export async function saveFreightQuote(id, data, rates) {
  const payload = { ...normFreightQuote(data, rates), updatedAt: serverTimestamp() }
  if (id) {
    await updateDoc(doc(db, 'freight_quotes', id), payload)
    return id
  }
  const ref = await addDoc(QUOTES(), { ...payload, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteFreightQuote(id) {
  await deleteDoc(doc(db, 'freight_quotes', id))
}

// All freight quotes for a specific order (feeds P-3 comparison matrix).
// NOTE: `where` on order_id + `orderBy` on createdAt would need a COMPOSITE
// index, which doesn't exist (indexes here are created by hand — there's no
// firestore.indexes.json). That query throws failed-precondition, and the
// catch below turned it into a silent empty list: quotes saved fine but the
// tab always showed "No freight quotes yet". So sort client-side instead —
// same approach getPackingScenariosByOrder() already uses, and these lists
// are a handful of rows per order.
export async function loadOrderQuotes(orderId) {
  try {
    const snap = await getDocs(query(QUOTES(), where('order_id', '==', orderId)))
    return snap.docs
      .map(quoteFromDoc)
      // Newest first. A just-saved doc's serverTimestamp may still be pending
      // (null) locally — treat that as newest so it doesn't jump to the bottom.
      .sort((a, b) => (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity))
  } catch (e) {
    console.error('loadOrderQuotes failed', e)
    return []
  }
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
