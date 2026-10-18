import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {initAdminApp} from './lib/firebaseAdmin.js'
import {createCrystalMediaHandler} from './lib/crystalMedia.js'
export default async req=>{
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'}
 try{initAdminApp()}catch{return new Response(JSON.stringify({error:'Photographs temporarily unavailable.'}),{status:503,headers})}
 const bucket=process.env.VITE_FIREBASE_STORAGE_BUCKET
 if(!bucket||!/^[a-z0-9.-]+$/.test(bucket))return new Response(JSON.stringify({error:'Photographs temporarily unavailable.'}),{status:503,headers})
 const db=getFirestore()
 return createCrystalMediaHandler({
  verifyToken:token=>getAuth().verifyIdToken(token,true),
  getProfile:async uid=>(await db.doc('users/'+uid).get()).data(),
  getProduct:async id=>(await db.doc('crystal_products/'+id).get()).data(),
  getImage:async(pid,iid)=>(await db.doc('crystal_products/'+pid+'/images/'+iid).get()).data(),
  readObject:async path=>{
   const file=getStorage().bucket(bucket).file(path),[meta]=await file.getMetadata()
   if(!Number.isFinite(Number(meta.size))||Number(meta.size)<=0||Number(meta.size)>20971520)throw Error('Invalid image size')
   const [bytes]=await file.download({validation:'crc32c'})
   return {bytes,mime:meta.contentType}
  },
 })(req)
}
export const config={path:'/api/crystal-product-media'}
