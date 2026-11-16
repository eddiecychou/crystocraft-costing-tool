import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { customerDependencies, privateJson } from './lib/customerAccess.js'
import { createInvoiceFollowupListHandler, readInvoiceFollowupPage } from './lib/invoiceFollowupList.js'

export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createInvoiceFollowupListHandler({ ...customerDependencies(db, getAuth()),
      readPage: after => readInvoiceFollowupPage(db, after) })(req)
  } catch {
    return privateJson({ error: 'Invoice follow-ups are temporarily unavailable. Please retry.' }, 503)
  }
}

export const config = { path: '/api/invoice-followups' }
