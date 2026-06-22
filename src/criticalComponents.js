import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

// Critical Components Library — promoted from a single settings doc-array to a
// proper per-document collection so it scales to hundreds of parts, each with
// its own image, category, supplier link and notes. The component `code` is the
// ERP item code and is what products reference (no SKU/stock duplication).
//
// Only *business-critical* parts belong here — items that drive the production
// promise: long lead time, tooling/mould cost, MOQ, or supply risk (figurine
// bodies, metal parts, music-box movements). Commodity / fast-replenishment
// parts (plating, crystal, gift boxes) are deliberately NOT modelled.
//
// A product references components as [{ code, qty_per_unit }] (qty defaults 1).
// Stock lives on the component, so one shared body pool feeds every product
// that uses it (e.g. U0002 body → U0002-001, U0002-236, U0002-230).
const COL = () => collection(db, 'range_components')
const LEGACY_DOC = () => doc(db, 'settings', 'components')

const ASSEMBLY_WEEKS_DEFAULT = 2   // plate + assemble + pack when parts are on hand

const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)

// Volume-tier rows on a component cost: [{ min_qty, unit_cost }], same shape as
// corp-gift supplier quotes. Cleaned to valid numeric rows, sorted by min_qty.
const normVolumeTiers = tiers => (Array.isArray(tiers) ? tiers : [])
  .map(t => ({ min_qty: numOrNull(t.min_qty), unit_cost: numOrNull(t.unit_cost) }))
  .filter(t => t.min_qty != null && t.min_qty > 0 && t.unit_cost != null)
  .sort((a, b) => a.min_qty - b.min_qty)

// Normalise a raw record (form or Firestore) into the canonical shape.
export const normComponent = c => ({
  code: (c.code || '').trim().toUpperCase(),
  name: (c.name || '').trim(),
  category: (c.category || '').trim(),
  supplierId: c.supplierId || '',
  supplierName: (c.supplierName || '').trim(),
  notes: (c.notes || '').trim(),
  images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
  stock_qty: numOrNull(c.stock_qty),
  lead_time_weeks: numOrNull(c.lead_time_weeks),
  // Cost — used by Range Costing. A component carries one supplier cost (optional
  // volume tiers + one-time tooling). null cost means "not costed yet".
  unit_cost: numOrNull(c.unit_cost),
  unit_cost_currency: (c.unit_cost_currency || 'RMB').trim() || 'RMB',
  volume_tiers: normVolumeTiers(c.volume_tiers),
  tooling_sample_cost: numOrNull(c.tooling_sample_cost),
  tooling_sample_cost_currency: (c.tooling_sample_cost_currency || c.unit_cost_currency || 'RMB').trim() || 'RMB',
})

const fromDoc = d => ({ id: d.id, ...normComponent(d.data()) })

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function loadComponents() {
  try {
    const snap = await getDocs(query(COL(), orderBy('code')))
    return snap.docs.map(fromDoc)
  } catch {
    return []
  }
}

export async function getComponent(id) {
  const snap = await getDoc(doc(db, 'range_components', id))
  return snap.exists() ? fromDoc(snap) : null
}

// Descriptive (non-cost) fields written by the component editor. Cost fields are
// owned by supplier quotes and denormalised separately, so saving the editor form
// (merge:true) must never overwrite them.
const descriptorOf = c => {
  const n = normComponent(c)
  return {
    code: n.code, name: n.name, category: n.category,
    supplierId: n.supplierId, supplierName: n.supplierName,
    notes: n.notes, images: n.images,
    stock_qty: n.stock_qty, lead_time_weeks: n.lead_time_weeks,
  }
}

// Create (id null/undefined) or update an existing component doc. Only descriptive
// fields are written; cost comes from the preferred supplier quote.
export async function saveComponent(id, data) {
  const payload = { ...descriptorOf(data), updatedAt: serverTimestamp() }
  if (id) {
    await setDoc(doc(db, 'range_components', id), payload, { merge: true })
    return id
  }
  const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteComponent(id) {
  await deleteDoc(doc(db, 'range_components', id))
}

// ── Supplier quotes (subcollection, mirrors corp-gift) ───────────────────────
// range_components/{id}/supplier_quotes/{quoteId}. Each quote carries its own
// screenshots/PDF, OCR-extracted cost, MOQ, volume tiers and lead times. The
// preferred quote's cost is denormalised onto the component doc so the costing
// layer (rangeCosting.js) can read it without a subcollection fetch.
const QUOTES = id => collection(db, 'range_components', id, 'supplier_quotes')

const numOr = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))

export const normQuote = q => ({
  supplier_id: q.supplier_id || '',
  supplier_name: (q.supplier_name || '').trim(),
  unit_cost: numOr(q.unit_cost),
  unit_cost_currency: (q.unit_cost_currency || 'RMB').trim() || 'RMB',
  volume_tiers: normVolumeTiers(q.volume_tiers),
  moq: numOr(q.moq),
  tooling_sample_cost: numOr(q.tooling_sample_cost),
  tooling_sample_cost_currency: (q.tooling_sample_cost_currency || q.unit_cost_currency || 'RMB').trim() || 'RMB',
  sampling_lead_time_days: numOr(q.sampling_lead_time_days),
  tooling_lead_time_days: numOr(q.tooling_lead_time_days),
  production_lead_time_days: numOr(q.production_lead_time_days),
  is_preferred: !!q.is_preferred,
  notes: (q.notes || '').trim(),
  attachments: Array.isArray(q.attachments) ? q.attachments : [],
})

export async function loadComponentQuotes(componentId) {
  try {
    const snap = await getDocs(query(QUOTES(componentId), orderBy('createdAt', 'desc')))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch {
    return []
  }
}

// Cost snapshot copied from the preferred quote onto the component doc.
const denormFrom = q => q ? {
  unit_cost: q.unit_cost ?? null,
  unit_cost_currency: q.unit_cost_currency || 'RMB',
  volume_tiers: normVolumeTiers(q.volume_tiers),
  tooling_sample_cost: q.tooling_sample_cost ?? null,
  tooling_sample_cost_currency: q.tooling_sample_cost_currency || q.unit_cost_currency || 'RMB',
  preferred_supplier_name: q.supplier_name || '',
  preferred_quote_id: q.id || null,
} : {
  unit_cost: null, volume_tiers: [], tooling_sample_cost: null,
  preferred_supplier_name: '', preferred_quote_id: null,
}

// Re-read quotes, mark exactly one preferred (or none), and refresh the
// component's denormalised cost snapshot accordingly.
async function recomputeDenorm(componentId, preferId) {
  const snap = await getDocs(QUOTES(componentId))
  let chosen = null
  await Promise.all(snap.docs.map(d => {
    const pref = preferId != null ? d.id === preferId : !!d.data().is_preferred
    if (pref && !chosen) chosen = { id: d.id, ...d.data() }
    return d.data().is_preferred !== pref ? updateDoc(d.ref, { is_preferred: pref }) : null
  }))
  await updateDoc(doc(db, 'range_components', componentId), {
    ...denormFrom(chosen), updatedAt: serverTimestamp(),
  })
  return chosen
}

export async function saveComponentQuote(componentId, quoteId, data) {
  const payload = { ...normQuote(data), updatedAt: serverTimestamp() }
  let id = quoteId
  if (quoteId) {
    await updateDoc(doc(db, 'range_components', componentId, 'supplier_quotes', quoteId), payload)
  } else {
    const ref = await addDoc(QUOTES(componentId), { ...payload, createdAt: serverTimestamp() })
    id = ref.id
  }
  // Preferred selection (or editing the current preferred) refreshes the snapshot.
  if (payload.is_preferred) await recomputeDenorm(componentId, id)
  else await recomputeDenorm(componentId, null)
  return id
}

export async function setPreferredQuote(componentId, quoteId) {
  await recomputeDenorm(componentId, quoteId)
}

export async function deleteComponentQuote(componentId, quoteId) {
  await deleteDoc(doc(db, 'range_components', componentId, 'supplier_quotes', quoteId))
  await recomputeDenorm(componentId, null)
}

// Bulk create (CSV import / Excel migration). Skips rows with no code.
export async function bulkCreateComponents(rows) {
  const clean = (rows || []).map(normComponent).filter(c => c.code)
  let n = 0
  for (let i = 0; i < clean.length; i += 400) {
    const batch = writeBatch(db)
    for (const c of clean.slice(i, i + 400)) {
      batch.set(doc(COL()), { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      n++
    }
    await batch.commit()
  }
  return n
}

// One-time migration of the old settings/components doc-array into the
// collection. Idempotent: does nothing if the collection already has rows.
export async function migrateLegacyComponents() {
  const existing = await getDocs(COL())
  if (!existing.empty) return 0
  const snap = await getDoc(LEGACY_DOC())
  const arr = snap.exists() ? snap.data().components : []
  if (!Array.isArray(arr) || !arr.length) return 0
  return bulkCreateComponents(arr)
}

// React hook — live collection. Runs the legacy migration once on first mount.
export function useComponents() {
  const [components, setComponents] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let unsub = () => {}
    migrateLegacyComponents().finally(() => {
      unsub = onSnapshot(
        query(COL(), orderBy('code')),
        snap => { setComponents(snap.docs.map(fromDoc)); setLoading(false) },
        () => setLoading(false),
      )
    })
    return () => unsub()
  }, [])
  return { components, loading }
}

export const componentMap = list => Object.fromEntries((list || []).map(c => [c.code, c]))
export const componentById = list => Object.fromEntries((list || []).map(c => [c.id, c]))

// Resolve a product's component reference to the live library record. Prefers
// the stable doc id (so renaming a component's code never breaks the link) and
// falls back to code for legacy references saved before ids were stored.
export function resolveRef(ref, lib) {
  if (!ref) return null
  const byId = componentById(lib)
  if (ref.id && byId[ref.id]) return byId[ref.id]
  const byCode = componentMap(lib)
  return byCode[(ref.code || '').toUpperCase()] || null
}

// ── Derived production signals ───────────────────────────────────────────────

const refsOf = product => (Array.isArray(product?.critical_components) ? product.critical_components : [])
const perUnit = r => { const n = Number(r?.qty_per_unit); return n > 0 ? n : 1 }

// How many finished pieces could be *assembled right now* from component stock,
// limited by the scarcest critical part. Returns { qty, bottleneck } (qty null
// when the product lists no critical components).
export function buildableFromComponents(product, lib) {
  const refs = refsOf(product)
  if (!refs.length) return { qty: null, bottleneck: null }
  let qty = Infinity, bottleneck = null
  for (const r of refs) {
    const c = resolveRef(r, lib)
    if (!c) continue
    const stock = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    const canMake = Math.floor(stock / perUnit(r))
    if (canMake < qty) { qty = canMake; bottleneck = c.code }
  }
  return { qty: Number.isFinite(qty) ? qty : null, bottleneck }
}

// Longest lead among the critical parts that stock can't currently cover.
// Returns { weeks, driver } — the limiting part governs the make-from-scratch
// promise. weeks is null if every critical part is already in stock.
export function makeLeadWeeks(product, lib) {
  let weeks = null, driver = null
  for (const r of refsOf(product)) {
    const c = resolveRef(r, lib)
    if (!c) continue
    const stock = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    if (stock >= perUnit(r)) continue            // this part is covered
    const lw = Number.isFinite(c.lead_time_weeks) ? c.lead_time_weeks : 0
    if (weeks == null || lw > weeks) { weeks = lw; driver = c.code }
  }
  return { weeks, driver }
}

// Finished, ready-to-ship pieces (already plated). Mirrors the Range list:
// plating pool + unplated per-SKU stock, else per-variant stock.
export function finishedStockOf(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : []
  const pool = product?.plating_stock && Object.keys(product.plating_stock).length ? product.plating_stock : null
  const pos = n => (Number(n) > 0 ? Number(n) : 0)
  if (pool) {
    const poolSum = Object.values(pool).reduce((s, n) => s + pos(n), 0)
    const unplated = variants.reduce((s, v) => s + (!(v.plating_code || '').trim() ? pos(v.stock_finished) : 0), 0)
    return poolSum + unplated
  }
  return variants.reduce((s, v) => s + pos(v.stock_finished), 0)
}

// Compose the single customer-facing promise from lifecycle status + live
// availability. A non-empty product.delivery_note overrides everything.
// Returns { promise, leadWeeks, finished, buildable, bottleneck }.
export function productAvailability(product, lib) {
  const status = product?.status === 'stock' ? 'stock' : 'active'   // 'active' = Made to Order
  const finished = finishedStockOf(product)
  const refs = refsOf(product)
  const { qty: buildable, bottleneck } = buildableFromComponents(product, lib)
  const make = makeLeadWeeks(product, lib)
  const assembly = numOrNull(product?.lead_time_weeks) ?? ASSEMBLY_WEEKS_DEFAULT
  const moq = numOrNull(product?.moq)
  const moqTxt = moq ? `, MOQ ${moq}` : ''

  const note = (product?.delivery_note || '').trim()
  if (note) return { promise: note, leadWeeks: null, finished, buildable, bottleneck }

  let promise, leadWeeks
  if (status === 'stock') {                       // Last Stock — retired
    promise = finished > 0 ? `Final stock — only ${finished} left, no re-runs.` : 'Sold out — discontinued.'
    leadWeeks = finished > 0 ? 1 : null
  } else if (finished > 0) {                       // Made to Order, but we have ready stock
    promise = 'In stock — ships in ~1 week.'
    leadWeeks = 1
  } else if (!refs.length) {                       // no critical parts tracked
    promise = `Made to order — ~${assembly} weeks${moqTxt}.`
    leadWeeks = assembly
  } else if (buildable && buildable > 0) {         // parts on hand, just assemble
    promise = `Made to order — ~${assembly} weeks${moqTxt} (${buildable} buildable from stock now).`
    leadWeeks = assembly
  } else {                                         // must produce the scarce part first
    const w = make.weeks != null ? make.weeks : assembly
    const drv = make.driver ? ` — lead set by ${make.driver}` : ''
    promise = `Made to order — ~${w} weeks${moqTxt}${drv}.`
    leadWeeks = w
  }
  return { promise, leadWeeks, finished, buildable, bottleneck }
}
