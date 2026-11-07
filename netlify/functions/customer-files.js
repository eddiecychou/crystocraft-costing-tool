import {getAuth} from 'firebase-admin/auth'
import {getFirestore,FieldValue,FieldPath} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {createCustomerFilesHandler,createCustomerFilesRepository} from './lib/customerFiles.js'
import {createCustomerFileObjects} from './lib/customerFileObjects.js'

export default async req => {
  try {
    initAdminApp()
    const bucketName = process.env.VITE_FIREBASE_STORAGE_BUCKET
    if (!bucketName || !/^[a-z0-9.-]+$/.test(bucketName)) throw Error('Missing bucket')
    const db = getFirestore(), bucket = getStorage().bucket(bucketName)
    return await createCustomerFilesHandler({
      verifyToken: token => getAuth().verifyIdToken(token,true),
      getProfile: async uid => (await db.doc('users/'+uid).get()).data(),
      repo: createCustomerFilesRepository(db,() => FieldValue.serverTimestamp(),() => FieldPath.documentId()),
      objects: createCustomerFileObjects(bucket),
    })(req)
  } catch {
    return new Response(JSON.stringify({error:'Customer files are temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}})
  }
}
export const config = {path:'/api/customer-files'}
