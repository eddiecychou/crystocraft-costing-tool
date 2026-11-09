import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing'
import {doc,getDoc,setDoc,updateDoc,deleteDoc,collection,getDocs,serverTimestamp} from 'firebase/firestore'
import {summaryKey} from '../src/customerPipeline.js'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore,FieldPath} from 'firebase-admin/firestore'
import {loadCustomerActivity,projectCustomerActivity} from '../netlify/functions/lib/customerWorkbench.js'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))throw Error('Local emulator required; no live writes.')
const env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:await readFile('firestore.rules','utf8')}})
const scratch=await mkdtemp(resolve('.qa-pipeline-emulator-'))
await build({entryPoints:['src/domain/customerPipeline.js','src/domain/customerWorkItems.js','src/domain/customerWorkStages.js'],outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',external:['firebase/firestore'],plugins:[{name:'test-db',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'mock',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const db=globalThis.__pipelineDb; export const authedUser=async()=>({uid:"pipeline_admin"});',loader:'js'}))}}]})
await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();for(const [id,profile] of Object.entries({pipeline_admin:{role:'admin'},pipeline_staff:{role:'staff',modules:['customers']},pipeline_supply:{role:'staff',modules:['supply']},pipeline_customer:{role:'customer',status:'approved',customer_id:'pipeline_one'}}))await setDoc(doc(d,'users',id),profile);await setDoc(doc(d,'customers/pipeline_one'),{company_name:'Fictional emulator customer'});await setDoc(doc(d,'customers/pipeline_two'),{company_name:'Other emulator customer'});await setDoc(doc(d,'dashboard_cache/weekly_summary'),{items:[{customerId:'pipeline_one',digest:'Requested a quotation and sample.'}]})})
const admin=env.authenticatedContext('pipeline_admin').firestore(),staff=env.authenticatedContext('pipeline_staff').firestore(),customer=env.authenticatedContext('pipeline_customer').firestore(),supply=env.authenticatedContext('pipeline_supply').firestore()
globalThis.__pipelineDb=admin
const api=await import(pathToFileURL(join(scratch,'customerPipeline.mjs')))
const tasks=await import(pathToFileURL(join(scratch,'customerWorkItems.mjs')))
const stages=await import(pathToFileURL(join(scratch,'customerWorkStages.mjs')))
const key=await summaryKey('Requested a quotation and sample.')
const suggestion={status:'active',detail:'Quotation and sample; repeat order request',reason:'Buying request',evidence:'Requested a quotation',source_key:key,source_cache:'weekly_summary',based_on_revision:0}
after(async()=>{await env.cleanup();await rm(scratch,{recursive:true,force:true});delete globalThis.__pipelineDb})
test('actual transaction stages without activation, confirms once and keeps immutable history',async()=>{
 await api.savePipelineDecision('pipeline_one',0,'suggest',{suggestion},'pipeline-stage')
 let c=(await getDoc(doc(admin,'customers/pipeline_one'))).data();assert.equal(c.sales_pipeline.status,'inactive')
 await api.savePipelineDecision('pipeline_one',1,'confirm',{sourceKey:key,detail:'Sample + quotation; repeat request stays open'},'pipeline-confirm')
 await api.savePipelineDecision('pipeline_one',1,'confirm',{sourceKey:key,detail:'Ignored retry'},'pipeline-confirm')
 c=(await getDoc(doc(admin,'customers/pipeline_one'))).data();assert.equal(c.sales_pipeline.status,'active');assert.equal(c.sales_pipeline.revision,2)
 assert.equal((await getDocs(collection(admin,'customers/pipeline_one/pipeline_history'))).size,2)
 await assertFails(updateDoc(doc(admin,'customers/pipeline_one/pipeline_history/pipeline-confirm'),{action:'fake'}));await assertFails(deleteDoc(doc(admin,'customers/pipeline_one/pipeline_history/pipeline-confirm')))
})
test('stale/concurrent review fails instead of overwriting a decision',async()=>{
 await assert.rejects(api.savePipelineDecision('pipeline_one',1,'manual',{status:'inactive',detail:'Stale'}),/changed/)
 const result=await Promise.allSettled([api.savePipelineDecision('pipeline_one',2,'manual',{status:'active',detail:'Request A'}),api.savePipelineDecision('pipeline_one',2,'manual',{status:'active',detail:'Request B'})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1)
})
test('summary change prevents stale AI staging and confirmation',async()=>{
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'dashboard_cache/weekly_summary'),{items:[{customerId:'pipeline_one',digest:'Changed summary'}]}))
 const p=(await getDoc(doc(admin,'customers/pipeline_one'))).data().sales_pipeline
 await assert.rejects(api.savePipelineDecision('pipeline_one',p.revision,'suggest',{suggestion:{...suggestion,based_on_revision:p.revision}}),/summary changed/)
})
test('customer/anonymous/supply cannot read Pipeline or history; CRM staff can',async()=>{
 for(const db of [customer,supply,env.unauthenticatedContext().firestore()]){await assertFails(getDoc(doc(db,'customers/pipeline_one')));await assertFails(getDoc(doc(db,'customers/pipeline_one/pipeline_history/pipeline-confirm')));await assertFails(updateDoc(doc(db,'customers/pipeline_one'),{sales_pipeline:{status:'active'}}))}
 await assertSucceeds(getDoc(doc(staff,'customers/pipeline_one')));await assertSucceeds(getDoc(doc(staff,'customers/pipeline_one/pipeline_history/pipeline-confirm')))
})
test('malformed position, removal, missing audit, forged actor and stale revision denied',async()=>{
 const p=(await getDoc(doc(admin,'customers/pipeline_one'))).data().sales_pipeline
 for(const patch of [{status:'broken'},{revision:p.revision},{updated_by:'other'},{detail:'x'.repeat(8001)}])await assertFails(updateDoc(doc(admin,'customers/pipeline_one'),{sales_pipeline:{...p,...patch,revision:p.revision+1,updatedAt:serverTimestamp(),event_id:'no-audit'}}))
 await assertFails(setDoc(doc(admin,'customers/pipeline_one'),{company_name:'Cannot remove Pipeline'}))
})
test('merge lock prevents review and ordinary customer edits preserve the Pipeline',async()=>{
 await assertSucceeds(updateDoc(doc(staff,'customers/pipeline_one'),{company_name:'Still preserved'}))
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'customers/pipeline_one'),{customer_merge_lock:'job'}))
 const p=(await getDoc(doc(admin,'customers/pipeline_one'))).data().sales_pipeline
 await assert.rejects(api.savePipelineDecision('pipeline_one',p.revision,'manual',{status:'inactive',detail:'No active requests'}),/merged/)
})
test('review uses the proposal’s original period cache, not the current display period',async()=>{
 const digest='Another repeat quotation remains active.',hash=await summaryKey(digest)
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'dashboard_cache/customer_summary_90'),{items:[{customerId:'pipeline_two',digest}]}))
 await api.savePipelineDecision('pipeline_two',0,'suggest',{suggestion:{...suggestion,source_key:hash,source_cache:'customer_summary_90'}},'period-stage')
 await api.savePipelineDecision('pipeline_two',1,'confirm',{sourceKey:hash,detail:'Repeat quotation remains active'},'period-confirm')
 assert.equal((await getDoc(doc(admin,'customers/pipeline_two'))).data().sales_pipeline.status,'active')
})

test('six-month and one-year caches support suggestions without changing confirmed positions or portal access',async()=>{
 for(const days of [180,365]){
  const id='period_'+days,cache='customer_summary_'+days,digest='Requested a new sample and quotation.',hash=await summaryKey(digest)
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'customers',id),{company_name:'Fictional period QA'});await setDoc(doc(c.firestore(),'dashboard_cache',cache),{items:[{customerId:id,digest}]})})
  await api.savePipelineDecision(id,0,'suggest',{suggestion:{...suggestion,source_key:hash,source_cache:cache}},'period-stage-'+days)
  assert.equal((await getDoc(doc(admin,'customers',id))).data().sales_pipeline.status,'inactive')
  await assertFails(getDoc(doc(customer,'dashboard_cache',cache)))
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'dashboard_cache',cache)))
 }
})

test('creating an open task activates work atomically once, retains stage unset and preserves retry/closure history',async()=>{
 const id='workbench_task',input={kind:'task',text:'Fictional sample follow-up',due_on:'',state:'waiting'}
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'customers',id),{company_name:'Fictional task customer',crm_status:'Prospect'}))
 await tasks.saveCustomerWorkItem(id,null,input,'stable_task')
 const c=() => getDoc(doc(admin,'customers',id)),hist=()=>getDocs(collection(admin,'customers',id,'pipeline_history'))
 let saved=(await c()).data();assert.equal(saved.sales_pipeline.status,'active');assert.equal(saved.sales_pipeline.revision,1);assert.equal(saved.crm_status,'Prospect');assert.equal(saved.dashboard_work,undefined)
 assert.equal((await hist()).size,1);assert.equal((await getDoc(doc(admin,'customers',id,'work_items','stable_task'))).data().revision,1)
 await tasks.saveCustomerWorkItem(id,null,input,'stable_task');assert.equal((await hist()).size,1)
 await api.savePipelineDecision(id,1,'manual',{status:'inactive',detail:'Explicit review completed'},'review-close')
 await tasks.saveCustomerWorkItem(id,null,input,'stable_task');assert.equal((await c()).data().sales_pipeline.status,'inactive','Lost-ack retry cannot reactivate an explicitly closed position');assert.equal((await hist()).size,2)
 await tasks.saveCustomerWorkItem(id,{id:'stable_task',source:'work_item',revision:1},{...input,state:'done'});assert.equal((await c()).data().sales_pipeline.status,'inactive')
})
test('notes never activate work and adding a task to an active company preserves its other requests',async()=>{
 const id='workbench_notes'
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'customers',id),{company_name:'Fictional notes'}))
 await tasks.saveCustomerWorkItem(id,null,{kind:'note',text:'Reference only'},'note')
 assert.equal((await getDoc(doc(admin,'customers',id))).data().sales_pipeline,undefined)
 await api.savePipelineDecision(id,0,'manual',{status:'active',detail:'Separate old quotation and sample requests'},'existing')
 const before=(await getDoc(doc(admin,'customers',id))).data()
 await tasks.saveCustomerWorkItem(id,null,{kind:'task',text:'Additional follow-up'},'additional')
 assert.deepEqual((await getDoc(doc(admin,'customers',id))).data(),before)
 assert.equal((await getDocs(collection(admin,'customers',id,'pipeline_history'))).size,1)
})
test('task activation respects merge locks and missing parents, with no partial task or audit writes',async()=>{
 const id='workbench_locked'
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'customers',id),{company_name:'Fictional locked',customer_merge_lock:'merge-job'}))
 for(const customerId of [id,'workbench_missing']){
  await assert.rejects(tasks.saveCustomerWorkItem(customerId,null,{kind:'task',text:'Must remain a draft'},'blocked'),/missing|merged/)
  assert.equal((await getDoc(doc(admin,'customers',customerId,'work_items','blocked'))).exists(),false)
  assert.equal((await getDocs(collection(admin,'customers',customerId,'pipeline_history'))).size,0)
 }
})
test('explicit multiple work stages save/reload, concurrent changes reject, and portal readers remain denied',async()=>{
 const id='workbench_stages'
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'customers',id),{company_name:'Fictional stages'}))
 await stages.saveCustomerWorkStages(id,0,['exploration','order'],'stage_once');await stages.saveCustomerWorkStages(id,0,['order','exploration'],'stage_once')
 let saved=(await getDoc(doc(admin,'customers',id))).data();assert.deepEqual(saved.dashboard_work.stages,['exploration','order']);assert.equal(saved.sales_pipeline.status,'active');assert.equal((await getDocs(collection(admin,'customers',id,'pipeline_history'))).size,1)
 await assert.rejects(stages.saveCustomerWorkStages(id,0,['quotation'],'stale'),/changed/)
 await stages.saveCustomerWorkStages(id,1,[],'clear');saved=(await getDoc(doc(admin,'customers',id))).data();assert.deepEqual(saved.dashboard_work.stages,[]);assert.equal(saved.sales_pipeline.status,'active','Clearing manual stages does not close other requests')
 for(const db of [customer,supply,env.unauthenticatedContext().firestore()]){await assertFails(getDoc(doc(db,'customers',id)));await assertFails(updateDoc(doc(db,'customers',id),{dashboard_work:{stages:['order']}}))}
})

test('real Admin repository reads selected communication headers only and projects exact B2B dates',async()=>{
 const app=initializeApp({projectId:'crystocraft-rbac-test'},'workbench-metadata-qa'),server=getFirestore(app),now=Date.now(),date=new Date(now-120*86400000).toISOString()
 try{
  await server.doc('customers/metadata_b2b').set({company_name:'Fictional metadata',customer_type:'b2b'})
  await server.doc('customers/metadata_retail').set({customer_type:'retail'})
  await server.doc('customers/metadata_b2b/email_threads/header').set({date_range:[date,date],messages:[{body:'Must not be selected'}],attachments:['private.pdf']})
  await server.doc('customers/metadata_b2b/enquiries/internal_note').set({channel:'Internal',date:new Date(now).toISOString()})
  await server.doc('customers/metadata_retail/email_threads/header').set({date_range:[date,date]})
  const loaded=await loadCustomerActivity(server,()=>FieldPath.documentId())
  assert.ok(loaded.records.some(r=>r.path==='customers/metadata_b2b/email_threads/header'))
  assert.ok(loaded.records.every(r=>!Object.hasOwn(r,'messages')&&!Object.hasOwn(r,'attachments')))
  const projected=projectCustomerActivity(loaded.customers,loaded.records,now)
  assert.equal(projected.find(c=>c.customerId==='metadata_b2b').lastContactAt,date)
  assert.equal(projected.some(c=>c.customerId==='metadata_retail'),false)
 }finally{await deleteApp(app)}
})
