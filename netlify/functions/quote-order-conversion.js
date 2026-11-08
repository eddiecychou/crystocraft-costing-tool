import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createQuoteConversionHandler } from './lib/quoteConversionHandler.js'
import { createQuoteConversionRepository } from './lib/quoteConversionRepository.js'

export default async (req) => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createQuoteConversionHandler({
      verifyToken: (token) => getAuth().verifyIdToken(token, true),
      getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
      repo: createQuoteConversionRepository(db, () => FieldValue.serverTimestamp())
    })(req)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Conversion confirmation is temporarily unavailable.' }),
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
export const config = { path: '/api/quote-order-conversion' }
