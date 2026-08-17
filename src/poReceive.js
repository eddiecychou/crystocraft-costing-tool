import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { loadComponents } from './criticalComponents'
import { loadCrystals } from './crystals'
import { loadPackaging } from './packaging'
import { postMovement } from './stockLedger'

// Purchase Order → receive stock into inventory (V7.13a). When goods arrive
// against a PU, this posts a `receipt` movement for each line to the matching
// inventory SKU — across all three classes (metal components, crystals,
// packaging) — closing the loop vendor order → delivery → stock. Order-tagged
// with the PU number, reversible. No per-product BOM involved: a PU line is
// matched to a stocked SKU by its explicit component link first, then by item
// code across the three classes.

const norm = s => (s == null ? '' : String(s)).trim().toUpperCase()
export const RECEIVE_CLASS_PATH = { metal: 'range_components', crystal: 'crystals', packaging: 'packaging' }

// Build a code→SKU index (and id lookup) across all three inventory classes.
async function loadInventoryIndex() {
  const [metal, crystals, packaging] = await Promise.all([loadComponents(), loadCrystals(), loadPackaging()])
  const byCode = {}, byId = {}
  const add = (cls, arr) => (arr || []).forEach(c => {
    const rec = { cls, id: c.id, code: c.code || '', name: c.name || '', stock: Number.isFinite(c.stock_qty) ? c.stock_qty : 0 }
    byId[`${cls}:${c.id}`] = rec
    const code = norm(c.code)
    if (code && !(code in byCode)) byCode[code] = rec   // first wins on duplicate codes
  })
  add('metal', metal); add('crystal', crystals); add('packaging', packaging)
  return { byCode, byId }
}

// Preview what a PU receive would do: each receivable line matched to its SKU
// (explicit link first, then item code), plus lines that match nothing. Qty
// defaults to the ordered qty (editable in the UI for partial deliveries).
export async function computePoReceive(po) {
  const { byCode, byId } = await loadInventoryIndex()
  const items = [], unmatched = []
  for (const l of (po?.lines || [])) {
    const qty = Math.abs(Number(l.qty) || 0)
    if (!qty) continue   // charge/blank lines with no quantity
    let rec = l.linked?.component_id ? byId[`metal:${l.linked.component_id}`] : null
    if (!rec) rec = byCode[norm(l.code)] || null
    if (rec) items.push({ cls: rec.cls, sku_id: rec.id, code: rec.code, name: rec.name, qty, stock: rec.stock })
    else unmatched.push({ code: l.code || '(no code)', description: l.description || '', qty })
  }
  return { items, unmatched }
}

// Receive: post a `receipt` movement per line to its SKU's ledger. Idempotent
// (refuses if already received) and records what was received on the PU doc.
// lines: [{ cls, sku_id, code, qty }].
export async function receivePo(poId, poNumber, lines) {
  const clean = (lines || [])
    .filter(l => l.sku_id && RECEIVE_CLASS_PATH[l.cls] && Number(l.qty) > 0)
    .map(l => ({ cls: l.cls, sku_id: l.sku_id, code: l.code || '', qty: Math.abs(Number(l.qty)) }))
  if (!clean.length) throw new Error('Nothing to receive — no lines matched an inventory item.')

  const ref = doc(db, 'purchase_orders', poId)
  const snap = await getDoc(ref)
  if (snap.exists() && snap.data().stock_received) throw new Error('Stock already received for this PU.')
  // Bumped by reversePoReceive below — part of the idempotency key, so a
  // genuine SECOND receive (received, reversed, received again for real)
  // gets fresh movement ids instead of colliding with the reversed ones.
  const generation = Number.isFinite(snap.data()?.receive_generation) ? snap.data().receive_generation : 0

  // Idempotency key per line, not just the up-front stock_received check
  // above — that check only guards against a SECOND, separate call to
  // receivePo. It does nothing for a single call that partially fails (line
  // 3 of 5 throws): stock_received never gets set, so a retry of the exact
  // same call re-loops from line 1 and would double-post lines 1-2 before
  // reaching the point of failure again. Keyed on poId+generation+sku_id, so
  // a retry of the SAME (not-yet-reversed) attempt re-posts every line at the
  // SAME movement doc id — already-posted lines are deduped by postMovement,
  // only the ones that never landed do anything (bug-fix pack B-03).
  for (const l of clean) {
    await postMovement(RECEIVE_CLASS_PATH[l.cls], l.sku_id, {
      type: 'receipt', qty: l.qty, note: `Received PU ${poNumber || poId}`,
      idempotencyKey: `po_receive_${poId}_g${generation}_${l.sku_id}`,
    })
  }
  await updateDoc(ref, { stock_received: true, stock_received_at: serverTimestamp(), received_lines: clean, receive_generation: generation })
  return clean
}

// Reverse a receive — remove the received quantities from stock (adjustment −qty)
// and clear the PU's received state.
export async function reversePoReceive(poId, poNumber) {
  const ref = doc(db, 'purchase_orders', poId)
  const snap = await getDoc(ref)
  const data = snap.exists() ? snap.data() : {}
  const received = data.received_lines || []
  const generation = Number.isFinite(data.receive_generation) ? data.receive_generation : 0
  for (const l of received) {
    if (!l.sku_id || !RECEIVE_CLASS_PATH[l.cls]) continue
    await postMovement(RECEIVE_CLASS_PATH[l.cls], l.sku_id, {
      type: 'adjustment', qty: -Math.abs(Number(l.qty) || 0), note: `Reversed PU receipt ${poNumber || poId}`,
      idempotencyKey: `po_receive_reverse_${poId}_g${generation}_${l.sku_id}`,
    })
  }
  // Next receive gets a new generation, so its idempotency keys can never
  // collide with this (now reversed) one.
  await updateDoc(ref, { stock_received: false, stock_received_at: null, received_lines: [], receive_generation: generation + 1 })
}
