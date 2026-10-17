import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const IMAGE_LINK_SECONDS = 300
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,128}$/
const validId = value => typeof value==='string' && ID.test(value)
const TYPES = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/gif','gif']])
const commonHeaders = {'Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Authorization'}
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{...commonHeaders,'Content-Type':'application/json'}})
class ImageAccessError extends Error { constructor(code,status,message){super(message);this.code=code;this.status=status} }
const fail = (code,status,message) => { throw new ImageAccessError(code,status,message) }
const sha = value => createHash('sha256').update(value).digest('hex')
const equal = (a,b) => timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)))
const secretValid = secret => typeof secret==='string' && Buffer.byteLength(secret)>=32
// Deliberately do NOT use imageVisibility(): its legacy fallback is public.
export const isPublishableProductImage = image => image?.visibility==='public'
  && (image.branded_for_customer_id===null || image.branded_for_customer_id===undefined || image.branded_for_customer_id==='')

export function approvedStoragePath(image,productId,bucketName){
  let path
  try {
    const u=new URL(image.file_url)
    if(u.protocol!=='https:' || u.username || u.password || u.port || u.hash)return null
    if(u.hostname==='firebasestorage.googleapis.com') {
      const match=u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/)
      if(!match || match[1]!==bucketName)return null
      path=decodeURIComponent(match[2])
    } else if(u.hostname==='storage.googleapis.com') {
      if(!u.pathname.startsWith('/'+bucketName+'/'))return null
      path=decodeURIComponent(u.pathname.slice(bucketName.length+2))
    } else return null
  } catch {return null}
  if(!path.startsWith(`products/${productId}/images/`) || /[\x00-\x1f\x7f\\]/.test(path) || path.split('/').some(p=>!p || p==='.' || p==='..'))return null
  if(image.storage_path && image.storage_path!==path)return null
  return path
}
function metadataInfo(metadata,path){
  const size=Number(metadata.size),type=metadata.contentType,generation=String(metadata.generation || '')
  if(!TYPES.has(type) || !Number.isSafeInteger(size) || size<1 || size>MAX_IMAGE_BYTES || !/^\d{1,24}$/.test(generation) || !/^[A-Za-z0-9+/]{22}==$/.test(metadata.md5Hash || ''))fail('IMAGE_UNAVAILABLE',503,'An approved image needs its file format, size or metadata checked.')
  const hash='md5:'+Buffer.from(metadata.md5Hash,'base64').toString('hex')
  return {size,type,generation,hash,revision:sha(JSON.stringify([path,generation,hash,size,type]))}
}
function sign(payload,secret){const data=Buffer.from(JSON.stringify(payload)).toString('base64url');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url')}
function verify(token,secret,now,origin){
  if(typeof token!=='string'||token.length>2048)fail('INVALID_LINK',403,'Invalid image link.')
  const parts=token.split('.')
  if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))fail('INVALID_LINK',403,'Invalid image link.')
  const expected=createHmac('sha256',secret).update(parts[0]).digest('base64url')
  if(!equal(parts[1],expected))fail('INVALID_LINK',403,'Invalid image link.')
  let p;try{p=JSON.parse(Buffer.from(parts[0],'base64url').toString())}catch{fail('INVALID_LINK',403,'Invalid image link.')}
  if(p?.v!==1||p.a!==origin||!validId(p.p)||!validId(p.i)||!Number.isSafeInteger(p.e)||!/^([a-f0-9]{64})$/.test(p.r))fail('INVALID_LINK',403,'Invalid image link.')
  if(p.e<=now)fail('EXPIRED_LINK',410,'Image link expired. Request a fresh image list.')
  if(p.e>now+IMAGE_LINK_SECONDS)fail('INVALID_LINK',403,'Invalid image link.')
  return p
}
function signatureMatches(bytes,type){
  if(type==='image/jpeg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
  if(type==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if(type==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
  if(type==='image/gif')return ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))
  return false
}
const dimension = n => Number.isInteger(n)&&n>0&&n<=50000?n:null

// Reads exactly one product's gallery and approved objects. Never writes to OC or WP.
// `context` is lazy: unauthenticated/disabled requests never initialize Admin SDK.
export function createProductImagesHandler({enabled=false,accessToken,signingSecret,bucketName,baseUrl='https://portal.crystocraft.com',context,now=()=>Date.now()}){
  return async req => {
    try {
      if(req.method!=='GET'){const r=json({error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}},405);r.headers.set('Allow','GET');return r}
      const u=new URL(req.url),download=u.pathname==='/api/oc/product-image'
      if(!download && u.pathname!=='/api/oc/product-images')fail('NOT_FOUND',404,'Not found.')
      if(!download){const got=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];if(!secretValid(accessToken)||!got||!equal(got,accessToken))fail('UNAUTHORIZED',401,'Image access authentication required.')}
      if(!enabled)fail('DISABLED',503,'Product image access is not enabled.')
      if(!secretValid(accessToken)||!secretValid(signingSecret)||equal(accessToken,signingSecret)||!bucketName)fail('NOT_CONFIGURED',503,'Product image access is not configured.')
      let origin;try{const b=new URL(baseUrl);if(b.protocol!=='https:'||b.username||b.password||b.pathname!=='/'||b.search||b.hash)throw Error();origin=b.origin}catch{fail('NOT_CONFIGURED',503,'Product image access is not configured.')}
      const clock=Math.floor(now()/1000)
      const payload=download?verify(u.searchParams.get('token'),signingSecret,clock,origin):null
      const productId=download?payload.p:u.searchParams.get('product_id')
      if(!validId(productId) || (!download&&[...u.searchParams.keys()].some(k=>k!=='product_id')) || (!download&&u.searchParams.getAll('product_id').length!==1) || (download&&(u.searchParams.getAll('token').length!==1||[...u.searchParams.keys()].some(k=>k!=='token'))))fail('INVALID_INPUT',400,'Send one valid product_id or signed image token.')
      const {db,bucket}=await context()
      if(bucket.name!==bucketName)fail('NOT_CONFIGURED',503,'Product image access is not configured.')
      const product=await db.doc(`products/${productId}`).get()
      if(!product.exists)fail('NOT_FOUND',404,'Product not found.')
      if(download){
        const snap=await db.doc(`products/${productId}/images/${payload.i}`).get(),image=snap.data()
        if(!snap.exists||!isPublishableProductImage(image))fail('IMAGE_NOT_APPROVED',403,'Image is no longer approved for public use.')
        const path=approvedStoragePath(image,productId,bucketName)
        if(!path)fail('IMAGE_NOT_APPROVED',403,'Image source is not approved.')
        const [metadata]=await bucket.file(path).getMetadata(),info=metadataInfo(metadata,path)
        if(info.revision!==payload.r)fail('IMAGE_CHANGED',409,'Image changed. Request a fresh image list.')
        // Pin the generation, cap the stream, and verify actual bytes before serving.
        const stream=bucket.file(path,{generation:info.generation}).createReadStream(),chunks=[];let size=0
        for await(const chunk of stream){size+=chunk.length;if(size>MAX_IMAGE_BYTES){stream.destroy();fail('IMAGE_TOO_LARGE',413,'Image exceeds the download limit.')}chunks.push(chunk)}
        const bytes=Buffer.concat(chunks)
        if(bytes.length!==info.size || 'md5:'+createHash('md5').update(bytes).digest('hex')!==info.hash || !signatureMatches(bytes,info.type))fail('IMAGE_UNAVAILABLE',503,'Approved image verification failed.')
        return new Response(bytes,{headers:{...commonHeaders,'Content-Type':info.type,'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="${productId}-${payload.i}.${TYPES.get(info.type)}"`,'Content-Security-Policy':"default-src 'none'; sandbox"}})
      }
      const gallery=await db.collection(`products/${productId}/images`).limit(51).get()
      if(gallery.docs.length>50)fail('GALLERY_TOO_LARGE',413,'This product gallery needs review before export.')
      const eligible=gallery.docs.map(d=>({...d.data(),id:d.id})).filter(isPublishableProductImage).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.id.localeCompare(b.id))
      const primary=eligible.find(i=>i.file_url===product.data()?.heroImage)||eligible.find(i=>i.is_hero===true)||eligible[0]
      const expires=clock+IMAGE_LINK_SECONDS,images=[]
      // Sequential metadata reads keep concurrency and memory bounded (50 max).
      for(const image of eligible){
        if(!validId(image.id))fail('IMAGE_UNAVAILABLE',503,'An approved image needs review.')
        const path=approvedStoragePath(image,productId,bucketName)
        if(!path)fail('IMAGE_SOURCE_UNSUPPORTED',422,'An approved image must be uploaded to this product’s OC Storage folder before export.')
        const [metadata]=await bucket.file(path).getMetadata(),info=metadataInfo(metadata,path)
        const token=sign({v:1,a:origin,p:productId,i:image.id,e:expires,r:info.revision},signingSecret)
        images.push({image_id:image.id,content_hash:info.hash,url:origin+'/api/oc/product-image?token='+token,role:image.id===primary?.id?'primary':'gallery',publishable:true,alt:String(image.alt||image.caption||'').trim().slice(0,1000),width:dimension(image.width),height:dimension(image.height)})
      }
      return json({schema_version:1,product_id:productId,expires_at:new Date(expires*1000).toISOString(),images})
    } catch(error){return json({error:{code:error instanceof ImageAccessError?error.code:'IMAGE_UNAVAILABLE',message:error instanceof ImageAccessError?error.message:'Product images are temporarily unavailable. No image access was granted.'}},error instanceof ImageAccessError?error.status:503)}
  }
}
