import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { privateJson, customerDependencies } from './lib/customerAccess.js'
import { createCustomerCatalogueHandler, loadCorporateCatalogue } from './lib/customerCatalogue.js'
import { loadCustomerRange } from './lib/customerRange.js'
export default async req => {
  try {
    initAdminApp()
    const db = getFirestore()
    return await createCustomerCatalogueHandler({ ...customerDependencies(db, getAuth()),
      load: (id, uid) => loadCorporateCatalogue(db, id, uid),
      loadRange: (id, profile) => loadCustomerRange(db, id, profile),
      loadFeatured: async () => (await db.doc('settings/front_page').get()).data(),
    })(req)
  } catch { return privateJson({ error: 'Catalogue is temporarily unavailable.' }, 503) }
}
export const config = { path: '/api/customer-catalogue' }
