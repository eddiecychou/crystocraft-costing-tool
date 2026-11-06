// Confirmed Corporate-style removal, current rules + real SDK; fictional data only.
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing'
import {doc,setDoc,deleteDoc,getDocFromServer,serverTimestamp} from 'firebase/firestore'
import {ref,uploadBytes,getMetadata,deleteObject,listAll} from 'firebase/storage'
import {cleanCrystalProduct} from '../src/domain/crystalProducts.js'
import {runNodeTest} from './test-process.mjs'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^(127\.0\.0\.1|localhost):\d+$/,'Loopback emulators required')
if(process.env.OC_CRYSTAL_IMAGE_DELETE_CHILD!=='1')runNodeTest(['--test',fileURLToPath(import.meta.url)],{label:'Crystal image deletion rules',timeoutMs:90000,env:{...process.env,OC_CRYSTAL_IMAGE_DELETE_CHILD:'1'}})
else{
 const {before,beforeEach,afterEach,after,test}=await import('node:test')
 const projectId=process.env.GCLOUD_PROJECT
 assert.ok(['crystocraft-rbac-test','demo-crystal-image-delete'].includes(projectId),'Only named fixture projects are allowed')
 const P='cp_delete_fixture',I='im_delete_fixture',C='im_cover_fixture',parent='crystal_products/'+P,path=id=>parent+'/images/'+id
 const root=id=>'crystal-products/'+P+'/'+id+'/'+'a'.repeat(64),files=id=>['original.png','display.jpg','thumbnail.jpg'].map(name=>root(id)+'/'+name)
 const media=id=>({original:files(id)[0],display:files(id)[1],thumbnail:files(id)[2],sha256:'a'.repeat(64),display_sha256:'b'.repeat(64),thumbnail_sha256:'c'.repeat(64),mime:'image/png',bytes:4,width:1,height:1})
 let env,scratch,version=0;const clients=new Set()
 const dbFor=uid=>{const context=uid?env.authenticatedContext(uid):env.unauthenticatedContext(),db=context.firestore();clients.add(db);return {db,storage:context.storage()}}
 const disabled=fn=>env.withSecurityRulesDisabled(async c=>{const db=c.firestore();try{return await fn(db,c.storage())}finally{await db.terminate()}})
 before(async()=>{
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':'),[storageHost,storagePort]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')
  env=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:await readFile('firestore.rules','utf8')},storage:{host:storageHost,port:Number(storagePort),rules:await readFile('storage.rules','utf8')}})
  scratch=await mkdtemp(resolve('qa/out/crystal-image-delete-engine-'))
  await build({stdin:{contents:"export {deleteCrystalImage,cleanupCrystalImageFiles} from './src/crystalProducts.js'",resolveDir:process.cwd()},outfile:join(scratch,'engine.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'actual-sdk-loopback',setup(b){
   b.onResolve({filter:/^firebase\//},a=>({path:a.path,external:true}));b.onResolve({filter:/\/firebase$/},()=>({path:'io',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const db=globalThis.__crystalDeleteDb,storage=globalThis.__crystalDeleteStorage;export const authedUser=()=>{throw Error("No live auth operation permitted")};'}))
  }}]})
 },{timeout:20000})
 beforeEach(async()=>{
  await env.clearFirestore();await env.clearStorage()
  await disabled(async(db,storage)=>{
   for(const[uid,profile]of Object.entries({delete_admin:{role:'admin'},delete_editor:{role:'staff',modules:['swatch']},delete_supply:{role:'staff',modules:['supply']},delete_customer:{role:'customer',status:'approved'}}))await setDoc(doc(db,'users',uid),profile)
   const stamp={revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
   await setDoc(doc(db,parent),{...cleanCrystalProduct({code:'CC-DELETE-FIXTURE',name:'Fictional component',family:'cut',origin:'crystocraft',supply:'made_to_order',unit:'pcs',publication:'draft',hero_id:C}),...stamp})
   for(const id of[I,C]){
    await setDoc(doc(db,path(id)),{alt:'Fictional image '+id,publication:'published',media:media(id),...stamp})
    for(const file of files(id))await uploadBytes(ref(storage,file),new Uint8Array([1,2,3,4]),{contentType:file.endsWith('.png')?'image/png':'image/jpeg'})
   }
   await setDoc(doc(db,'suppliers/untouched'),{name:'Preserve original supplier'});await setDoc(doc(db,'range_components/untouched'),{stock_qty:102,unit_cost:14.2})
  })
 },{timeout:20000})
 afterEach(async()=>{await Promise.all([...clients].map(db=>db.terminate()));clients.clear();delete globalThis.__crystalDeleteDb;delete globalThis.__crystalDeleteStorage},{timeout:10000})
 after(async()=>{await env?.cleanup();if(scratch)await rm(scratch,{recursive:true,force:true})},{timeout:10000})
 async function engine(uid){const {db,storage}=dbFor(uid);globalThis.__crystalDeleteDb=db;globalThis.__crystalDeleteStorage=storage;return {db,storage,api:await import(pathToFileURL(join(scratch,'engine.mjs')).href+'?case='+(++version))}}
 for(const uid of ['delete_admin','delete_editor'])test(uid+' removes the exact image and three files using actual services', {timeout:20000},async()=>{
  const {db,storage,api}=await engine(uid)
  assert.deepEqual(await api.deleteCrystalImage({productId:P,id:I,expectedRevision:1}),{pendingFiles:[]})
  assert.equal((await getDocFromServer(doc(db,path(I)))).exists(),false);assert.ok((await getDocFromServer(doc(db,path(C)))).exists())
  for(const file of files(I))await assert.rejects(getMetadata(ref(storage,file)),e=>e.code==='storage/object-not-found')
  for(const file of files(C))await assertSucceeds(getMetadata(ref(storage,file)))
  await disabled(async owner=>{assert.equal((await getDocFromServer(doc(owner,'range_components/untouched'))).data().stock_qty,102);assert.equal((await getDocFromServer(doc(owner,'suppliers/untouched'))).data().name,'Preserve original supplier')})
 })
 test('cover and stale-revision deletion are refused before touching stored files',{timeout:15000},async()=>{
  const {db,storage,api}=await engine('delete_editor')
  await assert.rejects(api.deleteCrystalImage({productId:P,id:C,expectedRevision:1}),/Change the cover/)
  await assertFails(deleteDoc(doc(db,path(C))))
  await assert.rejects(api.deleteCrystalImage({productId:P,id:I,expectedRevision:2}),/photograph changed/)
  for(const id of[I,C])for(const file of files(id))await assertSucceeds(getMetadata(ref(storage,file)))
 })
 test('direct file deletion is refused while metadata exists, including for admins',{timeout:15000},async()=>{
  for(const uid of['delete_admin','delete_editor']){const {storage}=dbFor(uid);for(const file of files(I))await assertFails(deleteObject(ref(storage,file)))}
 })
 for(const uid of ['delete_customer','delete_supply',null])test((uid||'anonymous')+' cannot delete image records or orphaned image files',{timeout:15000},async()=>{
  const {db,storage}=dbFor(uid);await assertFails(deleteDoc(doc(db,path(I))))
  await disabled(owner=>deleteDoc(doc(owner,path(I))))
  for(const file of files(I))await assertFails(deleteObject(ref(storage,file)))
 })
 test('storage cleanup permits only deleted-image raster paths and keeps overwrite/list boundaries',{timeout:15000},async()=>{
  const {db,storage}=dbFor('delete_editor')
  await assertFails(listAll(ref(storage,'crystal-products/'+P+'/'+I)))
  await assertFails(uploadBytes(ref(storage,files(I)[0]),new Uint8Array([9]),{contentType:'image/png'}))
  await disabled(async(owner,bucket)=>{await uploadBytes(ref(bucket,root(I)+'/unrelated.pdf'),new Uint8Array([9]),{contentType:'application/pdf'})})
  await assertSucceeds(deleteDoc(doc(db,path(I))))
  await assertFails(deleteObject(ref(storage,root(I)+'/unrelated.pdf')))
  await assertFails(deleteObject(ref(storage,files(C)[0])))
  await assertSucceeds(deleteObject(ref(storage,files(I)[0])))
 })
}
