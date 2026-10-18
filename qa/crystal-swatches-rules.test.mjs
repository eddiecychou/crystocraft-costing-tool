// Fictional data only; requires loopback Firestore + Storage emulators.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore'
import {ref,uploadBytes,getMetadata,deleteObject} from 'firebase/storage'
if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error('Run both local emulators.')
const env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:readFileSync('firestore.rules','utf8')},storage:{rules:readFileSync('storage.rules','utf8')}})
let count=0
const ok=async(label,p)=>{await p;count++;console.log('ok',label)}
const id='sw_'+ 'a'.repeat(64), rev='b'.repeat(64), root=`crystal-swatches/${id}/${rev}`
const media={original:root+'/original.jpg',display:root+'/display.jpg',thumbnail:root+'/thumbnail.jpg',sha256:'c'.repeat(64),display_sha256:'d'.repeat(64),thumbnail_sha256:'e'.repeat(64),mime:'image/jpeg',bytes:4,width:100,height:100}
const sample=(publication='draft')=>({schema_version:1,color_name:'Crystal AB',notes_key:'Crystal AB',style:'fabric',backing_label:'01',description:'Real photo',rgb:[.5,.5,.5],sort_order:0,publication,revision:1,media:publication==='draft'?null:media,created_at:serverTimestamp(),updated_at:serverTimestamp()})
try {
 await env.withSecurityRulesDisabled(async ctx=>{
  const d=ctx.firestore()
  for(const [uid,profile] of Object.entries({a:{role:'admin'},s:{role:'staff',modules:['swatch']},n:{role:'staff',modules:['supply']},c:{role:'customer',status:'approved'},p:{role:'customer',status:'pending'}}))await setDoc(doc(d,'users',uid),profile)
  await setDoc(doc(d,'crystal_swatches',id),sample('published'))
  await setDoc(doc(d,'crystal_swatches','sw_draft_sample_00000'),sample())
  await setDoc(doc(d,'crystal_swatches','sw_archive_sample_00000'),sample('archived'))
  await setDoc(doc(d,'crystal_migration_runs','private'),{calibration:'private'})
  const s=ctx.storage();for(const path of [media.original,media.display,media.thumbnail,root+'/old.jpg'])await uploadBytes(ref(s,path),new Uint8Array([255,216,255,1]),{contentType:'image/jpeg',cacheControl:'private, no-cache'})
 })
 const d=uid=>env.authenticatedContext(uid).firestore(), st=uid=>env.authenticatedContext(uid).storage()
 for(const uid of ['a','s'])await ok(uid+' reads all samples',assertSucceeds(getDocs(collection(d(uid),'crystal_swatches'))))
 await ok('approved customer reads published query',assertSucceeds(getDocs(query(collection(d('c'),'crystal_swatches'),where('publication','==','published')))))
 await ok('unfiltered customer query denied',assertFails(getDocs(collection(d('c'),'crystal_swatches'))))
 for(const [uid,sampleId] of [['c','sw_draft_sample_00000'],['c','sw_archive_sample_00000'],['p',id],['n',id]])await ok(uid+' denied '+sampleId,assertFails(getDoc(doc(d(uid),'crystal_swatches',sampleId))))
 await ok('anonymous denied',assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'crystal_swatches',id))))
 await ok('swatch staff creates draft',assertSucceeds(setDoc(doc(d('s'),'crystal_swatches','sw_new_sample_000000'),sample())))
 await ok('cannot create published unreviewed record',assertFails(setDoc(doc(d('s'),'crystal_swatches','sw_new_published_0000'),sample('published'))))
 await ok('cannot include internal cost',assertFails(setDoc(doc(d('s'),'crystal_swatches','sw_private_field_0000'),{...sample(),cost:999})))
 await ok('customer cannot create',assertFails(setDoc(doc(d('c'),'crystal_swatches','sw_customer_write_000'),sample())))
 for(const patch of [{revision:4},{revision:2,description:'x'.repeat(1001)},{revision:2,notes_key:'different'},{revision:2,publication:'public'},{revision:2,rgb:[9,0,0]},{revision:2,media:{...media,original:'customers/secret.jpg'}},{revision:2,internal_note:'secret'}])await ok('invalid update denied '+Object.keys(patch).join(','),assertFails(updateDoc(doc(d('s'),'crystal_swatches',id),{...patch,updated_at:serverTimestamp()})))
 await ok('staff cannot delete sample',assertFails(deleteDoc(doc(d('s'),'crystal_swatches',id))))
 for(const uid of ['s','c','p','n'])await ok(uid+' cannot read migration provenance',assertFails(getDoc(doc(d(uid),'crystal_migration_runs','private'))))
 await ok('admin reads provenance',assertSucceeds(getDoc(doc(d('a'),'crystal_migration_runs','private'))))
 await ok('approved customer reads current published photo',assertSucceeds(getMetadata(ref(st('c'),media.display))))
 await ok('anonymous photo denied',assertFails(getMetadata(ref(env.unauthenticatedContext().storage(),media.display))))
 for(const uid of ['p','n'])await ok(uid+' cannot read photo',assertFails(getMetadata(ref(st(uid),media.display))))
 await ok('unreferenced revision/file denied',assertFails(getMetadata(ref(st('c'),root+'/old.jpg'))))
 const fresh=root+'/original.png', bytes=new Uint8Array([137,80,78,71])
 await ok('staff uploads immutable original',assertSucceeds(uploadBytes(ref(st('s'),fresh),bytes,{contentType:'image/png',cacheControl:'private, no-cache'})))
 await ok('overwrite denied',assertFails(uploadBytes(ref(st('s'),fresh),bytes,{contentType:'image/png',cacheControl:'private, no-cache'})))
 await ok('delete original denied',assertFails(deleteObject(ref(st('s'),fresh))))
 await ok('bad content type denied',assertFails(uploadBytes(ref(st('s'),root+'/original.webp'),bytes,{contentType:'text/html',cacheControl:'private, no-cache'})))
 await ok('orphan upload denied',assertFails(uploadBytes(ref(st('s'),root.replace(id,'sw_missing_sample_000')+'/original.jpg'),bytes,{contentType:'image/jpeg',cacheControl:'private, no-cache'})))
 await ok('archive sample with revision increment',assertSucceeds(updateDoc(doc(d('s'),'crystal_swatches',id),{publication:'archived',revision:2,updated_at:serverTimestamp()})))
 await ok('archive immediately denies customer image',assertFails(getMetadata(ref(st('c'),media.display))))
 await ok('staff still reads archive image',assertSucceeds(getMetadata(ref(st('s'),media.display))))
 console.log(`${count} swatch access assertions passed`)
}finally{await env.cleanup()}
