const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'}
const error=(message,status)=>new Response(JSON.stringify({error:message}),{status,headers:{...headers,'Content-Type':'application/json'}})
export function parseCrystalPhotoPath(path) {
 const m=typeof path==='string'&&path.match(/^crystal-products\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/[a-f0-9]{64}\/(original\.(jpg|png|webp)|display\.jpg|thumbnail\.jpg)$/)
 return m?{productId:m[1],imageId:m[2]}:null
}
// Storage cross-service rules allow only two distinct Firestore lookups. Product
// media needs profile + parent + image; keep direct customer Storage reads denied
// and perform all three deterministic checks here before reading the fixed bucket.
export function createCrystalMediaHandler({verifyToken,getProfile,getProduct,getImage,readObject}) {
 return async req=>{
  if(req.method!=='GET')return error('Method not allowed',405)
  const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if(!token||token.length>8192)return error('Please sign in.',401)
  const path=new URL(req.url).searchParams.get('file'),selection=parseCrystalPhotoPath(path)
  if(!selection)return error('Invalid photograph.',400)
  let uid
  try{uid=(await verifyToken(token)).uid;if(!uid)throw Error()}catch{return error('Please sign in.',401)}
  try{
   const profile=await getProfile(uid),staff=profile?.role==='admin'||profile?.role==='staff'&&Array.isArray(profile.modules)&&profile.modules.includes('swatch'),customer=profile?.role==='customer'&&profile.status==='approved'
   if(!staff&&!customer)return error('Access denied.',403)
   const [product,image]=await Promise.all([getProduct(selection.productId),getImage(selection.productId,selection.imageId)])
   if(!product||!image)return error('Photograph unavailable.',404)
   if(!staff&&(product.publication!=='published'||image.publication!=='published'||!image.media||![image.media.original,image.media.display,image.media.thumbnail].includes(path)))return error('Photograph unavailable.',403)
   const {bytes,mime}=await readObject(path)
   if(!['image/jpeg','image/png','image/webp'].includes(mime)||!bytes?.byteLength||bytes.byteLength>20971520)return error('Invalid photograph.',502)
   return new Response(bytes,{headers:{...headers,'Content-Type':mime}})
  }catch(e){return error('Photograph could not be loaded. Please retry.',e?.code===404?404:502)}
 }
}
