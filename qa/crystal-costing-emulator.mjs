// Actual linking/quote/code-claim engine, SDK and current Firestore/Storage rules.
// Fixture-only loopback test. Run under both emulators with node (bounded worker).
// Storage cross-service reads use the emulator launch project, so Firestore
// fixture identities must use that same project (including in the full CI chain).
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, collection, getDocFromServer, getDocsFromServer, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { ref, uploadBytes, getMetadata } from 'firebase/storage'
import { cleanCrystalProduct, cleanCrystalVariant } from '../src/domain/crystalProducts.js'
import { runNodeTest } from './test-process.mjs'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error('Explicit loopback '+key+' required; live fixture access forbidden.')
if(process.env.OC_CRYSTAL_COSTING_EMULATOR_CHILD!=='1')runNodeTest(['--test',fileURLToPath(import.meta.url)],{label:'Crystal supplier costing emulator checks',timeoutMs:120000,env:{...process.env,OC_CRYSTAL_COSTING_EMULATOR_CHILD:'1'}})
else{
 const {before,beforeEach,afterEach,after,test}=await import('node:test')
 const projectId=process.env.GCLOUD_PROJECT
 assert.ok(['crystocraft-rbac-test','demo-crystal-costing-regression'].includes(projectId),'Use an approved fixture project via firebase emulators:exec; live fixture access forbidden.')
 const P='cp_costing_fixture',V='v_rose_fixture',C='rc_costing_fixture',Q='quote_costing_fixture',S='supplier_costing_fixture'
 const cp='crystal_products/'+P,vp=cp+'/variants/'+V,cc='range_components/'+C,qp=cc+'/supplier_quotes/'+Q,pdfPath=cc+'/quotes/fictional-private.pdf'
 const product={id:P,code:'CC-FIXTURE',name:'Fictional Pear Crystal'},variant={id:V,code:'CC-FIXTURE-ROSE',label:'Fictional Rose',unit:'pcs'}
 const attachment={file_url:'/fictional-private.pdf',file_name:'Fictional source 中文.pdf',file_type:'pdf',storage_path:pdfPath,sha256:'b'.repeat(64)}
 const quote={supplier_id:S,supplier_name:'Fictional Supplier',unit_cost:1.222,unit_cost_currency:'USD',volume_tiers:[{min_qty:1000,unit_cost:1.111}],moq:500,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',sampling_lead_time_days:null,tooling_lead_time_days:12,production_lead_time_days:30,is_preferred:true,notes:'Approved fictional terms 中文',attachments:[attachment],createdAt:'ORIGINAL',provenance:{preserve:true}}
 const component={code:variant.code,name:'Fictional private component',stock_qty:102,reserved_qty:10,ledger_seeded:true,movement_seq:4,images:['/existing-fixture.jpg'],notes:'Preserve component',unit_cost:1.222,unit_cost_currency:'USD',volume_tiers:quote.volume_tiers,tooling_sample_cost:155,tooling_sample_cost_currency:'USD',preferred_quote_id:Q,preferred_supplier_name:quote.supplier_name}
 const ctx={crystal_product_id:P,crystal_variant_id:V},copy=structuredClone
 let environment,db,engine,scratch,generation=0
 const clients=new Set(),context=uid=>environment.authenticatedContext(uid)
 const withDisabled=callback=>environment.withSecurityRulesDisabled(async owner=>{const ownerDb=owner.firestore();try{return await callback(ownerDb,owner.storage())}finally{await ownerDb.terminate()}})
 const data=async path=>{const s=await getDocFromServer(doc(db,path));return s.exists()?s.data():null}
 before(async()=>{
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':'),[storageHost,storagePort]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')
  const rules=await readFile('firestore.rules','utf8'),storageRules=await readFile('storage.rules','utf8')
  environment=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules},storage:{host:storageHost,port:Number(storagePort),rules:storageRules}})
  await mkdir('qa/out',{recursive:true});scratch=await mkdtemp(resolve('qa/out/crystal-costing-sdk-engine-'))
  await build({stdin:{contents:"export * from './src/crystalSupplierCosting.js';export {saveComponentQuote,setPreferredQuote,deleteComponentQuote} from './src/criticalComponents.js'",resolveDir:process.cwd()},outfile:join(scratch,'engine.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'crystal-costing-loopback-db',setup(b){b.onResolve({filter:/^(firebase\/.*|react)$/},a=>({path:a.path,external:true}));b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const db=globalThis.__crystalCostingSdkDb;'}))}}]})
  const hash=value=>createHash('sha256').update(value).digest('hex');console.log('[crystal-costing] current rules SHA256',hash(rules),'Storage SHA256',hash(storageRules))
 },{timeout:25000})
 beforeEach(async()=>{
  await environment.clearFirestore();await environment.clearStorage()
  await withDisabled(async(ownerDb,storage)=>{
   for(const[uid,profile]of Object.entries({costing_admin:{role:'admin'},costing_both:{role:'staff',modules:['swatch','supply']},costing_supply:{role:'staff',modules:['supply']},costing_editor:{role:'staff',modules:['swatch']},costing_customer:{role:'customer',status:'approved'}}))await setDoc(doc(ownerDb,'users',uid),profile)
   const stamp={revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}
   await setDoc(doc(ownerDb,cp),{...cleanCrystalProduct({...product,family:'cut',origin:'crystocraft',supply:'made_to_order',unit:'pcs',publication:'draft'}),...stamp})
   await setDoc(doc(ownerDb,vp),{...cleanCrystalVariant({...variant,publication:'draft',confirmed:true}),...stamp})
   await setDoc(doc(ownerDb,cc),component);await setDoc(doc(ownerDb,qp),quote);await setDoc(doc(ownerDb,'suppliers',S),{name:quote.supplier_name})
   await uploadBytes(ref(storage,pdfPath),new Uint8Array([37,80,68,70,45,49,46,52]),{contentType:'application/pdf'})
  })
  db=context('costing_both').firestore();clients.add(db);globalThis.__crystalCostingSdkDb=db
  engine=await import(pathToFileURL(join(scratch,'engine.mjs')).href+'?case='+(++generation))
 },{timeout:25000})
 afterEach(async()=>{try{await Promise.all([...clients].map(c=>c.terminate()))}finally{clients.clear();delete globalThis.__crystalCostingSdkDb}},{timeout:10000})
 after(async()=>{try{await environment?.cleanup()}finally{delete globalThis.__crystalCostingSdkDb;if(scratch)await rm(scratch,{recursive:true,force:true})}},{timeout:10000})
 const link=()=>engine.linkCrystalCosting({productId:P,variantId:V,componentId:C,quoteId:Q,expectedLink:{product:'',variant:'',unit:''}})
 test('real link transaction changes six private metadata fields only and preserves PDF/preference/stock', {timeout:20000},async()=>{
  const before={product:await data(cp),variant:await data(vp),component:await data(cc),quote:await data(qp)}
  await link();const linked=await data(cc)
  const added=Object.keys(linked).filter(key=>!(key in before.component)).sort();assert.deepEqual(added,['crystal_catalogue_unit','crystal_linked_at','crystal_product_code','crystal_product_id','crystal_variant_code','crystal_variant_id'])
  for(const[key,value]of Object.entries(before.component))assert.deepEqual(linked[key],value,key)
  assert.deepEqual(await data(qp),before.quote);assert.deepEqual(await data(cp),before.product);assert.deepEqual(await data(vp),before.variant)
  await engine.linkCrystalCosting({productId:P,variantId:V,componentId:C,quoteId:Q,expectedLink:{product:P,variant:V,unit:'pcs'}})
  assert.deepEqual(await data(cc),linked);assert.deepEqual(await data(qp),before.quote)
 })
 test('concurrent creation/retry shares one stable ID and canonical code claim without duplicate components', {timeout:25000},async()=>{
  const next={id:'v_other_fixture',code:'CC-FIXTURE-CLEAR',label:'Fictional clear',unit:'pcs'}
  await withDisabled(owner=>setDoc(doc(owner,cp,'variants',next.id),{...cleanCrystalVariant({...next,publication:'draft',confirmed:true}),revision:1,created_at:serverTimestamp(),updated_at:serverTimestamp()}))
  const ids=await Promise.all([engine.createCrystalCostingComponent(product,next),engine.createCrystalCostingComponent(product,next)])
  assert.equal(ids[0],ids[1]);assert.equal(await engine.createCrystalCostingComponent(product,next),ids[0])
  const components=await getDocsFromServer(collection(db,'range_components')),claims=await getDocsFromServer(collection(db,'range_component_claims'))
  assert.equal(components.size,2);assert.equal(claims.size,1);assert.equal(claims.docs[0].data().component_id,ids[0]);assert.equal((await data('range_components/'+ids[0])).crystal_variant_id,next.id)
  assert.deepEqual(await data(qp),quote);assert.deepEqual(await data(cc),component)
 })
 test('actual guarded save/preference/delete atomically retain exact source bytes and stock fields', {timeout:25000},async()=>{
  await link();await engine.saveComponentQuote(C,Q,{...copy(quote),unit_cost:1.223,volume_tiers:[{min_qty:1000,unit_cost:1.112}]},ctx)
  assert.equal((await data(cc)).unit_cost,1.223);assert.equal((await data(qp)).unit_cost,1.223);assert.equal((await data(qp)).volume_tiers[0].unit_cost,1.112);assert.deepEqual((await data(qp)).attachments,[attachment]);assert.deepEqual((await data(qp)).provenance,quote.provenance)
  const other=await engine.saveComponentQuote(C,null,{...copy(quote),unit_cost:1.444,is_preferred:false},ctx)
  await engine.setPreferredQuote(C,other,ctx);assert.equal((await data(cc)).preferred_quote_id,other);assert.equal((await data(qp)).is_preferred,false);assert.equal((await data(cc)).unit_cost,1.444)
  await engine.deleteComponentQuote(C,other,ctx);assert.equal(await data(cc+'/supplier_quotes/'+other),null);assert.equal((await data(cc)).unit_cost,null)
  for(const key of ['stock_qty','reserved_qty','ledger_seeded','movement_seq','images','notes'])assert.deepEqual((await data(cc))[key],component[key],key)
  assert.deepEqual((await data(qp)).attachments,[attachment])
 })
 test('a fresh variant-unit change blocks save/preference/delete and keeps quote/component unchanged', {timeout:20000},async()=>{
  await link();await withDisabled(owner=>setDoc(doc(owner,vp),{...cleanCrystalVariant({...variant,unit:'sheet',publication:'draft',confirmed:true}),revision:2,created_at:serverTimestamp(),updated_at:serverTimestamp()}))
  const before={component:await data(cc),quote:await data(qp)}
  for(const operation of[()=>engine.saveComponentQuote(C,Q,quote,ctx),()=>engine.setPreferredQuote(C,Q,ctx),()=>engine.deleteComponentQuote(C,Q,ctx)])await assert.rejects(operation(),/costing link changed/)
  assert.deepEqual(await data(cc),before.component);assert.deepEqual(await data(qp),before.quote)
 })
 test('deleted supplier cannot become preferred; refusal leaves existing approved source untouched', {timeout:20000},async()=>{
  await link();const before={component:await data(cc),quote:await data(qp)};await withDisabled(owner=>deleteDoc(doc(owner,'suppliers',S)))
  await assert.rejects(engine.setPreferredQuote(C,Q,ctx),/existing supplier/)
  assert.deepEqual(await data(cc),before.component);assert.deepEqual(await data(qp),before.quote)
 })
 test('current rules allow supply/admin private component/quote/files and deny customer/swatch-only access', {timeout:25000},async()=>{
  for(const uid of['costing_admin','costing_supply']){
   const user=context(uid),userDb=user.firestore();clients.add(userDb)
   await assertSucceeds(getDocFromServer(doc(userDb,cc)));await assertSucceeds(getDocFromServer(doc(userDb,qp)));await assertSucceeds(getDocsFromServer(collection(userDb,cc,'supplier_quotes')))
   await assertSucceeds(getMetadata(ref(user.storage(),pdfPath)))
  }
  for(const uid of['costing_customer','costing_editor']){
   const user=context(uid),userDb=user.firestore();clients.add(userDb)
   await assertFails(getDocFromServer(doc(userDb,cc)));await assertFails(getDocFromServer(doc(userDb,qp)));await assertFails(getDocsFromServer(collection(userDb,cc,'supplier_quotes')))
   await assertFails(getMetadata(ref(user.storage(),pdfPath)))
   await assertFails(setDoc(doc(userDb,cc),{...component,crystal_product_id:P,crystal_variant_id:V},{merge:true}))
  }
  assert.deepEqual(await data(cc),component);assert.deepEqual(await data(qp),quote)
 })
}
