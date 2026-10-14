// Explicit owner-approved operation only. Never run during tests or deploy.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { rangeServiceUid } from '../product-writer/auth.mjs'

const keyPath = fileURLToPath(new URL('../../firebase-service-account.json', import.meta.url))
if (!fs.existsSync(keyPath)) throw new Error('firebase-service-account.json is required on the configured OC Mac')
const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) }, 'figurine-range-provisioner')
const auth = getAuth(app)
const db = getFirestore(app)
try { await auth.getUser(rangeServiceUid) } catch (error) {
  if (error.code !== 'auth/user-not-found') throw error
  await auth.createUser({ uid: rangeServiceUid, displayName: 'OC Figurine B0016 MCP service' })
}
const ref = db.collection('users').doc(rangeServiceUid)
const existing = await ref.get()
await ref.set({ role: 'staff', modules: [], account_type: 'internal', service_identity: true, service_scope: 'figurine-range-b0016', display_name: 'OC Figurine B0016 MCP service', updated_at: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { created_at: FieldValue.serverTimestamp() }) }, { merge: true })
console.log('Provisioned dedicated B0016 Figurine service with no broad OC modules.')
