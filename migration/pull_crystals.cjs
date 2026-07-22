#!/usr/bin/env node
/**
 * Dump the `crystals` collection — the app's crystal stock items.
 *
 * Needed to check which of the 17 codes in
 * erp-sync/inventory/crystal_missing_import.tsv are still actually missing.
 * That list was measured in V7.17 and some may have been added since.
 *
 *   run:  node migration/pull_crystals.cjs
 *   out:  migration/out/crystals_app.json
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const OUT = path.join(__dirname, 'out', 'crystals_app.json')

if (!fs.existsSync(KEY)) { console.error(`No key at ${KEY}`); process.exit(1) }

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })

const plain = v => {
  if (v === null || typeof v !== 'object') return v
  if (typeof v.toDate === 'function') return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(plain)
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
}

;(async () => {
  const snap = await getFirestore().collection('crystals').get()
  const items = snap.docs.map(d => ({ id: d.id, ...plain(d.data()) }))
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ pulled_at: new Date().toISOString(), items }, null, 2))
  console.log(`${items.length} crystals -> ${path.relative(ROOT, OUT)}`)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
