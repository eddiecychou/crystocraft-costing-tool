// Local-only Admin SDK / real object metadata and byte-stream integration.
import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import handler from '../netlify/functions/product-images.js'
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name]||''))throw Error('Both loopback emulators are required. Live image writes forbidden.')
const bucketName='crystocraft-rbac-test.appspot.com',app=initializeApp({projectId:'crystocraft-rbac-test',storageBucket:bucketName}),db=getFirestore(app),bucket=getStorage(app).bucket()
const token='emulator-image-access-'.repeat(3),secret='emulator-image-signature-'.repeat(3),id='image_export_qa'
Object.assign(process.env,{OC_PRODUCT_IMAGES_ENABLED:'true',OC_PRODUCT_IMAGES_TOKEN:token,OC_PRODUCT_IMAGES_SIGNING_SECRET:secret,OC_PRODUCT_IMAGES_BASE_URL:'https://images.example.test',VITE_FIREBASE_STORAGE_BUCKET:bucketName})
const bytes=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]),path=`products/${id}/images/approved.jpg`
const request=()=>new Request('https://images.example.test/api/oc/product-images?product_id='+id,{headers:{Authorization:'Bearer '+token}})
after(async()=>{await db.terminate();await deleteApp(app)})
test('real Node wrapper reads only approved product images, serves verified Storage bytes, and revokes old links',async()=>{
 await db.doc(`products/${id}`).set({name:'Fictional emulator-only product',heroImage:'not-relevant',supplier:'PRIVATE',cost:100})
 await bucket.file(path).save(bytes,{contentType:'image/jpeg',resumable:false})
 const img={file_url:`https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=PRIVATE`,storage_path:path,visibility:'public',is_hero:true,branded_for_customer_id:null}
 await db.doc(`products/${id}/images/approved`).set(img)
 for(const [key,extra] of [['client',{branded_for_customer_id:'client'}],['unknown',{visibility:null}],['internal',{visibility:'internal'}]])await db.doc(`products/${id}/images/${key}`).set({...img,...extra})
 const res=await handler(request());assert.equal(res.status,200);const body=await res.json();assert.equal(body.images.length,1);assert.equal(body.images[0].image_id,'approved');assert.match(body.images[0].content_hash,/^md5:[a-f0-9]{32}$/);assert.ok(!JSON.stringify(body).includes('PRIVATE'))
 const link=body.images[0].url,r=await handler(new Request(link));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes)
 await db.doc(`products/${id}/images/approved`).update({visibility:'internal'});assert.equal((await handler(new Request(link))).status,403)
 await db.doc(`products/${id}/images/approved`).update({visibility:'public',branded_for_customer_id:'client'});assert.equal((await handler(request())).status,200);assert.equal((await handler(request()).then(r=>r.json())).images.length,0)
 assert.equal((await db.doc(`products/${id}`).get()).data().cost,100);assert.equal((await bucket.file(path).download())[0].equals(bytes),true)
})
