import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { customerDependencies, privateJson } from './lib/customerAccess.js'
import { createInvoiceFollowupListHandler, readAwaitingInvoiceLinkPage, readInvoiceFollowupPage } from './lib/invoiceFollowupList.js'
import { createInvoiceRecoverySql } from './lib/invoiceRecoverySql.js'

export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createInvoiceFollowupListHandler({ ...customerDependencies(db, getAuth()),
      readPage: after => readInvoiceFollowupPage(db, after),
      readAwaitingLinkPage: after => {
        const url = process.env.SUPABASE_URL
        const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw Error('Server configuration')
        const { lookup } = createInvoiceRecoverySql({ url: url.replace(/\/$/, ''), key, timeoutMs: 10000 })
        return readAwaitingInvoiceLinkPage(db, lookup, after)
      } })(req)
  } catch {
    return privateJson({ error: 'Invoice follow-ups are temporarily unavailable. Please retry.' }, 503)
  }
}

export const config = { path: '/api/invoice-followups' }
