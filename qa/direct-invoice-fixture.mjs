import { FieldValue } from 'firebase-admin/firestore'
import { createInvoiceRecoveryRepository } from '../netlify/functions/lib/invoiceRecoveryRepository.js'
import { createInvoiceRecoveryHandler } from '../netlify/functions/lib/invoiceRecovery.js'
import { createInvoiceRecoverySql } from '../netlify/functions/lib/invoiceRecoverySql.js'
import { invoiceTestRest } from './invoice-recovery-rest-fixture.mjs'

export function directInvoiceFixture(
  store,
  sqlDb,
  faults = {},
  verifyToken = async (uid) => ({ uid, email: uid + '@example.invalid' })
) {
  const repo = createInvoiceRecoveryRepository(store, () =>
    FieldValue.serverTimestamp()
  )
  const sql = createInvoiceRecoverySql({
    url: 'http://127.0.0.1/fictional',
    key: 'fictional',
    fetchImpl: invoiceTestRest(sqlDb, faults)
  })
  const handler = createInvoiceRecoveryHandler({
    verifyToken,
    getProfile: async (uid) => (await store.doc('users/' + uid).get()).data(),
    repo: {
      ...repo,
      async link(...args) {
        if (faults.beforeLink) {
          faults.beforeLink = false
          throw Error(
            'Fictional interruption before linking the issued invoice.'
          )
        }
        return repo.link(...args)
      }
    },
    sql
  })
  return { handler, repo }
}
