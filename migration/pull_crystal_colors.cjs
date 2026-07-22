#!/usr/bin/env node
/**
 * Dump settings/crystal_colors — the app's shared colour library.
 *
 * The ERP names colours in words ("Rosaline"); the app names them in two-letter
 * codes ("PI"). Cross-referencing them needs the app's own code -> name list,
 * which lives in this one settings doc rather than on the products.
 *
 *   run:  node migration/pull_crystal_colors.cjs
 *   out:  migration/out/crystal_colors_app.json
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const OUT = path.join(__dirname, 'out', 'crystal_colors_app.json')

if (!fs.existsSync(KEY)) {
  console.error(`No service-account key at ${KEY}`)
  process.exit(1)
}

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })

;(async () => {
  const snap = await getFirestore().doc('settings/crystal_colors').get()
  if (!snap.exists) {
    console.error('settings/crystal_colors does not exist')
    process.exit(1)
  }
  const colors = snap.data().colors || []
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ colors }, null, 2))
  console.log(`${colors.length} colours -> ${path.relative(ROOT, OUT)}`)
  for (const c of colors) console.log(`  ${String(c.code).padEnd(4)} ${c.name || ''}`)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
