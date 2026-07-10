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

// ── Crystals (V7.13a crystals-2) ─────────────────────────────────────────────
// Crystals have NO per-product BOM, so their consumption is entered by hand as a
// batch per order (matches the owner's Excel: one issue per colour per order).
// Same order-tagged, reversible pattern as the metal issue above, but the lines
// are operator-supplied rather than exploded from a BOM.
//   crystals_issued / crystals_issued_at / crystal_issued_lines[]  on the order doc.

// lines: [{ crystal_id, code, qty }]
export async function issueCrystalsForOrder(orderId, orderLabel, lines) {
  const clean = (lines || [])
    .filter(l => l.crystal_id && Number(l.qty) > 0)
    .map(l => ({ crystal_id: l.crystal_id, code: l.code || '', qty: Math.abs(Number(l.qty)) }))
  if (!clean.length) throw new Error('Add at least one crystal line with a quantity.')

  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  if (snap.exists() && snap.data().crystals_issued) throw new Error('Crystals already issued for this order.')

  const issued = []
  for (const l of clean) {
    await postMovement('crystals', l.crystal_id, {
      type: 'issue', qty: l.qty, order_id: orderId,
      note: `Issued to order ${orderLabel || orderId}`,
    })
    issued.push(l)
  }
  await updateDoc(orderRef, {
    crystals_issued: true,
    crystals_issued_at: serverTimestamp(),
    crystal_issued_lines: issued,
  })
  return issued
}

export async function reverseCrystalIssue(orderId, orderLabel) {
  const orderRef = doc(db, 'orders', orderId)
  const snap = await getDoc(orderRef)
  const issued = snap.exists() ? (snap.data().crystal_issued_lines || []) : []
  for (const l of issued) {
    if (!l.crystal_id) continue
    await postMovement('crystals', l.crystal_id, {
      type: 'adjustment', qty: Math.abs(Number(l.qty) || 0), order_id: orderId,
      note: `Reversed crystal issue — order ${orderLabel || orderId}`,
    })
  }
  await updateDoc(orderRef, {
    crystals_issued: false,
    crystals_issued_at: null,
    crystal_issued_lines: [],
  })
}
