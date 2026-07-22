#!/usr/bin/env node
/**
 * Dump the live `range_products` collection out of Firestore.
 *
 * Firestore rules gate `range_products` behind canShop(), so the web SDK needs
 * a signed-in approved user. The Admin SDK bypasses rules instead, which is
 * why this needs a service-account key rather than the VITE_ config in
 * .env.local.
 *
 *   key:  ./firebase-service-account.json   (gitignored, never commit)
 *   run:  node migration/pull_range.cjs
 *   out:  migration/out/range_products.json
 *
 * Read-only: opens the collection, writes a file, touches nothing in Firestore.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KEY = path.join(ROOT, 'firebase-service-account.json')
const OUTDIR = path.join(__dirname, 'out')
const OUT = path.join(OUTDIR, 'range_products.json')

if (!fs.existsSync(KEY)) {
  console.error(`No service-account key at ${KEY}`)
  console.error('Firebase console -> Project settings -> Service accounts -> Generate new private key')
  process.exit(1)
}

// firebase-admin 13+ dropped `credential` from the CJS root export; the
// modular subpaths are the supported entry points.
let initializeApp, cert, getFirestore
try {
  ;({ initializeApp, cert } = require('firebase-admin/app'))
  ;({ getFirestore } = require('firebase-admin/firestore'))
} catch {
  console.error('firebase-admin not installed. From the repo root:')
  console.error('  npm install --no-save firebase-admin')
  process.exit(1)
}

const key = JSON.parse(fs.readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(key), projectId: key.project_id })

// Firestore Timestamps and DocumentReferences do not survive JSON.stringify in
// any useful form — flatten them so the derivation script sees plain values.
const plain = v => {
  if (v === null || typeof v !== 'object') return v
  if (typeof v.toDate === 'function') return v.toDate().toISOString()
  if (v._firestore && v.path) return { __ref: v.path }
  if (Array.isArray(v)) return v.map(plain)
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
}

;(async () => {
  const snap = await getFirestore().collection('range_products').get()
  const products = snap.docs.map(d => ({ id: d.id, ...plain(d.data()) }))
  products.sort((a, b) => String(a.design_code || '').localeCompare(String(b.design_code || '')))

  fs.mkdirSync(OUTDIR, { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ pulled_at: new Date().toISOString(), products }, null, 2))

  const byPrefix = {}
  for (const p of products) {
    const c = String(p.design_code || '?')[0] || '?'
    byPrefix[c] = (byPrefix[c] || 0) + 1
  }
  console.log(`${products.length} products -> ${path.relative(ROOT, OUT)}`)
  console.log('by design_code prefix:', byPrefix)
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
