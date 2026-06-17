import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Shared Critical Components Library — a single settings doc holds the whole list.
// Shape: { components: [{ code, name, stock_qty, lead_time_weeks }], updatedAt }
//
// Only *business-critical* parts belong here — items that actually drive the
// production promise: long lead time, tooling/mould cost, MOQ, or real supply
// risk (figurine bodies, metal parts, music-box movements, …). Commodity /
// fast-replenishment parts (plating, crystal, gift boxes, screws) are
// deliberately NOT modelled — they don't change what we tell the customer.
//
// A product references components as [{ code, qty_per_unit }] (qty defaults 1).
// Stock lives on the component, so one shared body pool feeds every product
// that uses it (e.g. U0002 body → U0002-001, U0002-236, U0002-230).
const DOC_REF = () => doc(db, 'settings', 'components')

const ASSEMBLY_WEEKS_DEFAULT = 2   // plate + assemble + pack when parts are on hand

const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)

const norm = c => ({
  code: (c.code || '').trim().toUpperCase(),
  name: (c.name || '').trim(),
  stock_qty: numOrNull(c.stock_qty),
  lead_time_weeks: numOrNull(c.lead_time_weeks),
})

export async function loadComponents() {
  try {
    const snap = await getDoc(DOC_REF())
    const arr = snap.exists() ? snap.data().components : []
    return Array.isArray(arr) ? arr.map(norm).filter(c => c.code) : []
  } catch {
    return []
  }
}

export async function saveComponents(list) {
  const clean = (list || []).map(norm).filter(c => c.code)
  const seen = new Set()
  const out = []
  for (const c of clean) {
    if (seen.has(c.code)) continue
    seen.add(c.code)
    out.push(c)
  }
  await setDoc(DOC_REF(), { components: out, updatedAt: serverTimestamp() })
  return out
}

// React hook — loads once on mount.
export function useComponents() {
  const [components, setComponents] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    loadComponents().then(c => { if (alive) { setComponents(c); setLoading(false) } })
    return () => { alive = false }
  }, [])
  return { components, loading, setComponents }
}

export const componentMap = list => Object.fromEntries((list || []).map(c => [c.code, c]))

// ── Derived production signals ───────────────────────────────────────────────

const refsOf = product => (Array.isArray(product?.critical_components) ? product.critical_components : [])
const perUnit = r => { const n = Number(r?.qty_per_unit); return n > 0 ? n : 1 }

// How many finished pieces could be *assembled right now* from component stock,
// limited by the scarcest critical part. Returns { qty, bottleneck } (qty null
// when the product lists no critical components).
export function buildableFromComponents(product, lib) {
  const map = componentMap(lib)
  const refs = refsOf(product)
  if (!refs.length) return { qty: null, bottleneck: null }
  let qty = Infinity, bottleneck = null
  for (const r of refs) {
    const c = map[(r.code || '').toUpperCase()]
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
  const map = componentMap(lib)
  let weeks = null, driver = null
  for (const r of refsOf(product)) {
    const c = map[(r.code || '').toUpperCase()]
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
