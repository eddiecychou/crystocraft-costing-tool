import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,serverTimestamp} from 'firebase/firestore'
import {emptyProject} from '../src/pdProjects.js'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local emulator required; no live writes.')
const env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:await readFile('firestore.rules','utf8')}}),scratch=await mkdtemp(resolve('.qa-pd-emulator-'))
await env.withSecurityRulesDisabled(async c=>{for(const [id,p]of Object.entries({pd_admin:{role:'admin'},pd_staff:{role:'staff',modules:['product_design']},pd_crm:{role:'staff',modules:['customers']},pd_supply:{role:'staff',modules:['supply']},pd_customer:{role:'customer',status:'approved',modules:['product_design']},'mcp-range-upload-service':{role:'staff',modules:[],service_scope:'range-upload'}}))await setDoc(doc(c.firestore(),'users',id),p);for(const path of ['customers/c1','products/source','range_products/source','pd_prompt_templates/source'])await setDoc(doc(c.firestore(),path),{name:'Original untouched',gallery:['original'],status:'concept',active:false})})
const dbs=Object.fromEntries(['pd_admin','pd_staff','pd_crm','pd_supply','pd_customer','mcp-range-upload-service'].map(id=>[id,env.authenticatedContext(id).firestore()])),admin=dbs.pd_admin,staff=dbs.pd_staff
await build({entryPoints:['src/domain/pdProjects.js'],outfile:join(scratch,'api.mjs'),bundle:true,format:'esm',platform:'node',external:['firebase/firestore'],plugins:[{name:'local-db',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export const db=globalThis.__pdDb;export const authedUser=async()=>({uid:globalThis.__pdActor||"pd_admin"});'}))}}]})
globalThis.__pdDb=admin;const api=await import(pathToFileURL(join(scratch,'api.mjs'))),input=()=>({...emptyProject(),title:'Fictional internal coach'})
after(async()=>{await env.cleanup();await rm(scratch,{recursive:true,force:true});delete globalThis.__pdDb;delete globalThis.__pdActor})
test('real API creates optional blanks, reopens/list and saves immutable actor-stamped history',async()=>{
 await api.saveDesignProject('qa_project',null,input(),'Initial direction','create_1')
 const p=await api.getDesignProject('qa_project');assert.equal(p.customerId,null);assert.equal(p.leadImageUrl,'');assert.equal(p.revision,1);assert.equal((await api.listDesignProjects()).length,1)
 const h=await api.designProjectHistory('qa_project');assert.equal(h.items[0].actor,'pd_admin');assert.equal(h.items[0].note,'Initial direction');assert.equal(h.items[0].project.title,p.title);assert.equal(h.items[0].kind,'create')
 await assertFails(updateDoc(doc(admin,'pd_projects/qa_project/updates/create_1'),{note:'rewrite'}));await assertFails(deleteDoc(doc(admin,'pd_projects/qa_project/updates/create_1')))
})
test('real edit, note and archive preserve earlier decisions; no design completion side effects',async()=>{
 let p=await api.getDesignProject('qa_project');await api.saveDesignProject(p.id,p,{...p,status:'Completed'},'Design only complete','edit_2');p=await api.getDesignProject(p.id);await api.saveDesignProject(p.id,p,p,'Correction: keep source references','note_3','note');p=await api.getDesignProject(p.id);await api.saveDesignProject(p.id,p,{...p,archived:true},'Archived for reference','archive_4')
 p=await api.getDesignProject(p.id);assert.equal(p.status,'Completed');assert.equal(p.archived,true);assert.equal((await api.designProjectHistory(p.id)).items.length,4)
 for(const path of ['customers/c1','products/source','range_products/source','pd_prompt_templates/source'])assert.deepEqual((await getDoc(doc(admin,path))).data(),{name:'Original untouched',gallery:['original'],status:'concept',active:false})
})
test('same-event retry is idempotent even after later edits; changed retry rejected',async()=>{
 const first={...input(),title:'Retry project'};await api.saveDesignProject('qa_retry',null,first,'First','stable');let p=await api.getDesignProject('qa_retry');await api.saveDesignProject(p.id,p,{...p,nextAction:'Check scale'},'Second','second');await api.saveDesignProject('qa_retry',null,first,'First','stable');assert.equal((await api.getDesignProject('qa_retry')).revision,2);assert.equal((await api.designProjectHistory('qa_retry')).items.length,2);await assert.rejects(api.saveDesignProject('qa_retry',null,{...first,title:'Different'},'First','stable'),/already saved/)
})
test('stale edits and concurrent editors cannot overwrite each other',async()=>{let p=await api.getDesignProject('qa_retry');const results=await Promise.allSettled([api.saveDesignProject(p.id,p,{...p,currentState:'A'},'A','concurrent_a'),api.saveDesignProject(p.id,p,{...p,currentState:'B'},'B','concurrent_b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(api.saveDesignProject(p.id,p,p,'Old','stale'),/changed/);assert.equal((await api.getDesignProject(p.id)).revision,3)})
async function atomic(db,id,patch={},eventPatch={}){const target=doc(db,'pd_projects',id),data={...input(),revision:1,createdAt:serverTimestamp(),created_by:'pd_staff',updatedAt:serverTimestamp(),updated_by:'pd_staff',eventId:'first',...patch},event={kind:'create',note:'',actor:'pd_staff',actorLabel:'pd_staff',at:serverTimestamp(),revision:data.revision,previous:{},project:data,...eventPatch},batch=writeBatch(db);batch.set(target,data);batch.set(doc(target,'updates','first'),event);return batch.commit()}
test('Product Design staff can create/read/list/history but CRM, supply, customer, anonymous and MCP cannot',async()=>{
 await assertSucceeds(atomic(staff,'staff_project',{customerId:'missing-customer',customerLabel:'Saved customer'}));await assertSucceeds(getDocs(collection(staff,'pd_projects')));await assertSucceeds(getDocs(collection(staff,'pd_projects/staff_project/updates')))
 for(const db of [dbs.pd_crm,dbs.pd_supply,dbs.pd_customer,dbs['mcp-range-upload-service'],env.unauthenticatedContext().firestore()]){await assertFails(getDoc(doc(db,'pd_projects/staff_project')));await assertFails(getDocs(collection(db,'pd_projects')));await assertFails(getDoc(doc(db,'pd_projects/staff_project/updates/first')));await assertFails(atomic(db,'denied_project'))}
})
test('root create/update require atomic history, typed fields, honest actor and bounded links',async()=>{
 const invalid=[{status:'Published'},{title:''},{revision:2},{created_by:'other'},{updated_by:'other'},{nextAction:'x'.repeat(601)},{unexpected:true},{customerId:'bad/id'},{leadImageUrl:'https://evil.example/a.jpg'},{links:[{type:'range_product',recordId:'valid',url:'/products/valid',label:''}]},{links:Array(5).fill({type:'repo',recordId:'',url:'https://github.com/example/repo',label:''})},{links:[{type:'reference',recordId:'',url:'javascript:alert(1)',label:''}]}]
 for(const [i,p]of invalid.entries())await assertFails(atomic(staff,'invalid_'+i,p))
 await assertFails(atomic(staff,'forged_actor',{}, {actor:'other'}));await assertFails(atomic(staff,'forged_before',{}, {previous:{title:'invented'}}))
 const p=(await getDoc(doc(staff,'pd_projects/staff_project'))).data();await assertFails(updateDoc(doc(staff,'pd_projects/staff_project'),{nextAction:'No receipt',revision:2}));await assertFails(deleteDoc(doc(admin,'pd_projects/staff_project')))
 await assertFails(setDoc(doc(staff,'pd_projects/staff_project/updates/orphan'),{kind:'note',note:'Orphan',actor:'pd_staff',actorLabel:'pd_staff',at:serverTimestamp(),revision:2,previous:p,project:p}))
})
test('history pagination keeps all updates and cursor does not repeat earlier entries',async()=>{
 const p=(await api.getDesignProject('qa_project'));const first=await api.designProjectHistory(p.id),second=await api.designProjectHistory(p.id,first.cursor);assert.equal(first.items.length,4);assert.equal(second.items.length,0);assert.equal(new Set(first.items.map(h=>h.id)).size,4)
})
test('valid maximum reference list and later edit stay within rule evaluation budget',async()=>{
 const links=Array.from({length:4},(_,i)=>({type:'range_product',label:'Range '+i,recordId:'range_'+i,url:'/range/range_'+i}))
 await api.saveDesignProject('qa_max_links',null,{...input(),links},'All references','max_1');const p=await api.getDesignProject('qa_max_links');await api.saveDesignProject(p.id,p,{...p,currentState:'Updated'},'Correction','max_2');assert.equal((await api.getDesignProject(p.id)).links.length,4)
})
test('note cannot disguise overview edits, immutable creator changes or revision jumps',async()=>{
 const ref=doc(staff,'pd_projects/staff_project'),before=(await getDoc(ref)).data()
 for(const [index,patch]of [{title:'Hidden change'},{created_by:'other'},{revision:9}].entries()){
  const data={...before,revision:before.revision+1,updatedAt:serverTimestamp(),updated_by:'pd_staff',eventId:'bad_note_'+index,...patch},batch=writeBatch(staff)
  batch.set(ref,data);batch.set(doc(ref,'updates',data.eventId),{kind:'note',note:'Not a field edit',actor:'pd_staff',actorLabel:'pd_staff',at:serverTimestamp(),revision:data.revision,previous:before,project:data});await assertFails(batch.commit())
 }
})
test('history really pages beyond fifty entries without truncating or repeating',async()=>{
 await env.withSecurityRulesDisabled(async c=>{for(let n=1;n<=52;n++)await setDoc(doc(c.firestore(),'pd_projects/qa_pages/updates/event_'+n),{revision:n,actor:'seed',note:'Fictional pagination fixture',project:{title:'Paged history'}})})
 const first=await api.designProjectHistory('qa_pages'),second=await api.designProjectHistory('qa_pages',first.cursor)
 assert.equal(first.items.length,50);assert.equal(first.more,true);assert.equal(second.items.length,2);assert.equal(second.more,false);assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,52)
})
test('four external evidence links and trusted image URLs pass the same root/history rules',async()=>{
 const links=Array.from({length:4},(_,i)=>({type:'repo',label:'Evidence '+i,recordId:'',url:'https://github.com/example/repo/blob/main/note@'+i+'.md'}))
 await api.saveDesignProject('qa_external',null,{...input(),links,leadImageUrl:'https://firebasestorage.googleapis.com/v0/b/example/o/image.jpg?alt=media'},'Evidence only','external_1')
 assert.equal((await api.getDesignProject('qa_external')).links.length,4)
})
