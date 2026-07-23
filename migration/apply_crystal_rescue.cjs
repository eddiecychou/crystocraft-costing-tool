#!/usr/bin/env node
/**
 * Write the rescued crystal BOMs for products the ERP never built directly.
 *
 * Confirmed by the owner 2026-07-23:
 *   route  — the app sells D0018-001 while the ERP only has U0018-001. Same
 *            design, same figurine; only the stone supplier changed because
 *            Swarovski ran out. So the skeleton carries over.
 *   format — -236 (music box) and -001 (freestand) have the same crystal
 *            content. So the skeleton carries over.
 *
 * Mixes are treated more carefully than skeletons:
 *   - format rescue, source route the app still sells -> recipes copied
 *     verbatim, because the stone codes are the same family;
 *   - route rescue -> recipes NOT copied. They name the OLD supplier's codes
 *     (Swarovski) and this product uses the new one (Bohemia). Translating
 *     code-by-code across families would be an inference stacked on an
 *     inference. The app already reports an undefined mix as a question rather
 *     than silently ordering nothing, which is how the owner chose to handle
 *     never-ordered mixes, so those are left to be filled on first order.
 *
 * Provenance is written as source:'erp-rescue' with rescued_from, so the editor
 * badges these as inferred rather than derived.
 *
 *   dry run:  node migration/apply_crystal_rescue.cjs
 *   apply:    node migration/apply_crystal_rescue.cjs --apply
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const OUTDIR = path.join(__dirname, 'out')
const APPLY = process.argv.includes('--apply')

const key = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-service-account.json'), 'utf8'))
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
initializeApp({ credential: cert(key), projectId: key.project_id })
const db = getFirestore()

const rescue = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'crystal_bom_rescue.json'), 'utf8'))
const products = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'range_products.json'), 'utf8')).products
const derived = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'crystal_bom_derived.json'), 'utf8'))

const MIX = /^(M[X0-9]|A[X0-9]|G[X0-9])$/

const byKey = new Map()
for (const p of products) {
  const k = `${p.design_code}|${p.format_code}`
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(p)
}

// Recipes already derived, keyed "BRAND+DESIGN-FORMAT-PLATING" -> { MX: [...] }.
// Used for format rescues: the sibling format's own recipes.
const allocByBase = derived.allocations || {}

const targets = []
const skipped = { ambiguousKey: 0, alreadyHasBom: 0, noPositions: 0 }
let mixesCopied = 0
const mixLeft = []

for (const [k, prop] of Object.entries(rescue)) {
  const [d, f] = k.split('|')
  const matches = byKey.get(k) || []
  if (matches.length !== 1) { skipped.ambiguousKey++; continue }
  const p = matches[0]

  const cc = p.crystal_components
  if (cc && ((cc.positions || []).length || Object.keys(cc.mixes || {}).length)) {
    skipped.alreadyHasBom++; continue
  }
  if (!prop.positions || !prop.positions.length) { skipped.noPositions++; continue }

  const appRoutes = new Set((p.variants || []).map(v => v.brand_code).filter(Boolean))
  const isRoute = String(prop.source).includes('route')

  // Which mix codes does the app actually offer here?
  const offered = new Set()
  for (const v of p.variants || []) {
    for (const col of v.crystal_colors || []) if (MIX.test(col)) offered.add(col)
  }

  const mixes = {}
  if (!isRoute && offered.size) {
    // Format rescue: pull the sibling format's recipes, but only from a route
    // this product actually sells, so the stone codes are the right family.
    for (const code of prop.from_codes) {
      const route = code[0]
      if (!appRoutes.has(route)) continue
      const base = code.replace(/-([A-Z])([A-Z0-9]*)$/, '-$1')
      for (const [mixCode, lines] of Object.entries(allocByBase[base] || {})) {
        if (!offered.has(mixCode) || mixes[mixCode]) continue
        mixes[mixCode] = lines.map(l => ({ code: l.item, qty: Number(l.qty) }))
        mixesCopied++
      }
    }
  }
  const stillUndefined = [...offered].filter(m => !mixes[m])
  if (stillUndefined.length) {
    mixLeft.push({ key: k, name: p.design_name || '', why: isRoute ? 'route swap' : 'no sibling recipe', mixes: stillUndefined })
  }

  targets.push({
    id: p.id, key: k, name: p.design_name || '',
    source: prop.source, agree: prop.agree,
    bom: {
      positions: prop.positions.map(x => ({ shape: x.shape, size: x.size, qty: Number(x.qty) })),
      mixes,
      source: 'erp-rescue',
      derived_at: new Date().toISOString(),
      rescued_from: prop.from_codes.slice(0, 6),
    },
  })
}

;(async () => {
  const stones = t => t.bom.positions.reduce((n, x) => n + x.qty, 0)
  console.log(`${targets.length} products to rescue`)
  console.log(`  skipped: ${skipped.alreadyHasBom} already have a BOM, ` +
              `${skipped.ambiguousKey} ambiguous key, ${skipped.noPositions} no positions`)
  console.log(`  mix recipes copied (format rescues): ${mixesCopied}`)
  console.log(`  products whose offered mixes stay undefined: ${mixLeft.length}\n`)
  const disagree = targets.filter(t => !t.agree).length
  console.log(`  of these, ${disagree} had source codes that disagreed — most common shape used, flagged inferred\n`)
  for (const t of targets.slice(0, 10)) {
    console.log(`  ${t.key}  ${t.name.slice(0, 26).padEnd(26)} ${stones(t)} stones  ${t.source}  ${Object.keys(t.bom.mixes).length} mix`)
  }
  if (targets.length > 10) console.log(`  … and ${targets.length - 10} more`)

  fs.writeFileSync(path.join(OUTDIR, 'crystal_rescue_mixes_open.json'), JSON.stringify(mixLeft, null, 2))
  console.log(`\n-> migration/out/crystal_rescue_mixes_open.json (${mixLeft.length} products needing a mix recipe)`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to write.'); process.exit(0) }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(OUTDIR, `crystal_rescue_backup_${stamp}.json`)
  const byId = new Map(products.map(p => [p.id, p]))
  fs.writeFileSync(backup, JSON.stringify(targets.map(t => ({
    id: t.id, key: t.key,
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
