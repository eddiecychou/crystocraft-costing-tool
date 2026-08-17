import { collection, getDocs, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { computeRequirements } from './mrp'
import { loadComponents } from './criticalComponents'
import { postMovement } from './stockLedger'

// Order → component stock issue (V7.13a step 2). A deliberate, reversible action:
// the operator issues an order's metal-component consumption to the ledger when
// production actually draws the parts. We reuse the MRP explosion so the issued
// quantities are IDENTICAL to what the Component Requirements report says the
// order needs (plating-aware, shared parts counted once). See
// Inventory_Roadmap_V7.13_Spec.md — deduction timing = manual issue.
//
// State lives on the order doc:
//   components_issued     : bool
//   components_issued_at  : timestamp
//   issued_lines          : [{ component_id, code, qty }]   (what was deducted)
// so reversal posts the exact opposite and nothing double-counts.

// Load everything needed to explode ONE order: full range products (with BOM),
// the component library (id + stock), and the order's persisted lines. Lines are
// read fresh from Firestore so we always issue the saved truth, never unsaved edits.
async function loadContext(orderId) {
  const [prodSnap, lib, lineSnap] = await Promise.all([
    getDocs(collection(db, 'range_products')),
    loadComponents(),
    getDocs(collection(db, 'orders', orderId, 'lines')),
  ])
  const products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const lines = lineSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  return { products, lib, lines }
}

// Preview the issue for an order: the per-component quantities that WOULD be
// deducted, plus anything that can't be issued (figurine codes not in the range,
// or lines with no BOM). Non-mutating.
export async function computeOrderIssue(orderId) {
  const { products, lib, lines } = await loadContext(orderId)
  const { rows, warnings, unmatched } = computeRequirements({ lines, products, lib })
  const idByCode = {}
  for (const c of lib) if (c.code) idByCode[c.code.toUpperCase()] = c.id

  const items = rows
    .filter(r => r.required > 0)
    .map(r => {
      const component_id = idByCode[r.code.toUpperCase()] || null
      return {
        component_id, code: r.code, name: r.name,
        required: r.required, inStock: r.inStock,
        after: r.inStock - r.required,   // resulting balance (negative = oversell)
      }
    })
  return {
    items: items.filter(i => i.component_id),
    missing: items.filter(i => !i.component_id),   // in BOM but no ledger component
    warnings, unmatched,
  }
}

// ── Two-stage reserve → production-in (V7.13a R1) ────────────────────────────
// All three classes follow the owner's ERP practice: Reserve at order
// confirmation (components allocated, sitting on the line — on-hand unchanged,
// reserved ↑), then Production-in when built (consumed — on-hand ↓, reserved ↓).
// Both stages are reversible. Driven by a `cfg` per class carrying the parent
// collection path + the exact order-doc field names (cfg.order.*), so metal,
// crystals and packaging share one implementation and no data migrates.

// Metal config lives here (its lines come from the BOM explosion, below).
// Crystals/packaging carry their config on crystalInventory / packagingInventory.
export const metalOrderConfig = {
  collectionPath: 'range_components',
  noun: 'component',
  order: {
    reserved: 'components_reserved', reservedAt: 'components_reserved_at',
    committed: 'components_committed', committedAt: 'components_committed_at',
    lines: 'component_lines', lineIdField: 'component_id',
    // What could NOT be reserved, persisted at reserve time (V7.16). Only the
    // metal class has gaps — its lines come from the BOM explosion, so a part
    // can be required but absent from the ledger. Crystals/packaging are picked
    // by hand, so there is nothing to miss.
    gaps: 'component_gaps',
    // Legacy single-stage (V7.13a step 2) — read so any already-issued test
    // order still reverses cleanly.
    legacyIssued: 'components_issued', legacyLines: 'issued_lines',
  },
  cardTitle: 'Component',
}

// Reserve a set of lines to an order. lines: [{ [lineIdField], code, qty }].
// `gaps` (optional) = { missing, unmatched } from computeOrderIssue — what the
// preview warned about and could NOT be reserved. Persisted with the
// reservation: before V7.16 this warning vanished the moment you clicked
// Reserve, so an order reserved with 3 of 5 components displayed exactly like
// one reserved with 5 of 5. Stock silently drifted with no record of where.
// Idempotency-key generation: one per order, bumped only by reserveForOrder
// (bug-fix pack B-03). The four functions below all loop postMovement calls
// and only mark the order doc done AFTER the loop — a failure partway through
// used to mean a retry re-posted every already-succeeded line a second time.
// Keying each movement on orderId + generation + line id makes a retry of
// the SAME attempt dedupe cleanly (postMovement skips a movement doc that
// already exists), while a genuinely NEW reservation after a release gets a
// fresh generation and can never collide with the old, already-released one.
const genField = order => `${order.reserved}_generation`

export async function reserveForOrder(cfg, orderId, orderLabel, lines, gaps) {
  const { collectionPath, order } = cfg
  const idField = order.lineIdField
  const clean = (lines || [])
    .filter(l => l[idField] && Number(l.qty) > 0)
    .map(l => ({ [idField]: l[idField], code: l.code || '', qty: Math.abs(Number(l.qty)) }))
  if (!clean.length) throw new Error('Nothing to reserve — add at least one line with a quantity.')

  const orderRef = doc(db, 'orders', orderId)
  const d = (await getDoc(orderRef)).data() || {}
  if (d[order.reserved] || d[order.committed]) throw new Error('Already reserved for this order.')
  const gf = genField(order)
  const generation = (Number.isFinite(d[gf]) ? d[gf] : 0) + 1

  for (const l of clean) {
    await postMovement(collectionPath, l[idField], {
      type: 'reserve', qty: l.qty, order_id: orderId,
      note: `Reserved for order ${orderLabel || orderId}`,
      idempotencyKey: `reserve_${orderId}_g${generation}_${l[idField]}`,
    })
  }
  const patch = { [order.reserved]: true, [order.reservedAt]: serverTimestamp(), [order.lines]: clean, [gf]: generation }
  if (order.gaps) patch[order.gaps] = summariseGaps(gaps)
  await updateDoc(orderRef, patch)
  return clean
}

// Trim the preview's gap lists to what is worth keeping on the order doc: the
// code and why, nothing else. Returns null when there is nothing to record, so
// a clean reservation clears any gaps left by an earlier one.
function summariseGaps(gaps) {
  const missing = (gaps?.missing || []).map(m => ({ code: m.code || '', name: m.name || '', qty: Number(m.required) || 0 }))
  const unmatched = (gaps?.unmatched || []).map(u => (typeof u === 'string' ? { label: u } : { label: u?.code || u?.description || u?.label || 'unmatched line' }))
  if (!missing.length && !unmatched.length) return null
  return { missing, unmatched, at: new Date().toISOString() }
}

// Production-in: consume the reservation into finished goods (on-hand ↓, reserved ↓).
export async function produceForOrder(cfg, orderId, orderLabel) {
  const { collectionPath, order } = cfg
  const idField = order.lineIdField
  const orderRef = doc(db, 'orders', orderId)
  const d = (await getDoc(orderRef)).data() || {}
  if (!d[order.reserved]) throw new Error('Reserve the stock before production-in.')
  if (d[order.committed]) throw new Error('Already produced-in for this order.')

  const lines = d[order.lines] || []
  const generation = Number.isFinite(d[genField(order)]) ? d[genField(order)] : 0
  for (const l of lines) {
    if (!l[idField]) continue
    await postMovement(collectionPath, l[idField], {
      type: 'produce', qty: Math.abs(Number(l.qty) || 0), order_id: orderId,
      note: `Production-in — order ${orderLabel || orderId}`,
      idempotencyKey: `produce_${orderId}_g${generation}_${l[idField]}`,
    })
  }
  await updateDoc(orderRef, { [order.committed]: true, [order.committedAt]: serverTimestamp() })
  return lines
}

// Release a reservation (before production-in): reserved back to free stock.
export async function releaseForOrder(cfg, orderId, orderLabel) {
  const { collectionPath, order } = cfg
  const idField = order.lineIdField
  const orderRef = doc(db, 'orders', orderId)
  const d = (await getDoc(orderRef)).data() || {}
  const lines = d[order.lines] || []
  const generation = Number.isFinite(d[genField(order)]) ? d[genField(order)] : 0
  for (const l of lines) {
    if (!l[idField]) continue
    await postMovement(collectionPath, l[idField], {
      type: 'release', qty: Math.abs(Number(l.qty) || 0), order_id: orderId,
      note: `Released reservation — order ${orderLabel || orderId}`,
      idempotencyKey: `release_${orderId}_g${generation}_${l[idField]}`,
    })
  }
  const patch = {
    [order.reserved]: false, [order.reservedAt]: null,
    [order.committed]: false, [order.committedAt]: null, [order.lines]: [],
  }
  if (order.gaps) patch[order.gaps] = null   // the reservation is gone; so are its gaps
  await updateDoc(orderRef, patch)
}

// Reverse a production-in: consumed stock returns to on-hand (order → open).
// Also unwinds a legacy single-stage `issue` (same effect: add on-hand back).
export async function reverseProduceForOrder(cfg, orderId, orderLabel) {
  const { collectionPath, order } = cfg
  const idField = order.lineIdField
  const orderRef = doc(db, 'orders', orderId)
  const d = (await getDoc(orderRef)).data() || {}
  const lines = (d[order.lines] && d[order.lines].length ? d[order.lines] : (order.legacyLines ? d[order.legacyLines] : null)) || []
  const generation = Number.isFinite(d[genField(order)]) ? d[genField(order)] : 0
  for (const l of lines) {
    if (!l[idField]) continue
    await postMovement(collectionPath, l[idField], {
      type: 'adjustment', qty: Math.abs(Number(l.qty) || 0), order_id: orderId,
      note: `Reversed production-in — order ${orderLabel || orderId}`,
      idempotencyKey: `reverse_produce_${orderId}_g${generation}_${l[idField]}`,
    })
  }
  const patch = {
    [order.reserved]: false, [order.reservedAt]: null,
    [order.committed]: false, [order.committedAt]: null, [order.lines]: [],
  }
  if (order.legacyIssued) { patch[order.legacyIssued] = false; patch[order.legacyLines] = [] }
  if (order.gaps) patch[order.gaps] = null   // back to open — nothing reserved, nothing missing
  await updateDoc(orderRef, patch)
}
