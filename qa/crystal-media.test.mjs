import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCrystalMediaHandler,parseCrystalPhotoPath} from '../netlify/functions/lib/crystalMedia.js'
const path='crystal-products/cp_example/im_example/'+'a'.repeat(64)+'/display.jpg'
const request=(file=path,auth='valid.caller.token')=>new Request('https://example.test/api/crystal-product-media?file='+encodeURIComponent(file),{headers:auth?{Authorization:'Bearer '+auth}:{}})
const handler=(overrides={})=>createCrystalMediaHandler({verifyToken:async()=>({uid:'customer_example'}),getProfile:async()=>({role:'customer',status:'approved'}),getProduct:async()=>({publication:'published'}),getImage:async()=>({publication:'published',media:{display:path,original:path.replace('display','original'),thumbnail:path.replace('display','thumbnail')}}),readObject:async()=>({bytes:new Uint8Array([255,216,255,1]),mime:'image/jpeg'}),...overrides})
test('strict fixed product/photo path parser',()=>{
 assert.deepEqual(parseCrystalPhotoPath(path),{productId:'cp_example',imageId:'im_example'})
 for(const bad of ['customers/private.jpg','https://evil.test/photo.jpg',path+'/../other',path.replace('display.jpg','any.jpg'),path.replace('cp_example','../private')])assert.equal(parseCrystalPhotoPath(bad),null)
})
test('approved customer gets exact current published bytes, no token URL',async()=>{
 const res=await handler()(request());assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal(res.headers.get('vary'),'Authorization');assert.equal(res.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await res.arrayBuffer()),new Uint8Array([255,216,255,1]))
})
for(const [name,override,status] of [
 ['pending',{getProfile:async()=>({role:'customer',status:'pending'})},403],
 ['supply staff',{getProfile:async()=>({role:'staff',modules:['supply']})},403],
 ['unprofiled',{getProfile:async()=>null},403],
 ['draft parent',{getProduct:async()=>({publication:'draft'})},403],
 ['archived parent',{getProduct:async()=>({publication:'archived'})},403],
 ['draft image',{getImage:async()=>({publication:'draft',media:{display:path}})},403],
 ['archived image',{getImage:async()=>({publication:'archived',media:{display:path}})},403],
 ['pending image',{getImage:async()=>({publication:'published',media:null})},403],
 ['old revision',{getImage:async()=>({publication:'published',media:{display:path.replace('a'.repeat(64),'b'.repeat(64))}})},403],
 ['missing product',{getProduct:async()=>null},404],
 ['missing image',{getImage:async()=>null},404],
 ['invalid token',{verifyToken:async()=>{throw Error()}},401],
])test('product media denies '+name+' before reading bytes',async()=>{
 let reads=0
 const res=await handler({...override,readObject:async()=>{reads++;throw Error('Must not read')}})(request());assert.equal(res.status,status);assert.equal(reads,0)
})
test('anonymous and external paths are rejected',async()=>{
 assert.equal((await handler()(request(path,''))).status,401)
 assert.equal((await handler()(request('customers/secret.pdf'))).status,400)
 assert.equal((await handler()(new Request('https://example.test',{method:'POST'}))).status,405)
})
for(const role of [{role:'admin'},{role:'staff',modules:['swatch']}])test(role.role+' can verify a pending upload under existing product/image identity',async()=>{
 assert.equal((await handler({getProfile:async()=>role,getProduct:async()=>({publication:'draft'}),getImage:async()=>({publication:'draft',media:null})})(request())).status,200)
})
test('invalid MIME, oversize and backend failures never become successful images',async()=>{
 assert.equal((await handler({readObject:async()=>({bytes:new Uint8Array([1]),mime:'text/html'})})(request())).status,502)
 assert.equal((await handler({readObject:async()=>({bytes:{byteLength:20971521},mime:'image/jpeg'})})(request())).status,502)
 assert.equal((await handler({readObject:async()=>{throw Error('private backend detail')}})(request())).status,502)
})
