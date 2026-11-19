import { loadAvailabilityComponents } from './lib/availabilityComponents.js'
// Read-only customer projection. Admin SDK stays on the server; Firestore rules
// continue to deny customers access to the component/supplier collections.
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createAvailabilityHandler } from './lib/customerAvailability.js'

export default async req => {
  try { initAdminApp() } catch { return new Response(JSON.stringify({error:'Availability temporarily unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}}) }
  const db = getFirestore()
  return createAvailabilityHandler({
    verifyToken:token=>getAuth().verifyIdToken(token,true),
    getProfile:async uid=>(await db.doc(`users/${uid}`).get()).data(),
    getProduct:async id=>(await db.doc(`range_products/${id}`).get()).data(),
    getDefaults:async()=>({defaultPartsLeadWeeks:Number((await db.doc('settings/productDefaults').get()).data()?.default_parts_lead_weeks)||6}),
    getComponents:refs=>loadAvailabilityComponents(db, db, refs),
  })(req)
}
export const config = { path:'/api/customer-availability' }
