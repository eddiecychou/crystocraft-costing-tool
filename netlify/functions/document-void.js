import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { customerDependencies, privateJson } from './lib/customerAccess.js'
import { createDocumentVoidHandler, createDocumentVoidSql, createPiVoidRepository } from './lib/documentVoids.js'

export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createDocumentVoidHandler({
      ...customerDependencies(db, getAuth()),
      pi: createPiVoidRepository(db, () => FieldValue.serverTimestamp()),
      ledger: () => {
        const url = process.env.SUPABASE_URL
        const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw Error('Ledger unavailable')
        return createDocumentVoidSql({ url, key })
      },
    })(req)
  } catch {
    return privateJson({ error: 'Document status is temporarily unavailable.' }, 503)
  }
}
export const config = { path: '/api/document-void' }
