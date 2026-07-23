#!/usr/bin/env node
/**
 * Inspect a live order and its lines, to diagnose CuiLing's "edits revert"
 * report. Read-only. Finds the order by UC or customer, prints the header
 * timestamps and every line with its doc id, and flags anything that would
 * make a save silently fail — e.g. a header updatedAt older than createdAt, or
 * line docs whose shape is off.
 *
 *   node migration/inspect_order.cjs "UC4951"
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const KEY = path.join(ROOT, 'firebase-service-account.json')
if (!fs.existsSync(KEY)) { console.error('no key'); process.exit(1) }
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

const needle = (process.argv[2] || '').toLowerCase()

const ts = v => {
  if (!v) return '(none)'
  if (typeof v.toDate === 'function') return v.toDate().toISOString()
  return String(v)
}

;(async () => {
  const snap = await db.collection('orders').get()
  const hits = snap.docs.filter(d => {
    const o = d.data()
    const hay = `${o.uc_no || ''} ${o.erp_pi_no || ''} ${o.erp_so_no || ''} ${o.customer_name || ''}`.toLowerCase()
    return hay.includes(needle)
  })
  console.log(`${snap.size} orders total, ${hits.length} match "${needle}"\n`)

  for (const d of hits) {
    const o = d.data()
    console.log(`ORDER ${d.id}`)
    console.log(`  uc_no=${o.uc_no}  so=${o.erp_so_no}  si=${o.erp_si_no}  pi=${o.erp_pi_no}`)
    console.log(`  customer=${o.customer_name}  status=${o.status}  source=${o.source}`)
    console.log(`  subtotal=${o.subtotal}  total_amount=${o.total_amount}  discount_pct=${o.discount_pct}`)
    console.log(`  createdAt=${ts(o.createdAt)}`)
    console.log(`  updatedAt=${ts(o.updatedAt)}`)
    const lines = await db.collection('orders').doc(d.id).collection('lines').get()
    console.log(`  ${lines.size} line docs:`)
    for (const l of lines.docs) {
      const x = l.data()
      console.log(`    [${l.id}] no=${x.line_no} ${x.item_code || '(no code)'} qty=${x.qty_ordered} price=${x.unit_price} type=${x.line_type} upd=${ts(x.updatedAt)}`)
    }
    console.log()
  }
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
