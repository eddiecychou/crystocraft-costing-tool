#!/usr/bin/env node
/**
 * Write the derived crystal BOM onto range_products.crystal_components.
 *
 * The derivation keys skeletons on (design, format, brand, plating), but the
 * BOM belongs on the product, and plating does not touch the stones —
 * D0092-001-GC1 and -RC1 carry identical crystal content. So this collapses
 * across plating and brand, and refuses to write any product where that
 * collapse is not clean rather than picking a winner.
 *
 *   dry run:  node migration/apply_crystal_bom.cjs
 *   apply:    node migration/apply_crystal_bom.cjs --apply
 *
 * Also clears the legacy `crystal_mixes` field on the products it writes: that
 * field came from a marketing CSV and the job-order BOM contradicts it.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUTDIR = path.join(__dirname, 'out')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const APPLY = process.argv.includes('--apply')

if (!fs.existsSync(KEY)) { console.error(`No key at ${KEY}`); process.exit(1) }

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

const derived = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'crystal_bom_derived.json'), 'utf8'))
const products = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'range_products.json'), 'utf8')).products

// skeletons: "design|format|brand|plating" -> { "shape|size": qty }
const byProduct = new Map()
for (const [k, pos] of Object.entries(derived.skeletons)) {
  const [d, f] = k.split('|')
  const pk = `${d}|${f}`
  if (!byProduct.has(pk)) byProduct.set(pk, [])
  byProduct.get(pk).push({ key: k, pos })
}

// allocations: "BRAND+DESIGN-FORMAT-PLATING" -> { MX: [ {item, qty, ...} ] }
const mixByProduct = new Map()
for (const [base, mixes] of Object.entries(derived.allocations)) {
  const m = base.match(/^([A-Z]+)(\d{4}|\w{4})-(\w+)-/)
  if (!m) continue
  const pk = `${m[2]}|${m[3]}`
  if (!mixByProduct.has(pk)) mixByProduct.set(pk, [])
  mixByProduct.get(pk).push({ base, mixes })
}

const sig = o => JSON.stringify(Object.entries(o).sort())

const targets = []
const skipped = { noSkeleton: 0, platingDisagrees: 0, mixDisagrees: 0 }

for (const p of products) {
  const pk = `${p.design_code}|${p.format_code}`
  const entries = byProduct.get(pk) || []
  if (!entries.length) { skipped.noSkeleton++; continue }

  // Every plating/brand of the same product must give the same positions.
  const shapes = new Set(entries.map(e => sig(e.pos)))
  if (shapes.size > 1) { skipped.platingDisagrees++; continue }

  const positions = Object.entries(entries[0].pos)
    .map(([k, qty]) => { const [shape, size] = k.split('|'); return { shape, size, qty: Number(qty) } })
    .sort((a, b) => a.shape.localeCompare(b.shape) || a.size.localeCompare(b.size))

  // Mixes, collapsed the same way. A mix defined differently under two
  // platings would be a real contradiction, so drop the product rather than
  // guess which is right.
  const mixes = {}
  let clash = false
  for (const { mixes: m } of (mixByProduct.get(pk) || [])) {
    for (const [code, lines] of Object.entries(m)) {
      const simple = lines.map(l => ({ code: l.item, qty: Number(l.qty) }))
        .sort((a, b) => a.code.localeCompare(b.code))
      if (mixes[code] && JSON.stringify(mixes[code]) !== JSON.stringify(simple)) { clash = true; break }
      mixes[code] = simple
    }
    if (clash) break
  }
  if (clash) { skipped.mixDisagrees++; continue }

  targets.push({
    id: p.id, pk, name: p.design_name || '',
    hadLegacyMixes: !!p.crystal_mixes,
    bom: { positions, mixes, source: 'erp', derived_at: new Date().toISOString() },
  })
}

;(async () => {
  const stones = t => t.bom.positions.reduce((n, x) => n + x.qty, 0)
  console.log(`${targets.length} products to write`)
  console.log(`  skipped: ${skipped.noSkeleton} with no derived skeleton, ` +
              `${skipped.platingDisagrees} where platings disagree, ` +
              `${skipped.mixDisagrees} where a mix is defined two ways`)
  console.log(`  legacy crystal_mixes to clear: ${targets.filter(t => t.hadLegacyMixes).length}\n`)
  for (const t of targets.slice(0, 12)) {
    console.log(`  ${t.pk}  ${t.name.slice(0, 28).padEnd(28)} ${stones(t)} stones, ` +
                `${t.bom.positions.length} position(s), ${Object.keys(t.bom.mixes).length} mix recipe(s)`)
  }
  if (targets.length > 12) console.log(`  … and ${targets.length - 12} more`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to write.'); process.exit(0) }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(OUTDIR, `crystal_bom_backup_${stamp}.json`)
  const byId = new Map(products.map(p => [p.id, p]))
  fs.writeFileSync(backup, JSON.stringify(targets.map(t => ({
    id: t.id, pk: t.pk,
    crystal_components: byId.get(t.id).crystal_components || null,
    crystal_mixes: byId.get(t.id).crystal_mixes || null,
  })), null, 2))
  console.log(`\nbackup -> ${path.relative(ROOT, backup)}`)

  let done = 0
  for (const t of targets) {
    await db.collection('range_products').doc(t.id).set({
      crystal_components: t.bom,
      crystal_mixes: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    done++
  }
  console.log(`written: ${done} documents`)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
