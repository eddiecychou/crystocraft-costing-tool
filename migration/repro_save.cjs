#!/usr/bin/env node
/**
 * Reproduce the app's order-save mechanism on a THROWAWAY order, to settle
 * whether line edits persist. Mimics createOrderWithLines, then the exact
 * saveOrderLines logic (batch.update for lines with an id, skip those without),
 * reads back, reports, and deletes the test order.
 *
 * Read/writes ONLY a doc it creates under orders/ with a qa_repro marker,
 * and removes it at the end.
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-service-account.json'), 'utf8'))
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

const orderRef = db.collection('orders').doc()
const linesCol = () => orderRef.collection('lines')

async function seed() {
  const batch = db.batch()
  batch.set(orderRef, { qa_repro: true, customer_name: 'QA REPRO', status: 'draft', createdAt: new Date() })
  const l1 = linesCol().doc(), l2 = linesCol().doc()
  batch.set(l1, { line_no: 1, item_code: 'AAA-1', description: 'first', qty_ordered: 10, unit_price: 1 })
  batch.set(l2, { line_no: 2, item_code: 'BBB-2', description: 'second', qty_ordered: 20, unit_price: 2 })
  await batch.commit()
  return [l1.id, l2.id]
}

async function readLines() {
  const s = await linesCol().orderBy('line_no').get()
  return s.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Faithful copy of the NEW saveOrderLines: set/merge + create new + delete
// removed. Mirrors src/shipping.js.
async function saveOrderLines(lines) {
  const existing = await linesCol().get()
  const keep = new Set()
  const batch = db.batch()
  for (const l of (lines || [])) {
    const ref = l.id ? linesCol().doc(l.id) : linesCol().doc()
    keep.add(ref.id)
    const { id, ...rest } = l
    batch.set(ref, rest, { merge: true })
  }
  for (const d of existing.docs) {
    if (!keep.has(d.id)) batch.delete(d.ref)
  }
  await batch.commit()
}

;(async () => {
  const [id1, id2] = await seed()
  let lines = await readLines()
  console.log('seeded:', lines.map(l => `${l.item_code} qty=${l.qty_ordered} "${l.description}"`))

  // Edit an existing line, and add a brand-new one with no id (as addBlankLine does).
  lines = lines.map(l => l.id === id1 ? { ...l, qty_ordered: 999, description: 'EDITED' } : l)
  lines.push({ line_no: 3, item_code: 'CCC-3', description: 'brand new', qty_ordered: 5, unit_price: 3 })

  let error = null
  try {
    await saveOrderLines(lines)
  } catch (e) {
    error = e.message || String(e)
  }
  console.log('saveOrderLines error:', error || '(none)')

  const after = await readLines()
  console.log('after save:', after.map(l => `${l.item_code} qty=${l.qty_ordered} "${l.description}"`))
  const edited = after.find(l => l.id === id1)
  console.log('\nexisting-line edit persisted:', edited && edited.qty_ordered === 999 && edited.description === 'EDITED')
  console.log('new line (no id) persisted   :', after.some(l => l.item_code === 'CCC-3'))

  // A line whose doc no longer exists must not sink the save.
  await linesCol().doc(id2).delete()
  let batchErr = null
  try {
    await saveOrderLines([
      { id: id1, line_no: 1, item_code: 'AAA-1', description: 'second edit', qty_ordered: 111 },
      { id: id2, line_no: 2, item_code: 'BBB-2', description: 'ghost', qty_ordered: 222 }, // doc deleted
    ])
  } catch (e) { batchErr = e.message || String(e) }
  const afterBad = await readLines()
  const l1After = afterBad.find(l => l.id === id1)
  console.log('\nwith one missing line doc:')
  console.log('  batch threw            :', batchErr || '(none)')
  console.log('  the GOOD edit persisted:', !!(l1After && l1After.qty_ordered === 111))
  console.log('  the phantom recreated  :', afterBad.some(l => l.id === id2))

  // A removed line must actually leave Firestore, not reappear on reload.
  await saveOrderLines([{ id: id1, line_no: 1, item_code: 'AAA-1', qty_ordered: 111 }])
  const afterRemove = await readLines()
  console.log('\nafter removing all but one line:')
  console.log('  line count now         :', afterRemove.length, afterRemove.length === 1 ? '(removed line gone)' : '(STILL THERE)')

  // cleanup
  const all = await linesCol().get()
  const cb = db.batch()
  all.docs.forEach(d => cb.delete(d.ref))
  cb.delete(orderRef)
  await cb.commit()
  console.log('\ncleaned up test order', orderRef.id)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
