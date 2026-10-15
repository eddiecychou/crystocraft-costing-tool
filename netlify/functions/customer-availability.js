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
    getComponents:async refs=>{
      const found = new Map()
      const ids = [...new Set(refs.map(r=>r.id).filter(id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))]
      if(ids.length) for(const snap of await db.getAll(...ids.map(id=>db.doc(`range_components/${id}`)))) if(snap.exists) found.set(snap.id,{...snap.data(),id:snap.id})
      const codes = [...new Set(refs.filter(r=>!found.has(r.id)).map(r=>String(r.code||'').trim().toUpperCase()).filter(Boolean))]
      for(let i=0;i<codes.length;i+=30) {
        const snaps = await db.collection('range_components').where('code','in',codes.slice(i,i+30)).get()
        for(const snap of snaps.docs) found.set(snap.id,{...snap.data(),id:snap.id})
      }
      return [...found.values()]
    },
  })(req)
}
export const config = { path:'/api/customer-availability' }
