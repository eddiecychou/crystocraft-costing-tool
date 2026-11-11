// Dry-run by default. Run only after reading docs/plans/V8.20-REVIEW-FIVE-FIXES.md.
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initAdminApp } from '../netlify/functions/lib/firebaseAdmin.js'
import { migrateAccountPricing, PRIVATE_PRICING_FIELDS } from '../netlify/functions/lib/accountPricingMigration.js'
initAdminApp()
const db = getFirestore(), apply = process.argv.includes('--apply')
const users = await db.collection('users').select(...PRIVATE_PRICING_FIELDS).get()
let candidates = 0
// Complete the read-only conflict pass BEFORE the first migration write.
for (const d of users.docs) if (await migrateAccountPricing(db, d.id)) candidates++
if (apply) for (const d of users.docs) await migrateAccountPricing(db, d.id, { apply, deleteField: () => FieldValue.delete(), timestamp: () => FieldValue.serverTimestamp() })
const remaining = (await db.collection('users').select(...PRIVATE_PRICING_FIELDS).get()).docs.filter(d => PRIVATE_PRICING_FIELDS.some(k => Object.hasOwn(d.data(), k))).length
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accounts: users.size, candidates, remaining }))
if (apply && remaining) throw Error('Migration incomplete; do not close release.')
