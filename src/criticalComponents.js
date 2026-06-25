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
  // Plating this component belongs to (G/C/R/A/…); blank = shared across every
  // plating (bodies, NFC chips, gift boxes). A product ref may still override,
  // but normally plating is a property of the component (gold/chrome are distinct
  // ERP item codes with distinct cost). See Procurement spec §0.2 Decision 2.
  plating_code: (c.plating_code || '').trim().toUpperCase(),
  supplierId: c.supplierId || '',
  supplierName: (c.supplierName || '').trim(),
  notes: (c.notes || '').trim(),
  images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
  stock_qty: numOrNull(c.stock_qty),
  lead_time_weeks: numOrNull(c.lead_time_weeks),
  // Product item codes that use this part as their main component — a display
  // hint stamped by the stock-list import (the canonical BOM link lives on the
  // product's critical_components). Not written by the component editor.
  used_by: Array.isArray(c.used_by) ? c.used_by.filter(Boolean) : [],
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
    plating_code: n.plating_code,
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

// ── Product matching for the stock-list import ───────────────────────────────
// Figurine item codes are structured: "D0001-001-C" = design_code "D0001" +
// format "001" + plating "C". We match on design+format, brand-agnostically
// (the sheet's brand letter — D/U/A/M — may differ from the stored product's),
// so we also index the brand-stripped key.
//
// Strip ONLY the leading brand letter (one char). The app's convention is
// brand = first letter, an optional 2nd letter is the *body* type which is part
// of the design identity — so "UA001"/"UB001" must stay distinct from "U0001"
// and from each other (matching constants.brandLetter / bodyLetter).
const stripBrandLetters = s => (s == null ? '' : String(s)).toUpperCase().replace(/[\s_]/g, '').replace(/^[A-Z]/, '')

export function buildProductIndex(rangeProducts) {
  const idx = {}
  const put = (k, p) => { const key = (k || '').trim().toUpperCase(); if (key && !(key in idx)) idx[key] = p }
  for (const p of rangeProducts || []) {
    const fc = (p.format_code || '').toUpperCase()
    const bases = new Set()
    if (p.design_code) bases.add(p.design_code)
    if (p.brand_code || p.design_no) bases.add(`${p.brand_code || ''}${p.design_no || ''}`)
    if (p.design_no) bases.add(p.design_no)
    for (const b of bases) {
      const B = String(b).toUpperCase(), S = stripBrandLetters(b)
      put(`${B}-${fc}`, p); put(B, p)
      if (S) { put(`${S}-${fc}`, p); put(S, p) }
    }
  }
  return idx
}

export function matchProductCode(itemCode, index) {
  const code = (itemCode == null ? '' : String(itemCode)).trim().toUpperCase()
  if (!code || !index) return null
  const parts = code.split('-')
  const p0 = parts[0] || '', p1 = parts[1] || ''
  const s0 = p0.replace(/^[A-Z]/, '')   // strip only the brand letter (keep body letter)
  const cands = []
  if (p1) cands.push(`${p0}-${p1}`, `${s0}-${p1}`)   // design+format (brand & brand-stripped)
  cands.push(p0, s0)                                  // design only (fallback)
  for (const c of cands) { if (c && index[c]) return index[c] }
  return null
}

// Idempotent stock-list import (component master + BOM linking). Rows:
// [{ product_item_code, plating_code, code, name, stock_qty }].
//
//  1. Upsert each component (keyed on `code`): existing → update stock_qty +
//     plating_code (+ name only when blank, + used_by); new → create. Cost is
//     never touched (owned by supplier quotes).
//  2. Link products: each row's product_item_code is resolved via `matchProduct`
//     (passed in to avoid a shipping↔components import cycle); the component is
//     added to that product's critical_components[] (qty_per_unit 1, plating
//     inferred from the component). Existing refs are preserved/de-duped by code.
//  3. Stamp `used_by` (the product codes) onto the component for display.
//
// Safe to re-run as a stock-take. Returns { created, updated, productsMatched,
// productsUnmatched, unmatched: [codes] }.
export async function importStockList(rows, rangeProducts) {
  const norm = s => (s == null ? '' : String(s)).trim().toUpperCase()
  const productIndex = buildProductIndex(rangeProducts)
  const clean = (rows || []).map(r => ({
    product_item_code: norm(r.product_item_code),
    plating_code: norm(r.plating_code),
    code: norm(r.code),
    name: (r.name || '').trim(),
    stock_qty: numOrNull(r.stock_qty),
  })).filter(r => r.code)
  if (!clean.length) return { created: 0, updated: 0, productsMatched: 0, productsUnmatched: 0, unmatched: [] }

  // Dedupe components by code; collect the product codes that use each.
  const compByCode = {}
  for (const r of clean) {
    let c = compByCode[r.code]
    if (!c) c = compByCode[r.code] = { name: r.name, plating_code: r.plating_code, stock_qty: r.stock_qty, used_by: new Set() }
    if (r.product_item_code) c.used_by.add(r.product_item_code)
  }

  // Existing components by code → { id, hasName }.
  const snap = await getDocs(COL())
  const existingByCode = {}
  for (const d of snap.docs) {
    const code = norm(d.data().code)
    if (code && !(code in existingByCode)) existingByCode[code] = { id: d.id, hasName: !!(d.data().name || '').trim() }
  }

  // Assign a doc id per code (reuse existing, or pre-generate for new ones so
  // product refs can point at them in the same batch).
  const codeToId = {}
  const ops = []   // { ref, data, merge }
  let created = 0, updated = 0
  for (const [code, c] of Object.entries(compByCode)) {
    const used_by = [...c.used_by]
    const ex = existingByCode[code]
    if (ex) {
      codeToId[code] = ex.id
      const data = { plating_code: c.plating_code, stock_qty: c.stock_qty, used_by, updatedAt: serverTimestamp() }
      if (!ex.hasName && c.name) data.name = c.name
      ops.push({ ref: doc(db, 'range_components', ex.id), data, merge: true })
      updated++
    } else {
      const ref = doc(COL())
      codeToId[code] = ref.id
      ops.push({ ref, data: {
        code, name: c.name, plating_code: c.plating_code, stock_qty: c.stock_qty, used_by,
        category: '', supplierId: '', supplierName: '', notes: '', images: [],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, merge: false })
      created++
    }
  }

  // Resolve product links and merge refs into each matched product.
  const productById = {}            // id → { product, codes:Set }
  const unmatched = []
  const seenUnmatched = new Set()
  for (const r of clean) {
    if (!r.product_item_code) continue
    const p = matchProductCode(r.product_item_code, productIndex)
    if (!p) {
      if (!seenUnmatched.has(r.product_item_code)) { seenUnmatched.add(r.product_item_code); unmatched.push(r.product_item_code) }
      continue
    }
    let pl = productById[p.id]
    if (!pl) pl = productById[p.id] = { product: p, codes: new Set() }
    pl.codes.add(r.code)
  }
  for (const { product, codes } of Object.values(productById)) {
    const refs = Array.isArray(product.critical_components) ? product.critical_components : []
    // Patch plating_code on existing refs that were linked without it (old import).
    const patchedRefs = refs.map(r => {
      if (r.plating_code) return r                        // already has an explicit override — leave it
      const comp = compByCode[norm(r.code)]
      return comp?.plating_code ? { ...r, plating_code: comp.plating_code } : r
    })
    const have = new Set(refs.map(x => norm(x.code)))
    const additions = [...codes].filter(code => !have.has(code))
      .map(code => ({ id: codeToId[code] || '', code, qty_per_unit: 1, plating_code: compByCode[code]?.plating_code || '' }))
    if (additions.length || patchedRefs.some((r, i) => r !== refs[i])) {
      ops.push({ ref: doc(db, 'range_products', product.id), data: { critical_components: [...patchedRefs, ...additions] }, merge: true })
    }
  }

  // Commit in batches of ≤400.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + 400)) batch.set(op.ref, op.data, { merge: op.merge })
    await batch.commit()
  }

  return { created, updated, productsMatched: Object.keys(productById).length, productsUnmatched: unmatched.length, unmatched }
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
// Effective plating of a ref: the ref's explicit override wins; otherwise it is
// inferred from the resolved component's own plating_code (Decision 2). Blank ⇒
// shared part. `lib` is needed for the inference.
const refPlating = (r, lib) => (r.plating_code || resolveRef(r, lib)?.plating_code || '').trim().toUpperCase()
const isShared = (r, lib) => !refPlating(r, lib) // no plating ⇒ applies to all variants
const platingsTagged = (refs, lib) => [...new Set(refs.map(r => refPlating(r, lib)).filter(Boolean))]

// How many finished pieces could be *assembled right now* from component stock.
// Returns { qty, bottleneck } (qty null when the product lists no critical parts).
//
// When some parts are plating-specific, a finished piece of plating P needs the
// shared parts + the parts tagged P only — NOT the parts for other platings. We
// roll up to one product number: total buildable = Σ over platings of the per-
// plating buildable, capped by the shared-parts limit (a shared body pool is
// consumed across every plating, so the product can never build more than the
// shared stock allows in total). "Soonest plating wins" semantics.
export function buildableFromComponents(product, lib) {
  const refs = refsOf(product)
  if (!refs.length) return { qty: null, bottleneck: null }

  // canMake for one ref: floor(stock / qty_per_unit), plus its code for bottleneck.
  const canMakeOf = r => {
    const c = resolveRef(r, lib)
    if (!c) return null
    const stock = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    return { n: Math.floor(stock / perUnit(r)), code: c.code }
  }
  // Scarcest part across a list ⇒ { q, code } (q = Infinity when list is empty).
  const minOver = list => {
    let q = Infinity, code = null
    for (const r of list) { const m = canMakeOf(r); if (!m) continue; if (m.n < q) { q = m.n; code = m.code } }
    return { q, code }
  }

  // Fast path / unchanged behaviour: no plating-specific parts ⇒ one shared group.
  const platings = platingsTagged(refs, lib)
  if (!platings.length) {
    const { q, code } = minOver(refs)
    return { qty: Number.isFinite(q) ? q : null, bottleneck: code }
  }

  const sharedCeiling = minOver(refs.filter(r => isShared(r, lib)))
  const sharedCap = Number.isFinite(sharedCeiling.q) ? sharedCeiling.q : Infinity

  // Per-plating buildable: tagged parts for plating P capped by shared ceiling.
  // Also track the bottleneck per plating (shared part wins when it's the binding cap).
  const byPlating = {}
  const bottleneckByPlating = {}
  let sumTagged = 0, minTagged = Infinity, minTaggedCode = null
  for (const p of platings) {
    const tg = minOver(refs.filter(r => refPlating(r, lib) === p))
    if (!Number.isFinite(tg.q)) continue
    const platBuildable = Math.min(Math.max(0, tg.q), sharedCap)
    byPlating[p] = platBuildable
    bottleneckByPlating[p] = (Number.isFinite(sharedCeiling.q) && sharedCeiling.q <= tg.q)
      ? sharedCeiling.code : tg.code
    sumTagged += Math.max(0, tg.q)
    if (tg.q < minTagged) { minTagged = tg.q; minTaggedCode = tg.code }
  }
  const qty = Math.min(sharedCap, sumTagged)
  const bottleneck = (Number.isFinite(sharedCeiling.q) && sharedCeiling.q <= sumTagged) ? sharedCeiling.code : minTaggedCode
  return { qty: Number.isFinite(qty) ? qty : null, bottleneck, byPlating, bottleneckByPlating }
}

// Lead weeks to make from scratch the scarce parts. Returns { weeks, driver };
// weeks is null when at least one plating is fully covered by stock (nothing to
// make). With plating-specific parts we report the SOONEST deliverable plating
// (min across platings of its longest-uncovered lead) so a slow/zero plating
// doesn't poison the promise for a plating we can ship faster.
export function makeLeadWeeks(product, lib) {
  const refs = refsOf(product)
  if (!refs.length) return { weeks: null, driver: null }

  // Longest-lead uncovered part in a list ⇒ { w, code } (w null when all covered).
  const longestUncovered = list => {
    let w = null, code = null
    for (const r of list) {
      const c = resolveRef(r, lib)
      if (!c) continue
      const stock = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
      if (stock >= perUnit(r)) continue          // this part is covered
      const lw = Number.isFinite(c.lead_time_weeks) ? c.lead_time_weeks : 0
      if (w == null || lw > w) { w = lw; code = c.code }
    }
    return { w, code }
  }

  const platings = platingsTagged(refs, lib)
  if (!platings.length) {
    const { w, code } = longestUncovered(refs)
    return { weeks: w, driver: code }
  }

  // Per plating: shared + that plating's tagged parts. Soonest plating wins.
  const shared = refs.filter(r => isShared(r, lib))
  let best = null, driver = null
  for (const p of platings) {
    const tagged = refs.filter(r => refPlating(r, lib) === p)
    const u = longestUncovered([...shared, ...tagged])
    const w = u.w == null ? 0 : u.w            // 0 ⇒ this plating fully covered
    if (best == null || w < best) { best = w; driver = u.code }
  }
  return best === 0 ? { weeks: null, driver: null } : { weeks: best, driver }
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
// Returns { promise, leadWeeks, finished, buildable, bottleneck, effectiveMoq }.
// effectiveMoq: 0 for last-stock (sell whatever remains, no minimum), else product.moq.
export function productAvailability(product, lib) {
  const status = product?.status === 'stock' ? 'stock' : 'active'   // 'active' = Made to Order
  const finished = finishedStockOf(product)
  const refs = refsOf(product)
  const { qty: buildable, bottleneck, byPlating, bottleneckByPlating } = buildableFromComponents(product, lib)
  const make = makeLeadWeeks(product, lib)
  const assembly = numOrNull(product?.lead_time_weeks) ?? ASSEMBLY_WEEKS_DEFAULT
  const moq = numOrNull(product?.moq)
  const moqTxt = moq ? `, MOQ ${moq}` : ''

  const note = (product?.delivery_note || '').trim()
  if (note) return { promise: note, leadWeeks: null, finished, buildable, bottleneck, byPlating, bottleneckByPlating, effectiveMoq: moq ?? 0 }

  let promise, leadWeeks, effectiveMoq
  if (status === 'stock') {                       // Last Stock — retired; availability from remaining parts
    effectiveMoq = 0
    if (byPlating && Object.keys(byPlating).length) {
      const parts = Object.entries(byPlating).map(([p, n]) => `${p}: ${n}`).join(' · ')
      promise = buildable > 0
        ? `Final stock — no re-runs. (${parts})`
        : 'Sold out — no parts remaining.'
    } else {
      promise = buildable > 0
        ? `Final stock — ${buildable} buildable from remaining parts, no re-runs.`
        : 'Sold out — no parts remaining.'
    }
    leadWeeks = buildable > 0 ? assembly : null
  } else if (!refs.length) {                       // no critical parts tracked — pure MTO
    effectiveMoq = moq ?? 0
    promise = `Made to order — ~${assembly} weeks${moqTxt}.`
    leadWeeks = assembly
  } else if (buildable && buildable > 0) {         // parts on hand, just assemble
    effectiveMoq = moq ?? 0
    promise = `Made to order — ~${assembly} weeks${moqTxt} (${buildable} buildable from stock now).`
    leadWeeks = assembly
  } else {                                         // must source the scarce part first
    effectiveMoq = moq ?? 0
    const w = make.weeks != null ? make.weeks : assembly
    const drv = make.driver ? ` — lead set by ${make.driver}` : ''
    promise = `Made to order — ~${w} weeks${moqTxt}${drv}.`
    leadWeeks = w
  }
  return { promise, leadWeeks, finished, buildable, bottleneck, byPlating, bottleneckByPlating, effectiveMoq }
}
