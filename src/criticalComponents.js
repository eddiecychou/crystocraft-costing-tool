import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, increment,
} from 'firebase/firestore'
import { db } from './firebase'
import { persistRangeComponent } from './rangePersistence'
import { numOrNull, trimUpper, result, addError, addWarning, addInfo, merge } from './domain/validation'
import { colourScope } from './rangeBomScope'
import { resolveRef, availabilityComponent } from './availability'
export { componentMap, componentById, resolveRef, refScopePlating, refApplies, availableOf, buildableFromComponents, makeLeadWeeks, finishedStockOf, productAvailability } from './availability'

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


// Valid plating codes ('' = shared/unplated). Single source for the validators below.
export const VALID_PLATINGS = ['', 'C', 'G', 'R', 'A', 'M']

// Volume-tier rows on a component cost: [{ min_qty, unit_cost }], same shape as
// corp-gift supplier quotes. Cleaned to valid numeric rows, sorted by min_qty.
const normVolumeTiers = tiers => (Array.isArray(tiers) ? tiers : [])
  .map(t => ({ min_qty: numOrNull(t.min_qty), unit_cost: numOrNull(t.unit_cost) }))
  .filter(t => t.min_qty != null && t.min_qty > 0 && t.unit_cost != null)
  .sort((a, b) => a.min_qty - b.min_qty)

// Normalise a raw record (form or Firestore) into the canonical shape.
export const normComponent = c => ({
  ...availabilityComponent(c),
  name: (c.name || '').trim(),
  category: (c.category || '').trim(),
  // Plating this component belongs to (G/C/R/A/…); blank = shared across every
  // plating (bodies, NFC chips, gift boxes). A product ref may still override,
  // but normally plating is a property of the component (gold/chrome are distinct
  // ERP item codes with distinct cost). See Procurement spec §0.2 Decision 2.
  supplierId: c.supplierId || '',
  supplierName: (c.supplierName || '').trim(),
  notes: (c.notes || '').trim(),
  images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
  reorder_point: numOrNull(c.reorder_point), // reorder when available ≤ this (0 = only when negative)
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
  // Name of the supplier behind the denormalised cost (set from the preferred
  // quote). Read-only here — shown by the Price List tab. Falls back to the
  // editor's supplierName when no quote has been marked preferred.
  preferred_supplier_name: (c.preferred_supplier_name || '').trim(),
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

// Descriptive (non-cost, non-stock) fields written by the component editor. Two
// families are deliberately NOT written here so the editor form (merge:true)
// can never overwrite them:
//   • cost — owned by supplier quotes, denormalised separately.
//   • stock_qty — owned by the stock ledger (stockLedger.js); it is a cached
//     running balance updated only inside a movement transaction. Writing it
//     from the form would silently diverge the cached number from the ledger.
const descriptorOf = c => {
  const n = normComponent(c)
  return {
    code: n.code, name: n.name, category: n.category,
    plating_code: n.plating_code,
    supplierId: n.supplierId, supplierName: n.supplierName,
    notes: n.notes, images: n.images,
    lead_time_weeks: n.lead_time_weeks,
  }
}

// Create (id null/undefined) or update an existing component doc. Only descriptive
// fields are written; cost comes from the preferred supplier quote.
export async function saveComponent(id, data) {
  return persistRangeComponent(db, id || doc(COL()).id, descriptorOf(data))
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
  for (const c of clean) {
    await persistRangeComponent(db, doc(COL()).id, c)
    n++
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
    lead_time_weeks: numOrNull(r.lead_time_weeks),
  })).filter(r => r.code)
  if (!clean.length) return { created: 0, updated: 0, productsMatched: 0, productsUnmatched: 0, unmatched: [] }

  // Dedupe components by code; collect the product codes that use each.
  const compByCode = {}
  for (const r of clean) {
    let c = compByCode[r.code]
    if (!c) c = compByCode[r.code] = { name: r.name, plating_code: r.plating_code, stock_qty: r.stock_qty, lead_time_weeks: r.lead_time_weeks, used_by: new Set() }
    else if (r.lead_time_weeks != null) c.lead_time_weeks = r.lead_time_weeks   // last non-null wins on dedup
    if (r.product_item_code) c.used_by.add(r.product_item_code)
  }

  // Existing components by code → { id, hasName, prevStock, seq }. prevStock lets
  // the import record a correct stock-take DELTA into the ledger (below); seq is
  // the component's own movement counter (see stockLedger.js's postMovement) so
  // this import continues the SAME per-item sequence rather than colliding with
  // it — see the movSeq comment below (bug-fix pack B-03).
  const snap = await getDocs(COL())
  const existingByCode = {}
  for (const d of snap.docs) {
    const code = norm(d.data().code)
    if (code && !(code in existingByCode)) {
      const prev = d.data().stock_qty
      const seq = d.data().movement_seq
      existingByCode[code] = {
        id: d.id, hasName: !!(d.data().name || '').trim(),
        prevStock: Number.isFinite(prev) ? prev : 0,
        seq: Number.isFinite(seq) ? seq : 0,
      }
    }
  }

  // A bulk stock list is a stock-take: each row is an ABSOLUTE counted qty. Mirror
  // every set into the ledger as a stocktake movement so the cached stock_qty and
  // the append-only history never diverge (stockLedger.js owns stock_qty).
  //
  // seq used to be a single `Date.now()` counter SHARED across every row in the
  // import. postMovement's own seq is now a PER-ITEM counter stored on the item
  // doc (movement_seq) — a shared global counter here would produce seq values
  // that collide with (or leave gaps against) whatever a future postMovement
  // call computes for the same item. stocktakeOp now takes the item's own next
  // seq explicitly, continuing that same per-item sequence, and the item update
  // below writes movement_seq back so postMovement picks up from the right place.
  const importDate = new Date().toISOString().slice(0, 10)
  const stocktakeOp = (componentId, counted, prev, seq) => ({
    ref: doc(collection(db, 'range_components', componentId, 'movements')),
    data: {
      type: 'stocktake', qty: counted - prev, counted, balance_after: counted,
      date: importDate, note: 'Stock-take (list import)', order_id: null,
      seq, createdAt: serverTimestamp(),
    },
    merge: false,
  })

  // Assign a doc id per code (reuse existing, or pre-generate for new ones so
  // product refs can point at them in the same batch).
  const codeToId = {}
  const ops = []   // { ref, data, merge }
  let created = 0, updated = 0
  for (const [code, c] of Object.entries(compByCode)) {
    const used_by = [...c.used_by]
    const ex = existingByCode[code]
    const counted = Number.isFinite(c.stock_qty) ? c.stock_qty : null
    if (ex) {
      codeToId[code] = ex.id
      // stock_qty as increment(delta), not an absolute overwrite: a plain
      // `stock_qty: counted` silently discards any concurrent postMovement
      // (an order stock issue, a PO receipt) that lands between this
      // function's initial read and the batch commit — the ledger movement
      // itself would still exist, but the cached balance would go stale.
      // increment() is a Firestore atomic field operation, so it composes
      // correctly with a concurrent write instead of racing it (bug-fix
      // pack B-03). NOTE: this does not resolve the deeper question of what
      // a stock-take even means if the physical count and a concurrent
      // movement disagree about timing — only that this import can no
      // longer silently erase the other write's effect on the number.
      const data = { plating_code: c.plating_code, used_by, updatedAt: serverTimestamp() }
      if (c.lead_time_weeks != null) data.lead_time_weeks = c.lead_time_weeks
      if (!ex.hasName && c.name) data.name = c.name
      if (counted != null) {
        const seq = ex.seq + 1
        data.stock_qty = increment(counted - ex.prevStock)
        data.ledger_seeded = true
        data.movement_seq = seq
        ops.push(stocktakeOp(ex.id, counted, ex.prevStock, seq))
      }
      ops.push({ ref: doc(db, 'range_components', ex.id), data, merge: true })
      updated++
    } else {
      const ref = doc(COL())
      codeToId[code] = ref.id
      await persistRangeComponent(db, ref.id, { code, name: c.name, plating_code: c.plating_code })
      ops.push({ ref, data: {
        code, name: c.name, plating_code: c.plating_code, stock_qty: c.stock_qty,
        lead_time_weeks: c.lead_time_weeks ?? null, used_by,
        category: '', supplierId: '', supplierName: '', notes: '', images: [],
        ledger_seeded: counted != null ? true : false,
        movement_seq: counted != null ? 1 : 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, merge: false })
      if (counted != null) ops.push(stocktakeOp(ref.id, counted, 0, 1))
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

// ── Validators (shared guardrail result format) ───────────────────────────────
// Used by the write path and the read-only Schema Audit page so both share one
// rule set. Returns { ok, errors, warnings, infos } from domain/validation.

export function validateComponent(c) {
  const r = result()
  const n = normComponent(c || {})
  if (!n.code) addError(r, 'rangecomponent.code.required', 'code', 'Component code is required (upsert key)')
  if (c?.stock_qty != null && c.stock_qty !== '' && n.stock_qty == null)
    addWarning(r, 'rangecomponent.stockqty.nonnumeric', 'stock_qty', `stock_qty not numeric (${c.stock_qty})`)
  if (!VALID_PLATINGS.includes(n.plating_code))
    addWarning(r, 'rangecomponent.platingcode.invalid', 'plating_code',
      `plating_code "${n.plating_code}" not one of C/G/R/A/M/blank`)
  if (n.lead_time_weeks == null || n.lead_time_weeks <= 0)
    addInfo(r, 'rangecomponent.leadtime.missing', 'lead_time_weeks', 'no lead_time_weeks (uses default parts lead)')
  return r
}

// One product critical-component ref. `lib` is the components library (for orphan
// resolution). Duplicate component+plating pairs are checked by validateCriticalRefs.
export function validateCriticalRef(ref, lib) {
  const r = result()
  const code = trimUpper(ref?.code)
  const id = ref?.id
  const label = ref?.code || ref?.id || '(unnamed)'
  if (!code && !id) {
    addError(r, 'rangeproduct.criticalcomponent.missing_id', 'critical_components', 'component ref has no code or id')
    return r
  }
  if (!resolveRef(ref, lib))
    addError(r, 'rangeproduct.criticalcomponent.orphan', 'critical_components',
      `component "${label}" does not resolve to a Components record (orphan)`)
  if (ref?.qty_per_unit != null && ref.qty_per_unit !== '') {
    const q = Number(ref.qty_per_unit)
    if (!Number.isFinite(q) || q <= 0)
      addError(r, 'rangeproduct.criticalcomponent.qty_invalid', 'qty_per_unit',
        `component "${label}" has qty_per_unit ${ref.qty_per_unit} (must be > 0)`)
  }
  const rp = trimUpper(ref?.plating_code)
  if (ref?.crystal_code != null && (typeof ref.crystal_code !== 'string' || !/^[A-Z0-9]{1,12}$/.test(trimUpper(ref.crystal_code))))
    addError(r, 'rangeproduct.criticalcomponent.colour_invalid', 'crystal_code', 'Colour scope must be an explicit uppercase colour code')
  if (rp && !VALID_PLATINGS.includes(rp))
    addWarning(r, 'rangeproduct.criticalcomponent.plating_invalid', 'plating_code',
      `component ref plating "${ref.plating_code}" invalid`)
  return r
}

// All of a product's critical refs, including duplicate component+plating pairs.
export function validateCriticalRefs(refs, lib) {
  const list = Array.isArray(refs) ? refs : []
  const parts = list.map(ref => validateCriticalRef(ref, lib))
  const dup = result()
  const seen = new Map()
  for (const ref of list) {
    const base = trimUpper(ref?.code) || ref?.id || ''
    if (!base) continue
    const key = `${base}|${trimUpper(ref?.plating_code)}|${colourScope(ref)}`
    seen.set(key, (seen.get(key) || 0) + 1)
    if (seen.get(key) === 2)
      addWarning(dup, 'rangeproduct.criticalcomponent.duplicate_pair', 'critical_components',
        `duplicate component+plating ref (${ref?.code || ref?.id})`)
  }
  return merge(dup, ...parts)
}

// ── Forward-looking canonical contracts (A-1 / A-2) ───────────────────────────
// ProcurementLine and SupplierPO have no data or UI yet, so only their canonical
// shape (JSDoc) and a minimal validator stub are defined here — enough to anchor
// the contract the netting and PO builds will implement. No repository.
//
// @typedef {Object} ProcurementLine
// @property {string} order_id
// @property {string} order_line_id
// @property {string} component_id
// @property {string} componentcode_snapshot
// @property {number} required_qty
// @property {number} reserved_qty
// @property {number} covered_qty
// @property {number} to_purchase_qty
// @property {'covered'|'shortage'|'draft_po'|'ordered'|'confirmed'|'inproduction'|'partreceived'|'received'|'issue'|'cancelled'} status
// @property {'ontrack'|'watch'|'late'|'blocked'} risk_status
export function validateProcurementLine(line) {
  const r = result()
  const l = line || {}
  if (!l.order_id) addError(r, 'procurementline.orderid.required', 'order_id', 'order_id is required')
  if (!l.component_id && !l.componentcode_snapshot)
    addError(r, 'procurementline.component.required', 'component_id', 'component reference is required')
  return r
}

// @typedef {Object} SupplierPO
// @property {string} po_number
// @property {string} supplier_id
// @property {string} suppliername_snapshot
// @property {string} currency
// @property {string[]} order_ids
// @property {string[]} procurementline_ids
export function validateSupplierPO(po) {
  const r = result()
  const p = po || {}
  if (!p.po_number) addError(r, 'supplierpo.ponumber.required', 'po_number', 'PO number is required')
  if (!p.supplier_id) addError(r, 'supplierpo.supplier.required', 'supplier_id', 'supplier is required')
  return r
}
