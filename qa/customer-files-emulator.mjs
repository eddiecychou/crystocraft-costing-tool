// Real Admin SDK repositories/objects and client security rules. Local only.
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore,FieldValue,FieldPath} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,getDoc,getDocs,collection,setDoc,updateDoc,deleteDoc} from 'firebase/firestore'
import {ref,getMetadata,getDownloadURL,uploadBytes,listAll} from 'firebase/storage'
import {createCustomerFilesHandler,createCustomerFilesRepository} from '../netlify/functions/lib/customerFiles.js'
import {createCustomerFileObjects} from '../netlify/functions/lib/customerFileObjects.js'
import {mergeCustomerRecords} from '../netlify/functions/lib/customerMerge.js'
import {emptyCustomerFileMetadata} from '../src/customerFilesModel.js'
import {checksum,smallPng,fictionalCompany} from './customer-files-fixtures.mjs'

for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error('Both local emulators are required. Live fixture writes are forbidden.')
const project='crystocraft-rbac-test',cid='customer_files_qa_'+process.pid,bucketName=project+'.appspot.com',app=initializeApp({projectId:project,storageBucket:bucketName},'customer-files-emulator'),db=getFirestore(app),bucket=getStorage(app).bucket()
const repo=createCustomerFilesRepository(db,()=>FieldValue.serverTimestamp(),()=>FieldPath.documentId()),objects=createCustomerFileObjects(bucket)
const profiles={cf_admin:{role:'admin'},cf_crm:{role:'staff',modules:['customers']},cf_supply:{role:'staff',modules:['supply']},cf_marketing:{role:'staff',modules:['marketing']},cf_none:{role:'staff',modules:[]},cf_customer:{role:'customer',status:'approved',customer_id:cid,modules:['customers']},cf_other:{role:'customer',status:'approved',customer_id:'other'},cf_pending:{role:'customer',status:'pending',customer_id:cid}}
let env,record
const handler=createCustomerFilesHandler({verifyToken:async token=>({uid:token}),getProfile:async uid=>(await db.doc('users/'+uid).get()).data(),repo,objects})
const request=(op,{method='GET',id,body,chunk,uid='cf_admin',customer=cid}={})=>handler(new Request('http://127.0.0.1/api/customer-files?'+new URLSearchParams({customer,op,...(id?{file:id}:{}),...(chunk===undefined?{}:{chunk:String(chunk)})}),{method,headers:uid?{Authorization:'Bearer '+uid}:{},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})}))
before(async()=>{
  env=await initializeTestEnvironment({projectId:project,firestore:{rules:readFileSync('firestore.rules','utf8')},storage:{rules:readFileSync('storage.rules','utf8')}})
  await db.doc('customers/'+cid).set(fictionalCompany())
  for(const[uid,profile]of Object.entries(profiles))await db.doc('users/'+uid).set(profile)
  record=await repo.begin(cid,{filename:'原件 & Cindy-Tony 🎁.png',content_type:'image/png',byte_size:smallPng.length,sha256:checksum(smallPng),metadata:{...emptyCustomerFileMetadata(),contact_ids:['person_cindy'],card_side:'front',card_set:'Fictional card'}},'cf_admin')
  assert.equal((await request('chunk',{method:'POST',id:record.id,chunk:0,body:smallPng})).status,200)
  assert.equal((await request('complete',{method:'POST',id:record.id})).status,200)
  record=await repo.get(cid,record.id)
})
after(async()=>{await objects.removePrefix('customer-files/'+cid+'/');await env?.cleanup();await db.terminate();await deleteApp(app)})

test('real upload/reload/original range read preserves bytes, filename, company contacts/notes/IDs',async()=>{
  assert.equal(record.filename,'原件 & Cindy-Tony 🎁.png');assert.equal(record.status,'ready');assert.ok(record.uploaded_at.toDate())
  assert.deepEqual((await db.doc('customers/'+cid).get()).data(),fictionalCompany())
  const response=await request('content',{id:record.id,chunk:0});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),smallPng)
  const [meta]=await bucket.file(`customer-files/${cid}/${record.sha256}/original`).getMetadata()
  assert.equal(meta.metadata.sha256,record.sha256);assert.ok(!meta.metadata.firebaseStorageDownloadTokens);assert.equal(meta.cacheControl,'private, no-store')
  const rows=await repo.list(cid);assert.equal(rows.files.length,1);assert.deepEqual(rows.files[0].contact_ids,['person_cindy'])
})
for(const uid of [...Object.keys(profiles),null])test(`real metadata/storage rules and backend restrict ${uid||'anonymous'}`,async()=>{
  const ctx=uid?env.authenticatedContext(uid):env.unauthenticatedContext(),path=`customers/${cid}/files/${record.id}`,filePath=`customer-files/${cid}/${record.sha256}/original`,mayRead=['cf_admin','cf_crm'].includes(uid)
  await (mayRead?assertSucceeds:assertFails)(getDoc(doc(ctx.firestore(),path)))
  await (mayRead?assertSucceeds:assertFails)(getDocs(collection(ctx.firestore(),'customers',cid,'files')))
  await assertFails(setDoc(doc(ctx.firestore(),path),{filename:'Untrusted replacement',visibility:'public_reference'}))
  await assertFails(updateDoc(doc(ctx.firestore(),path),{contact_ids:['foreign'],filename:'changed'}))
  await assertFails(deleteDoc(doc(ctx.firestore(),path)))
  await assertFails(getMetadata(ref(ctx.storage(),filePath)))
  await assertFails(getDownloadURL(ref(ctx.storage(),filePath)))
  await assertFails(uploadBytes(ref(ctx.storage(),filePath),smallPng,{contentType:'image/png'}))
  await assertFails(listAll(ref(ctx.storage(),'customer-files/'+cid)))
  assert.equal((await request('content',{id:record.id,chunk:0,uid})).status,mayRead?200:uid?403:401)
})
test('known tokenless Storage media URL cannot bypass authentication/rules',async()=>{
  const url=`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(`customer-files/${cid}/${record.sha256}/original`)}?alt=media`
  for(const suffix of ['', '&token=guessed-token']){const r=await fetch(url+suffix);assert.equal(r.status,403)}
})
test('real transactions preserve original identity on retry and reject concurrent metadata overwrite',async()=>{
  const input={filename:'Different repeated name.png',content_type:'image/png',byte_size:smallPng.length,sha256:checksum(smallPng),metadata:{...emptyCustomerFileMetadata(),title:'Do not overwrite'}}
  const repeated=await Promise.all(Array.from({length:6},()=>repo.begin(cid,input,'cf_crm')))
  assert.ok(repeated.every(r=>r.id===record.id&&r.filename===record.filename));assert.equal((await repo.list(cid)).files.length,1)
  const results=await Promise.allSettled(['First edit','Second edit'].map(title=>repo.update(cid,record.id,{revision:record.revision,metadata:{...emptyCustomerFileMetadata(),title,contact_ids:['person_tony']}},'cf_admin')))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
  assert.deepEqual((await db.doc('customers/'+cid).get()).data(),fictionalCompany());assert.deepEqual(await objects.read(`customer-files/${cid}/${record.sha256}/original`),smallPng)
})
test('merge moves file metadata safely, remaps contact IDs, retains both colliding files and original storage',async()=>{
  const source='customer_files_merge_source_'+process.pid,target='customer_files_merge_target_'+process.pid,old='same-id'
  await db.doc('customers/'+source).set({company_name:'Fictional A',contacts:[{id:'contact',name:'Cindy'}],notes:'Original A'})
  await db.doc('customers/'+target).set({company_name:'Fictional B',contacts:[{id:'contact',name:'Tony'}],notes:'Original B'})
  const data={...record,id:undefined,customer_id:source,storage_customer_id:cid,contact_ids:['contact']};delete data.id
  await db.doc(`customers/${source}/files/${old}`).set(data);await db.doc(`customers/${target}/files/${old}`).set({...data,customer_id:target,title:'Keep target'})
  const result=await mergeCustomerRecords(db,source,target,'cf_admin',{budgetMs:120000});assert.equal(result.complete,true)
  const files=(await db.collection(`customers/${target}/files`).get()).docs.map(s=>({id:s.id,...s.data()}));assert.equal(files.length,2)
  const moved=files.find(f=>f.id!==old);assert.equal(moved.customer_id,target);assert.equal(moved.storage_customer_id,cid);assert.deepEqual(moved.contact_ids,['merged-contact']);assert.equal(moved.filename,record.filename)
  const response=await request('content',{customer:target,id:moved.id,chunk:0});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),smallPng)
  await mergeCustomerRecords(db,source,target,'cf_admin');assert.equal((await db.collection(`customers/${target}/files`).get()).size,2)
})
