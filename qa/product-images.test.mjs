import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createHash,createHmac } from 'node:crypto'
import { createProductImagesHandler,isPublishableProductImage,approvedStoragePath,MAX_IMAGE_BYTES } from '../netlify/functions/lib/productImages.js'
import { editedImageAccess } from '../src/catalogueImagePolicy.js'

const access='test-access-'.repeat(4),secret='test-signing-'.repeat(4),bucketName='qa-only.firebasestorage.app',origin='https://images.example.test'
const bytes=Buffer.from([0xff,0xd8,0xff,0xe0,0,1,2,3]),md5=b=>createHash('md5').update(b).digest('base64')
const image=(id,extra={})=>({visibility:'public',branded_for_customer_id:null,file_url:`https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent('products/qa_product/images/'+id+'.jpg')}?alt=media&token=PRIVATE-DO-NOT-RETURN`,storage_path:'products/qa_product/images/'+id+'.jpg',sort_order:0,caption:'Generic product photo',width:2000,height:1800,...extra})
function fixture({images={a:image('a')},product={heroImage:images.a?.file_url,supplier:'PRIVATE SUPPLIER',unit_cost:999,remarks:'INTERNAL NOTES'},enabled=true,metadata={},data=bytes,overrides={}}={}){
 const state={images,product,reads:[],files:[],clock:Date.parse('2026-10-18T00:00:00Z'),contextCalls:0}
 const snap=(id,value)=>({id,exists:!!value,data:()=>value})
 const db={doc:path=>({get:async()=>{state.reads.push(path);const parts=path.split('/');assert.equal(parts[0],'products');assert.equal(parts[1],'qa_product');return snap(parts.at(-1),parts.length===2?state.product:state.images[parts[3]])}}),collection:path=>({limit:n=>({get:async()=>{state.reads.push(path);assert.equal(n,51);return {docs:Object.entries(state.images).slice(0,n).map(([id,d])=>snap(id,d))}}})})}
 const bucket={name:bucketName,file:(path,options)=>{state.files.push({path,options});return {getMetadata:async()=>[{generation:'12345',size:data.length,contentType:'image/jpeg',md5Hash:md5(data),...metadata}],createReadStream:()=>Readable.from([data])}}}
 const config={enabled,accessToken:access,signingSecret:secret,bucketName,baseUrl:origin,context:async()=>{state.contextCalls++;return {db,bucket}},now:()=>state.clock,...overrides}
 return {state,config,handler:createProductImagesHandler(config)}
}
const req=(url=origin+'/api/oc/product-images?product_id=qa_product',token=access,method='GET')=>new Request(url,{method,headers:token?{Authorization:'Bearer '+token}:{}})
async function list(f){const r=await f.handler(req());assert.equal(r.status,200);return r.json()}
async function error(response,status,code){assert.equal(response.status,status);assert.equal((await response.json()).error.code,code)}

test('strict Public approval never inherits the legacy public fallback or customer branding',()=>{
 for(const value of [undefined,null,'private','internal','PUBLIC'])assert.equal(isPublishableProductImage({visibility:value}),false)
 for(const branded of ['client',' ',false,0,{},[]])assert.equal(isPublishableProductImage({visibility:'public',branded_for_customer_id:branded}),false)
 for(const branded of ['',null,undefined])assert.equal(isPublishableProductImage({visibility:'public',branded_for_customer_id:branded}),true)
})
test('missing/wrong authentication and write methods do not initialize Admin SDK',async()=>{
 const f=fixture();for(const token of [null,'wrong'])await error(await f.handler(req(undefined,token)),401,'UNAUTHORIZED')
 const r=await f.handler(req(undefined,access,'POST'));await error(r,405,'METHOD_NOT_ALLOWED');assert.equal(r.headers.get('Allow'),'GET');assert.equal(f.state.contextCalls,0)
})
test('feature is disabled by default; missing/equal signing secrets fail closed',async()=>{
 for(const overrides of [{enabled:false},{signingSecret:''},{signingSecret:access},{bucketName:''}]){const f=fixture({overrides});assert.equal((await f.handler(req())).status,503);assert.equal(f.state.contextCalls,0)}
 const f=fixture({overrides:{enabled:undefined}});assert.equal((await f.handler(req())).status,503)
})
test('only approved image projections leave the server, with exactly one deterministic primary',async()=>{
 const f=fixture({images:{a:image('a',{is_hero:true,id:'FORGED ID'}),b:image('b',{sort_order:1,is_hero:true}),client:image('client',{branded_for_customer_id:'client'}),unknown:image('unknown',{visibility:undefined}),private:image('private',{visibility:'private'})}})
 const r=await f.handler(req()),body=await r.json();assert.equal(r.status,200);assert.equal(body.images.length,2);assert.equal(body.images.filter(i=>i.role==='primary').length,1);assert.equal(body.images[0].image_id,'a');assert.ok(body.images.every(i=>i.publishable===true));assert.equal(body.images[0].width,2000);assert.equal(body.images[0].alt,'Generic product photo')
 const text=JSON.stringify(body);for(const value of ['PRIVATE-DO-NOT-RETURN','PRIVATE SUPPLIER','INTERNAL NOTES','storage_path','file_url','999','branded_for_customer_id'])assert.ok(!text.includes(value));assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('Netlify-CDN-Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(f.state.files.length,2)
})
test('empty approved galleries remain empty and missing products return 404 without looking up files',async()=>{
 const f=fixture({images:{client:image('client',{branded_for_customer_id:'client'})}});assert.deepEqual((await list(f)).images,[]);assert.equal(f.state.files.length,0)
 f.state.product=null;await error(await f.handler(req()),404,'NOT_FOUND')
})
test('unknown IDs, duplicate parameters, arbitrary URL inputs and oversized galleries are rejected',async()=>{
 const f=fixture();for(const suffix of ['','product_id=../other','product_id=qa_product&product_id=qa_product','product_id=qa_product&url=https://evil.test','product_id=qa_product&include=costs'])await error(await f.handler(req(origin+'/api/oc/product-images?'+suffix)),400,'INVALID_INPUT')
 assert.equal(f.state.contextCalls,0)
 const huge=fixture({images:Object.fromEntries(Array.from({length:51},(_,i)=>['i'+i,image('i'+i)]))});await error(await huge.handler(req()),413,'GALLERY_TOO_LARGE');assert.equal(huge.state.files.length,0)
})
test('source paths enforce exact bucket, product ownership and no external URLs/traversal/metadata mismatch',()=>{
 assert.ok(approvedStoragePath(image('a'),'qa_product',bucketName))
 for(const file_url of ['http://firebasestorage.googleapis.com/x','https://evil.test/photo.jpg',image('a').file_url.replace(bucketName,'other-bucket'),image('a').file_url.replace('qa_product','other_product'),'https://storage.googleapis.com/'+bucketName+'/products/qa_product/images/%2e%2e/private.jpg','https://firebasestorage.googleapis.com.evil.test/x'])assert.equal(approvedStoragePath({...image('a'),file_url},'qa_product',bucketName),null)
 assert.equal(approvedStoragePath({...image('a'),storage_path:'products/other/images/a.jpg'},'qa_product',bucketName),null)
})
test('unsupported approved sources fail explicitly; they are not silently omitted or fetched',async()=>{
 const f=fixture({images:{a:image('a',{file_url:'https://www.crystocraft.com/existing.jpg'})}});await error(await f.handler(req()),422,'IMAGE_SOURCE_UNSUPPORTED');assert.equal(f.state.files.length,0)
})
test('stable IDs and content hashes prevent duplicates when signed URLs renew',async()=>{
 const f=fixture(),a=await list(f);f.state.clock+=1000;const b=await list(f);assert.equal(a.images[0].image_id,b.images[0].image_id);assert.equal(a.images[0].content_hash,b.images[0].content_hash);assert.notEqual(a.images[0].url,b.images[0].url);assert.equal(a.images[0].content_hash,'md5:'+createHash('md5').update(bytes).digest('hex'))
})
test('download streams only pinned, byte-verified approved images with safe response headers',async()=>{
 const f=fixture(),body=await list(f),r=await f.handler(req(body.images[0].url,null));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal(r.headers.get('Content-Type'),'image/jpeg');assert.match(r.headers.get('Content-Disposition'),/attachment; filename="qa_product-a.jpg"/);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.match(r.headers.get('Content-Security-Policy'),/sandbox/);assert.ok(f.state.files.some(f=>f.options?.generation==='12345'))
})
test('modified/expired/future/cross-audience tokens are rejected before database reads',async()=>{
 const f=fixture(),body=await list(f),url=body.images[0].url,n=f.state.contextCalls
 await error(await f.handler(req(url.slice(0,-1)+(url.endsWith('a')?'b':'a'),null)),403,'INVALID_LINK')
 f.state.clock+=300000;await error(await f.handler(req(url,null)),410,'EXPIRED_LINK');assert.equal(f.state.contextCalls,n)
 const mint=p=>{const v=Buffer.from(JSON.stringify(p)).toString('base64url');return origin+'/api/oc/product-image?token='+v+'.'+createHmac('sha256',secret).update(v).digest('base64url')}
 for(const patch of [{e:Math.floor(f.state.clock/1000)+301},{a:'https://wrong.example.test'},{i:'../client'},{p:null}])await error(await f.handler(req(mint({v:1,a:origin,p:'qa_product',i:'a',e:Math.floor(f.state.clock/1000)+100,r:'a'.repeat(64),...patch}),null)),403,'INVALID_LINK')
 assert.equal(f.state.contextCalls,n)
})
test('approval revocation, new customer branding and deletion revoke an issued link immediately',async()=>{
 for(const change of [s=>s.images.a.visibility='internal',s=>s.images.a.branded_for_customer_id='client',s=>delete s.images.a]){const f=fixture(),body=await list(f);change(f.state);const before=f.state.files.length;await error(await f.handler(req(body.images[0].url,null)),403,'IMAGE_NOT_APPROVED');assert.equal(f.state.files.length,before)}
})
test('replacement generation, wrong byte signature, oversized file and upstream failure fail closed',async()=>{
 const metadata={},f=fixture({metadata}),body=await list(f);metadata.generation='12346';await error(await f.handler(req(body.images[0].url,null)),409,'IMAGE_CHANGED')
 const html=fixture({data:Buffer.from('<script>private()</script>')});await error(await html.handler(req((await list(html)).images[0].url,null)),503,'IMAGE_UNAVAILABLE')
 const huge=fixture({metadata:{size:MAX_IMAGE_BYTES+1}});await error(await huge.handler(req()),503,'IMAGE_UNAVAILABLE')
 const down=fixture({overrides:{context:async()=>{throw Error('PRIVATE DATABASE CREDENTIALS')}}});const r=await down.handler(req());assert.equal(r.status,503);assert.ok(!(await r.text()).includes('PRIVATE'))
})
test('image edits preserve client tags and require fresh Public approval on replaced/copied bytes',()=>{
 assert.deepEqual(editedImageAccess({visibility:'public',branded_for_customer_id:'client'},true),{visibility:'private',branded_for_customer_id:'client'})
 assert.equal(editedImageAccess({},true).visibility,'private');assert.equal(editedImageAccess({visibility:'private'},true).visibility,'private');assert.equal(editedImageAccess({visibility:'internal'},true).visibility,'internal')
 assert.equal(editedImageAccess({branded_for_customer_id:'client'},false).branded_for_customer_id,'client');assert.equal(editedImageAccess({branded_for_customer_id:false},true).branded_for_customer_id,false)
})

test('stream limits, checksum mismatch and unsafe file types prevent byte exposure',async()=>{
 const large=fixture({data:Buffer.alloc(MAX_IMAGE_BYTES+1,1),metadata:{size:3}}),link=(await list(large)).images[0].url;await error(await large.handler(req(link,null)),413,'IMAGE_TOO_LARGE')
 const wrong=fixture({metadata:{md5Hash:Buffer.alloc(16).toString('base64')}});await error(await wrong.handler(req((await list(wrong)).images[0].url,null)),503,'IMAGE_UNAVAILABLE')
 for(const contentType of ['image/svg+xml','text/html','application/octet-stream']){const f=fixture({metadata:{contentType}});await error(await f.handler(req()),503,'IMAGE_UNAVAILABLE')}
})
