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

// Issue an order's components to the ledger. Idempotent: refuses if already
// issued. Posts one `issue` movement per component (order_id-tagged) and records
// what was deducted on the order for a clean reversal.
export async function issueOrder(orderId, orderLabel) {
  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  if (snap.exists() && snap.data().components_issued) {
    throw new Error('Components already issued for this order.')
  }
  const { items } = await computeOrderIssue(orderId)
  if (!items.length) throw new Error('Nothing to issue — no figurine BOM components on this order.')

  const issued = []
  for (const it of items) {
    await postMovement('range_components', it.component_id, {
      type: 'issue', qty: it.required, order_id: orderId,
      note: `Issued to order ${orderLabel || orderId}`,
    })
    issued.push({ component_id: it.component_id, code: it.code, qty: it.required })
  }
  await updateDoc(orderRef, {
    components_issued: true,
    components_issued_at: serverTimestamp(),
    issued_lines: issued,
  })
  return issued
}

// Reverse a prior issue — parts go back to stock as an adjustment (+qty) with a
// clear note, then the order's issued state is cleared.
export async function reverseOrderIssue(orderId, orderLabel) {
  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  const issued = snap.exists() ? (snap.data().issued_lines || []) : []
  for (const it of issued) {
    if (!it.component_id) continue
    await postMovement('range_components', it.component_id, {
      type: 'adjustment', qty: Math.abs(Number(it.qty) || 0), order_id: orderId,
      note: `Reversed issue — order ${orderLabel || orderId}`,
    })
  }
  await updateDoc(orderRef, {
    components_issued: false,
    components_issued_at: null,
    issued_lines: [],
  })
}

// ── Simple inventory classes: crystals & packaging (V7.13a) ──────────────────
// Crystals and packaging have NO per-product BOM, so consumption is entered by
// hand as a batch per order (matches the owner's Excel: one issue per SKU per
// order). Same order-tagged, reversible pattern as the metal issue above, but
// the lines are operator-supplied. Both classes share these two functions —
// driven by an `inv` config (crystals.js / packaging.js), whose `inv.order`
// carries the exact order-doc field names + the line id field, so no data
// migration is needed. lines: [{ [inv.order.lineIdField], code, qty }]
export async function issueInventoryForOrder(inv, orderId, orderLabel, lines) {
  const { collectionPath, order } = inv
  const idField = order.lineIdField
  const clean = (lines || [])
    .filter(l => l[idField] && Number(l.qty) > 0)
    .map(l => ({ [idField]: l[idField], code: l.code || '', qty: Math.abs(Number(l.qty)) }))
  if (!clean.length) throw new Error(`Add at least one ${inv.noun} line with a quantity.`)

  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  if (snap.exists() && snap.data()[order.issued]) throw new Error(`Already issued for this order.`)

  const issued = []
  for (const l of clean) {
    await postMovement(collectionPath, l[idField], {
      type: 'issue', qty: l.qty, order_id: orderId,
      note: `Issued to order ${orderLabel || orderId}`,
    })
    issued.push(l)
  }
  await updateDoc(orderRef, {
    [order.issued]: true,
    [order.issuedAt]: serverTimestamp(),
    [order.lines]: issued,
  })
  return issued
}

export async function reverseInventoryIssue(inv, orderId, orderLabel) {
  const { collectionPath, order } = inv
  const idField = order.lineIdField
  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  const issued = snap.exists() ? (snap.data()[order.lines] || []) : []
  for (const l of issued) {
    if (!l[idField]) continue
    await postMovement(collectionPath, l[idField], {
      type: 'adjustment', qty: Math.abs(Number(l.qty) || 0), order_id: orderId,
      note: `Reversed ${inv.noun} issue — order ${orderLabel || orderId}`,
    })
  }
  await updateDoc(orderRef, {
    [order.issued]: false,
    [order.issuedAt]: null,
    [order.lines]: [],
  })
}
