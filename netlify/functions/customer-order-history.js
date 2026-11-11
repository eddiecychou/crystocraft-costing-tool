import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { privateJson, customerDependencies } from './lib/customerAccess.js'
import { createCustomerOrderHistoryHandler } from './lib/customerOrderHistory.js'
export default async req => {
  try {
    initAdminApp()
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SERVICE_KEY) throw Error('Server not configured')
    return await createCustomerOrderHistoryHandler({ ...customerDependencies(getFirestore(), getAuth()), SUPABASE_URL, SERVICE_KEY })(req)
  } catch { return privateJson({ error: 'Order history is temporarily unavailable.' }, 503) }
}
export const config = { path: '/api/customer-order-history' }
