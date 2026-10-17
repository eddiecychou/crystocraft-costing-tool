import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {createCustomerMergeHandler, mergeCustomerRecords} from './lib/customerMerge.js'
export default async req=>{
  try{initAdminApp()}catch{return new Response(JSON.stringify({error:'Merge service temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}})}
  const db=getFirestore()
  return createCustomerMergeHandler({verifyToken:token=>getAuth().verifyIdToken(token,true),getProfile:async uid=>(await db.doc(`users/${uid}`).get()).data(),merge:(source,target,uid)=>mergeCustomerRecords(db,source,target,uid)})(req)
}
export const config={path:'/api/customer-merge'}
