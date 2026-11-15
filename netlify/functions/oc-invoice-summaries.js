import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { customerDependencies, privateJson } from './lib/customerAccess.js'
import { createOcInvoiceSummariesHandler, loadOcInvoiceSources, readOcInvoiceLedger } from './lib/ocInvoiceSummaries.js'

export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createOcInvoiceSummariesHandler({
      ...customerDependencies(db, getAuth()),
      load: () => loadOcInvoiceSources(db, () => {
        const url = process.env.SUPABASE_URL
        if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw Error('Invoice ledger configuration')
        return readOcInvoiceLedger(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
      }),
    })(req)
  } catch {
    return privateJson({ error: 'OC invoice summaries are temporarily unavailable. Please retry.' }, 503)
  }
}

export const config = { path: '/api/oc-invoice-summaries' }
