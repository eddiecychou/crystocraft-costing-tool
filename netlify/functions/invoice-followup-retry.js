import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createInvoiceRecoveryRepository } from './lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoverySql } from './lib/invoiceRecoverySql.js'
import { retryDueInvoiceFollowups } from './lib/invoiceFollowup.js'

export default async () => {
  initAdminApp()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || ''))
    throw Error('Invoice follow-up database is not configured.')
  const repo = createInvoiceRecoveryRepository(getFirestore(), () => FieldValue.serverTimestamp())
  const sql = createInvoiceRecoverySql({ url: url.replace(/\/$/, ''), key, timeoutMs: 4500 })
  await retryDueInvoiceFollowups(repo, sql)
  return new Response(null, { status: 204 })
}

export const config = { schedule: '* * * * *' }
