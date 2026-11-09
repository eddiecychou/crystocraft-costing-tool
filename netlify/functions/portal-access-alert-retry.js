import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { retryAccessAlerts } from './lib/portalAccessAlerts.js'

export default async () => {
  initAdminApp()
  await retryAccessAlerts(getFirestore())
  return new Response(null, { status: 204 })
}
export const config = { schedule: '*/5 * * * *' }
