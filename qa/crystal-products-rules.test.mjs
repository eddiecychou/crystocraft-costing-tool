// Fictional documents and files only. Never run against production.
import {readFileSync} from 'node:fs'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,deleteDoc,serverTimestamp,writeBatch} from 'firebase/firestore'
import {ref,uploadBytes,getMetadata,deleteObject} from 'firebase/storage'
import {cleanCrystalProduct,cleanCrystalVariant} from '../src/domain/crystalProducts.js'
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error('Local emulators required.')
const env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:readFileSync('firestore.rules','utf8')},storage:{rules:readFileSync('storage.rules','utf8')}})
const pid='cp_rules_example',iid='im_rules_example',vid='v_rules_example',hash='a'.repeat(64),root='crystal-products/'+pid+'/'+iid+'/'+hash
const media={original:root+'/original.jpg',display:root+'/display.jpg',thumbnail:root+'/thumbnail.jpg',sha256:hash,display_sha256:hash,thumbnail_sha256:hash,mime:'image/jpeg',bytes:4,width:100,height:100}
const product={...cleanCrystalProduct({code:'CC-EXAMPLE',name:'Example',family:'cut',origin:'crystocraft',supply:'made_to_order',unit:'pcs',publication:'draft'}),revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
const variant={...cleanCrystalVariant({code:'CC-EXAMPLE-CLEAR',label:'Clear',unit:'pcs',publication:'published',confirmed:true}),revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
const image={alt:'Real photo',publication:'published',media,revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
const mapping={collection:'crystals',inventory_id:'stock_rules_example',stock_unit:'pcs',catalogue_unit:'pcs',stock_per_unit:1,reviewed:true,notes:'Private provenance',updated_at:serverTimestamp()}
let count=0
const ok=async(label,promise)=>{await promise;count++;console.log('ok',label)},d=uid=>env.authenticatedContext(uid).firestore(),st=uid=>env.authenticatedContext(uid).storage()
try{
 await env.withSecurityRulesDisabled(async ctx=>{
  for(const [uid,profile] of Object.entries({cat_admin:{role:'admin'},cat_editor:{role:'staff',modules:['swatch']},cat_supply:{role:'staff',modules:['supply']},cat_both:{role:'staff',modules:['swatch','supply']},cat_customer:{role:'customer',status:'approved'},cat_other:{role:'customer',status:'approved'},cat_pending:{role:'customer',status:'pending'}}))await setDoc(doc(ctx.firestore(),'users',uid),profile)
  const db=ctx.firestore()
  await setDoc(doc(db,'crystal_products',pid),{...product,publication:'published',hero_id:iid,primary_variant_id:vid})
  await setDoc(doc(db,'crystal_products','cp_draft_example'),product)
  await setDoc(doc(db,'crystal_products',pid,'variants',vid),variant)
  await setDoc(doc(db,'crystal_products',pid,'variants','v_draft_example'),{...variant,publication:'draft'})
  await setDoc(doc(db,'crystal_products',pid,'images',iid),image)
  await setDoc(doc(db,'crystal_product_private',pid,'variants',vid),mapping)
  await setDoc(doc(db,'crystals','stock_rules_example'),{code:'STOCK-EXAMPLE',stock_qty:10})
  for(const path of [media.display,media.original,media.thumbnail,root+'/old.jpg','enquiry-files/cat_customer/enquiry_example/drawing.pdf'])await uploadBytes(ref(ctx.storage(),path),new Uint8Array([255,216,255,1]),{contentType:path.endsWith('.pdf')?'application/pdf':'image/jpeg'})
 })
 for(const uid of ['cat_admin','cat_editor'])await ok(uid+' reads catalogue',assertSucceeds(getDocs(collection(d(uid),'crystal_products'))))
 await ok('customer reads filtered published catalogue',assertSucceeds(getDocs(query(collection(d('cat_customer'),'crystal_products'),where('publication','==','published')))))
 await ok('customer unfiltered query denied',assertFails(getDocs(collection(d('cat_customer'),'crystal_products'))))
 for(const uid of ['cat_pending','cat_supply'])await ok(uid+' catalogue denied',assertFails(getDoc(doc(d(uid),'crystal_products',pid))))
 await ok('anonymous catalogue denied',assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'crystal_products',pid))))
 await ok('customer draft denied',assertFails(getDoc(doc(d('cat_customer'),'crystal_products','cp_draft_example'))))
 await ok('customer variant query',assertSucceeds(getDocs(query(collection(d('cat_customer'),'crystal_products',pid,'variants'),where('publication','==','published')))))
 await ok('customer draft variant denied',assertFails(getDoc(doc(d('cat_customer'),'crystal_products',pid,'variants','v_draft_example'))))
 for(const uid of ['cat_customer','cat_pending','cat_editor'])await ok(uid+' private mapping denied',assertFails(getDoc(doc(d(uid),'crystal_product_private',pid,'variants',vid))))
 await ok('supply mapping allowed',assertSucceeds(getDoc(doc(d('cat_supply'),'crystal_product_private',pid,'variants',vid))))
 await ok('customer inventory denied',assertFails(getDoc(doc(d('cat_customer'),'crystals','stock_rules_example'))))
 await ok('editor creates draft',assertSucceeds(setDoc(doc(d('cat_editor'),'crystal_products','cp_new_example'),product)))
 for(const [label,data] of [['private cost',{...product,cost:42}],['stock balance',{...product,stock_qty:4}],['unreviewed original',{...product,origin:'swarovski_strass',supply:'made_to_order'}],['published first write',{...product,publication:'published'}],['missing field',Object.fromEntries(Object.entries(product).filter(([k])=>k!=='unit'))]])await ok(label+' denied',assertFails(setDoc(doc(d('cat_editor'),'crystal_products','cp_invalid_'+label.replaceAll(' ','_')),data)))
 await ok('customer write denied',assertFails(setDoc(doc(d('cat_customer'),'crystal_products','cp_customer_example'),product)))
 await ok('supply-only content write denied',assertFails(setDoc(doc(d('cat_supply'),'crystal_products','cp_supply_example'),product)))
 await ok('no delete',assertFails(deleteDoc(doc(d('cat_admin'),'crystal_products',pid))))
 await ok('publish without photo and variant denied',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products','cp_new_example'),{publication:'published',revision:2,updated_at:serverTimestamp()})))
 for(const patch of [{revision:9},{revision:2,origin:'swarovski_strass',supply:'stock_only'},{revision:2,internal_notes:'private'},{revision:2,publication:'public'}])await ok('invalid product update denied',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products',pid),{...patch,updated_at:serverTimestamp()})))
 await ok('unconfirmed variant denied',assertFails(setDoc(doc(d('cat_editor'),'crystal_products',pid,'variants','v_unconfirmed_example'),{...variant,confirmed:false})))
 await ok('private variant field denied',assertFails(setDoc(doc(d('cat_editor'),'crystal_products',pid,'variants','v_private_example'),{...variant,supplier:'secret'})))
 await ok('orphan variant denied',assertFails(setDoc(doc(d('cat_editor'),'crystal_products','cp_missing_example','variants','v_example'),variant)))
 await ok('supply mapping update allowed',assertSucceeds(setDoc(doc(d('cat_supply'),'crystal_product_private',pid,'variants',vid),mapping)))
 for(const patch of [{stock_per_unit:0},{stock_per_unit:-1},{collection:'products'},{inventory_id:'missing_example'},{catalogue_unit:'sheet'},{stock_qty:100}])await ok('invalid mapping denied',assertFails(setDoc(doc(d('cat_supply'),'crystal_product_private',pid,'variants',vid),{...mapping,...patch})))
 await ok('customer direct product photo denied; server gate required',assertFails(getMetadata(ref(st('cat_customer'),media.display))))
 for(const uid of ['cat_pending','cat_supply'])await ok(uid+' product photo denied',assertFails(getMetadata(ref(st(uid),media.display))))
 await ok('anonymous photo denied',assertFails(getMetadata(ref(env.unauthenticatedContext().storage(),media.display))))
 await ok('unreferenced image denied',assertFails(getMetadata(ref(st('cat_customer'),root+'/old.jpg'))))
 const path=root+'/original.png',bytes=new Uint8Array([137,80,78,71])
 await ok('editor immutable product upload',assertSucceeds(uploadBytes(ref(st('cat_editor'),path),bytes,{contentType:'image/png'})))
 await ok('overwrite denied',assertFails(uploadBytes(ref(st('cat_editor'),path),bytes,{contentType:'image/png'})))
 await ok('delete photo denied',assertFails(deleteObject(ref(st('cat_admin'),path))))
 await ok('foreign media path denied',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products',pid,'images',iid),{media:{...media,display:'customers/private.jpg'},revision:2,updated_at:serverTimestamp()})))
 await ok('owner private drawing read',assertSucceeds(getMetadata(ref(st('cat_customer'),'enquiry-files/cat_customer/enquiry_example/drawing.pdf'))))
 await ok('admin private drawing read',assertSucceeds(getMetadata(ref(st('cat_admin'),'enquiry-files/cat_customer/enquiry_example/drawing.pdf'))))
 for(const uid of ['cat_other','cat_editor','cat_supply','cat_pending'])await ok(uid+' private drawing denied',assertFails(getMetadata(ref(st(uid),'enquiry-files/cat_customer/enquiry_example/drawing.pdf'))))
 await ok('owner drawing upload',assertSucceeds(uploadBytes(ref(st('cat_customer'),'enquiry-files/cat_customer/enquiry_example/new-drawing.pdf'),bytes,{contentType:'application/pdf'})))
 await ok('other owner upload denied',assertFails(uploadBytes(ref(st('cat_other'),'enquiry-files/cat_customer/enquiry_example/other-drawing.pdf'),bytes,{contentType:'application/pdf'})))
 await ok('pending upload denied',assertFails(uploadBytes(ref(st('cat_pending'),'enquiry-files/cat_pending/enquiry_example/new-drawing.pdf'),bytes,{contentType:'application/pdf'})))
 await ok('HTML drawing denied',assertFails(uploadBytes(ref(st('cat_customer'),'enquiry-files/cat_customer/enquiry_example/unsafe.pdf'),bytes,{contentType:'text/html'})))
 await ok('published cover cannot be archived in place',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products',pid,'images',iid),{publication:'archived',revision:2,updated_at:serverTimestamp()})))
 await ok('published primary variant cannot be archived in place',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products',pid,'variants',vid),{publication:'archived',revision:2,updated_at:serverTimestamp()})))
 const originalId='cp_original_review_example'
 await ok('original draft created',assertSucceeds(setDoc(doc(d('cat_both'),'crystal_products',originalId),{...product,origin:'swarovski_strass',supply:'stock_only'})))
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'crystal_products',originalId,'variants',vid),variant)
  await setDoc(doc(ctx.firestore(),'crystal_products',originalId,'images',iid),{...image,media:{...media,original:media.original.replace(pid,originalId),display:media.display.replace(pid,originalId),thumbnail:media.thumbnail.replace(pid,originalId)}})
 })
 const publish={publication:'published',hero_id:iid,primary_variant_id:vid,provenance_reviewed:true,condition:'Inspected original packaging',article_reference:'EXAMPLE',revision:2,updated_at:serverTimestamp()}
 await ok('original publish without stock review denied',assertFails(updateDoc(doc(d('cat_editor'),'crystal_products',originalId),publish)))
 await ok('supply records reviewed original-stock mapping',assertSucceeds(setDoc(doc(d('cat_supply'),'crystal_product_private',originalId,'variants',vid),mapping)))
 await ok('reviewed original publication succeeds',assertSucceeds(updateDoc(doc(d('cat_editor'),'crystal_products',originalId),publish)))
 await ok('archive parent',assertSucceeds(updateDoc(doc(d('cat_editor'),'crystal_products',pid),{publication:'archived',revision:2,updated_at:serverTimestamp()})))
 await ok('archive photo immediately denied',assertFails(getMetadata(ref(st('cat_customer'),media.display))))
 await ok('archive variant immediately denied',assertFails(getDoc(doc(d('cat_customer'),'crystal_products',pid,'variants',vid))))
 console.log(count+' crystal catalogue access assertions passed')
}finally{await env.cleanup()}
