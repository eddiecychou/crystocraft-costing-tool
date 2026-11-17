import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { customerDependencies, privateJson } from './lib/customerAccess.js'
import { createOcInvoiceSummariesHandler, loadOcInvoiceSources, readOcInvoiceLedger } from './lib/ocInvoiceSummaries.js'
import { createOcInvoicePdfArchive } from './lib/ocInvoicePdfs.js'
import { createInvoiceRecoverySql } from './lib/invoiceRecoverySql.js'
import { readInvoiceFinanceLookup } from './lib/invoiceFinanceLookup.js'

export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    const issuer = process.env.OC_INVOICE_PDF_ISSUER
    const bucketName = process.env.VITE_FIREBASE_STORAGE_BUCKET
    const archive = process.env.OC_INVOICE_PDF_PILOT === 'true' && /^[a-z0-9-]{1,64}$/.test(issuer || '') &&
      /^[a-z0-9.-]+$/.test(bucketName || '') ? createOcInvoicePdfArchive(db, () => getStorage().bucket(bucketName), issuer) : undefined
    return await createOcInvoiceSummariesHandler({
      ...customerDependencies(db, getAuth()),
      archive,
      lookup: target => {
        const url = process.env.SUPABASE_URL
        const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw Error('Invoice ledger configuration')
        const sql = createInvoiceRecoverySql({ url:url.replace(/\/$/, ''), key, timeoutMs:7000 })
        return readInvoiceFinanceLookup(db, sql, target)
      },
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
