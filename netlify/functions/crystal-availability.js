import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {createCrystalAvailabilityHandler} from './lib/crystalAvailability.js'
export default async req=>{
 try{initAdminApp()}catch{return new Response(JSON.stringify({error:'Availability temporarily unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}})}
 const db=getFirestore(),read=async path=>(await db.doc(path).get()).data()
 return createCrystalAvailabilityHandler({
  verifyToken:token=>getAuth().verifyIdToken(token,true),
  getProfile:uid=>read('users/'+uid),getProduct:id=>read('crystal_products/'+id),
  getVariant:(pid,vid)=>read('crystal_products/'+pid+'/variants/'+vid),
  getMapping:(pid,vid)=>read('crystal_product_private/'+pid+'/variants/'+vid),
  getStock:async id=>(await db.getAll(db.doc('crystals/'+id),{fieldMask:['stock_qty','reserved_qty']}))[0].data(),
 })(req)
}
export const config={path:'/api/crystal-availability'}
