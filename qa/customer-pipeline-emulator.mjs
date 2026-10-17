import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing'
import {doc,getDoc,setDoc,updateDoc,deleteDoc,collection,getDocs,serverTimestamp} from 'firebase/firestore'
import {summaryKey} from '../src/customerPipeline.js'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))throw Error('Local emulator required; no live writes.')
const env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:await readFile('firestore.rules','utf8')}})
const scratch=await mkdtemp(resolve('.qa-pipeline-emulator-'))
await build({entryPoints:['src/domain/customerPipeline.js'],outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',external:['firebase/firestore'],plugins:[{name:'test-db',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'mock',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const db=globalThis.__pipelineDb; export const authedUser=async()=>({uid:"pipeline_admin"});',loader:'js'}))}}]})
await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();for(const [id,profile] of Object.entries({pipeline_admin:{role:'admin'},pipeline_staff:{role:'staff',modules:['customers']},pipeline_supply:{role:'staff',modules:['supply']},pipeline_customer:{role:'customer',status:'approved',customer_id:'pipeline_one'}}))await setDoc(doc(d,'users',id),profile);await setDoc(doc(d,'customers/pipeline_one'),{company_name:'Fictional emulator customer'});await setDoc(doc(d,'customers/pipeline_two'),{company_name:'Other emulator customer'});await setDoc(doc(d,'dashboard_cache/weekly_summary'),{items:[{customerId:'pipeline_one',digest:'Requested a quotation and sample.'}]})})
const admin=env.authenticatedContext('pipeline_admin').firestore(),staff=env.authenticatedContext('pipeline_staff').firestore(),customer=env.authenticatedContext('pipeline_customer').firestore(),supply=env.authenticatedContext('pipeline_supply').firestore()
globalThis.__pipelineDb=admin
const api=await import(pathToFileURL(join(scratch,'customerPipeline.mjs')))
const key=await summaryKey('Requested a quotation and sample.')
const suggestion={status:'active',detail:'Quotation and sample; repeat order request',reason:'Buying request',evidence:'Requested a quotation',source_key:key,based_on_revision:0}
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
