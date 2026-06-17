import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
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

// Create (id null/undefined) or update an existing component doc.
export async function saveComponent(id, data) {
  const payload = { ...normComponent(data), updatedAt: serverTimestamp() }
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
