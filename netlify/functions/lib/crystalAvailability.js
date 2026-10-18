import {crystalStockAvailability,validCrystalId} from '../../../src/domain/crystalProducts.js'
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers})
export function createCrystalAvailabilityHandler({verifyToken,getProfile,getProduct,getVariant,getMapping,getStock}) {
 return async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if(!token||token.length>8192)return json({error:'Sign in required'},401)
  let uid
  try{uid=(await verifyToken(token)).uid;if(!uid)throw Error()}catch{return json({error:'Sign in required'},401)}
  try{
   const profile=await getProfile(uid)
   if(!(profile?.role==='admin'||profile?.role==='customer'&&profile.status==='approved'||profile?.role==='staff'&&profile.modules?.includes('swatch')))return json({error:'Access denied'},403)
   let body
   try{const raw=await req.text();if(raw.length>2048)throw Error();body=JSON.parse(raw)}catch{return json({error:'Invalid request'},400)}
   const {productId,variantId}=body||{}
   if(!validCrystalId(productId)||!validCrystalId(variantId))return json({error:'Invalid selection'},400)
   const [product,variant]=await Promise.all([getProduct(productId),getVariant(productId,variantId)])
   if(product?.publication!=='published'||variant?.publication!=='published'||!variant.confirmed)return json({error:'Selection unavailable'},404)
   const mapping=await getMapping(productId,variantId)
   const stock=mapping?.reviewed&&mapping.collection==='crystals'&&validCrystalId(mapping.inventory_id)?await getStock(mapping.inventory_id):null
   return json({productId,variantId,availability:{...crystalStockAvailability(product,variant,mapping,stock),checkedAt:new Date().toISOString()}})
  }catch{return json({error:'Availability temporarily unavailable'},503)}
 }
}
