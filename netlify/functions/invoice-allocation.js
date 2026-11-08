import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createInvoiceRecoveryHandler } from './lib/invoiceRecovery.js'
import { createInvoiceRecoveryRepository } from './lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoverySql } from './lib/invoiceRecoverySql.js'

export default async (req) => {
  try {
    initAdminApp()
    const db = getFirestore(),
      url = process.env.SUPABASE_URL,
      key =
        process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url))
      throw Error('Server configuration')
    return await createInvoiceRecoveryHandler({
      verifyToken: (token) => getAuth().verifyIdToken(token, true),
      getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
      repo: createInvoiceRecoveryRepository(db, () =>
        FieldValue.serverTimestamp()
      ),
      sql: createInvoiceRecoverySql({ url: url.replace(/\/$/, ''), key })
    })(req)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invoice recovery is temporarily unavailable.' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store'
        }
      }
    )
  }
}
export const config = { path: '/api/invoice-allocation' }
