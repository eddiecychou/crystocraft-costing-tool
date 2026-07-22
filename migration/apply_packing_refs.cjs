#!/usr/bin/env node
/**
 * Apply the safe half of the packing diff: pack_box_ref only.
 *
 * A "reference upgrade" is a product where the sheet and the app already agree
 * on pieces-per-carton and CBM, and the sheet simply carries the full JES code
 * ("P-PB001ROS-02-01") where the app holds a stub ("pb001"). Nothing numeric
 * changes, so this is the one part of the import that needs no confirmation.
 *
 * The 62 value changes are deliberately NOT applied here. Those alter CBM and
 * need XiangXia.
 *
 *   dry run:  node migration/apply_packing_refs.cjs
 *   apply:    node migration/apply_packing_refs.cjs --apply
 *
 * Every affected document's current `packing` is written to
 * migration/out/packing_backup_<timestamp>.json before anything is changed.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUTDIR = path.join(__dirname, 'out')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const APPLY = process.argv.includes('--apply')

if (!fs.existsSync(KEY)) {
  console.error(`No service-account key at ${KEY}`)
  process.exit(1)
}

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

// --- the diff, parsed straight from the review CSV ---------------------------
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const hdr = rows.shift().map(h => h.replace(/^﻿/, ''))
  return rows.filter(r => r.length === hdr.length)
             .map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i]])))
}

const diff = parseCsv(fs.readFileSync(path.join(OUTDIR, 'packing_diff.csv'), 'utf8'))
const products = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'range_products.json'), 'utf8')).products

// design+format must identify one document, or the write could land on the
// wrong product. Checked rather than assumed.
const byKey = new Map()
for (const p of products) {
  const k = `${p.design_code}|${p.format_code}`
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(p)
}
const ambiguous = [...byKey.entries()].filter(([, v]) => v.length > 1)

const targets = []
for (const r of diff) {
  if (!r.classification.startsWith('reference upgrade')) continue
  const k = `${r.design}|${r.format}`
  const matches = byKey.get(k) || []
  if (matches.length !== 1) {
    console.warn(`  skipped ${k}: ${matches.length} products share this key`)
    continue
  }
  const p = matches[0]
  // The sheet may list several options; for a reference upgrade they share the
  // numbers, so take the one whose box family matches what the app already has.
  const opts = r.sheet_box.split(' | ').map(s => s.trim()).filter(Boolean)
  const fam = s => {
    const m = String(s || '').toUpperCase().match(/([GP]B)\s*0*(\d{1,3})/)
    return m ? `${m[1]}${String(parseInt(m[2], 10)).padStart(3, '0')}` : String(s || '').trim()
  }
  const current = (p.packing || {}).pack_box_ref || ''
  // Only upgrade a STUB. If the app already holds a full JES code, a different
  // full code is a real box change, not a formatting fix: P-PB032-01-15 ->
  // P-PB032ROS-02-01 and P-PB002ROS-02-01 -> P-PB002-05WH-18 both passed the
  // family check while changing the actual box. Those go to XiangXia.
  const isFullCode = /^P-[A-Z]{2}\d+[A-Z0-9]*-\d+-\d+$/i.test(current.trim())
  if (isFullCode) {
    console.warn(`  skipped ${k}: already a full code (${current}) — real change, not an upgrade`)
    continue
  }
  const chosen = opts.find(o => fam(o) === fam(current))
  if (!chosen) { console.warn(`  skipped ${k}: no sheet option matches box family ${fam(current)}`); continue }
  if (chosen === current) continue
  targets.push({ id: p.id, key: k, name: p.design_name || '', from: current, to: chosen,
                 packing: p.packing || {} })
}

;(async () => {
  if (ambiguous.length) {
    console.log(`note: ${ambiguous.length} design+format keys map to more than one product; those are skipped\n`)
  }
  console.log(`${targets.length} products to update (pack_box_ref only)\n`)
  for (const t of targets) {
    console.log(`  ${t.key}  ${t.name.slice(0, 30).padEnd(30)} ${t.from || '(blank)'} -> ${t.to}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.')
    process.exit(0)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(OUTDIR, `packing_backup_${stamp}.json`)
  fs.writeFileSync(backup, JSON.stringify(
    targets.map(t => ({ id: t.id, key: t.key, packing: t.packing })), null, 2))
  console.log(`\nbackup -> ${path.relative(ROOT, backup)}`)

  // Merge into the packing map rather than replacing it, so the fields this
  // script has no opinion about are left exactly as they are.
  let done = 0
  for (const t of targets) {
    await db.collection('range_products').doc(t.id).set(
      { packing: { pack_box_ref: t.to }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true })
    done++
  }
  console.log(`written: ${done} documents`)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
