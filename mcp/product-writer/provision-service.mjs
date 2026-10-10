// Explicit, local-only provisioning for the two least-privilege MCP identities.
// This script is not run by tests or deployment; it requires owner approval.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { pricingServiceUid, serviceUid } from './auth.mjs'

const keyPath = fileURLToPath(new URL('../../firebase-service-account.json', import.meta.url))
if (!fs.existsSync(keyPath)) throw new Error('firebase-service-account.json is required')
const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) }, 'mcp-provisioner')
const auth = getAuth(app); const db = getFirestore(app)
async function provision(uid, display_name, modules, service_scope) {
  try { await auth.getUser(uid) } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    await auth.createUser({ uid, displayName: display_name })
  }
  const ref = db.collection('users').doc(uid); const existing = await ref.get()
  await ref.set({ role: 'staff', modules, account_type: 'internal', service_identity: true, service_scope, display_name, updated_at: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { created_at: FieldValue.serverTimestamp() }) }, { merge: true })
}
await provision(serviceUid, 'Operation Center product-writer service', ['products', 'supply'], 'corporate-gift-product-writer')
await provision(pricingServiceUid, 'Operation Center catalogue pricing dry-run service', ['products', 'supply', 'pricing'], 'catalogue-pricing-dry-run')
console.log('Provisioned the catalogue writer and dry-run pricing service identities.')
