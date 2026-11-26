import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { privateJson, customerDependencies } from './lib/customerAccess.js'
import { customerOcSource } from './lib/customerOcInvoices.js'
import { createCustomerOrderHistoryHandler, customerInvoiceLedger } from './lib/customerOrderHistory.js'
export default async (req) => {
  try {
    initAdminApp()
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SERVICE_KEY) throw Error('Server not configured')
    const db = getFirestore(),
      deps = { SUPABASE_URL, SERVICE_KEY }
    const oc = customerOcSource(db, (numbers) => customerInvoiceLedger(deps, numbers))
    const voidedOcNumbers = async numbers => new Set((await customerInvoiceLedger(deps, numbers, true)).map(row => row.si_no))
    return await createCustomerOrderHistoryHandler({ ...customerDependencies(db, getAuth()), ...deps, oc, voidedOcNumbers })(
      req,
    )
  } catch {
    return privateJson({ error: 'Order history is temporarily unavailable.' }, 503)
  }
}
export const config = { path: '/api/customer-order-history' }
