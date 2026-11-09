import {getAuth} from 'firebase-admin/auth'
import {getFirestore,FieldPath} from 'firebase-admin/firestore'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {createCustomerWorkbenchHandler,loadCustomerActivity} from './lib/customerWorkbench.js'

export default async req=>{
  try{
    initAdminApp()
    const db=getFirestore()
    return await createCustomerWorkbenchHandler({
      verifyToken:token=>getAuth().verifyIdToken(token,true),
      getProfile:async uid=>(await db.doc('users/'+uid).get()).data(),
      load:()=>loadCustomerActivity(db,()=>FieldPath.documentId()),
    })(req)
  }catch{return new Response(JSON.stringify({error:'Contact history is temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store',Vary:'Authorization'}})}
}
export const config={path:'/api/customer-workbench'}
