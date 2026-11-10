// Real Dashboard + CustomerDetail, real listeners/transactions/rules, fictional
// data on a loopback emulator only. No .env, service account, or network API.
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {build} from 'esbuild'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route,useNavigate} from 'react-router-dom'
import {Simulate} from 'react-dom/test-utils'
import {JSDOM} from 'jsdom'
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing'
import {initializeApp as initializeAuditApp,deleteApp as deleteAuditApp} from 'firebase-admin/app'
import {getFirestore as getAuditFirestore} from 'firebase-admin/firestore'
import {doc,getDoc,getDocFromCache,getDocs,collection,setDoc,Timestamp} from 'firebase/firestore'
import {calendarClock} from './local-day-clock.mjs'
import {workspaceSyncPlugin} from './customer-workspace-sync-fixture.mjs'
import {testStep} from './async-test-step.mjs'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore emulator required; live fixture writes forbidden.')
let env,db,auditApp,auditDb,Dashboard,CustomerDetail,scratch,dom
// Freeze only the bundled page calendar. SDK/network timers and polling stay real.
const CALENDAR_NOW=Date.parse('2026-10-17T13:30:00Z')
const C='sync_customer',OTHER='sync_other',legacy={description:'Original conversation',status:'Quoted',date:Timestamp.fromMillis(1000),follow_up_date:Timestamp.fromMillis(2000),attachments:[{name:'original.pdf'}]}
const SUMMARY_CASE='both real pages expose six months and one year and load their independent saved summaries'
const stepFor=t=>(label,operation)=>t.name===SUMMARY_CASE?testStep(label,operation):operation()
before(async()=>{
 dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});for(const name of ['window','document','HTMLElement','Event','MouseEvent','localStorage'])globalThis[name]=dom.window[name]
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};globalThis.IS_REACT_ACT_ENVIRONMENT=true
 globalThis.__workspaceCalendarNow=()=>CALENDAR_NOW
 globalThis.__workspaceCalendarDate=class extends Date {constructor(...args){super(...(args.length?args:[globalThis.__workspaceCalendarNow()]))}static now(){return globalThis.__workspaceCalendarNow()}}
 env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:await readFile('firestore.rules','utf8')}})
 // Server-only audit reads must not depend on the page client's active watch
 // stream. The real pages keep their original Web SDK, listeners and rules.
 auditApp=initializeAuditApp({projectId:'crystocraft-rbac-test'},'workspace-audit')
 auditDb=getAuditFirestore(auditApp)
 db=env.authenticatedContext('sync_admin').firestore();globalThis.__workspaceSyncDb=db
 globalThis.__workspaceSyncDbSetters=new Set()
 await mkdir(resolve('qa/out'),{recursive:true})
 scratch=await mkdtemp(resolve('qa/out/workspace-sync-'))
 await build({entryPoints:['src/pages/Dashboard.jsx','src/pages/CustomerDetail.jsx'],outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,banner:{js:'const Date=globalThis.__workspaceCalendarDate;'},jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom','lucide-react','firebase/firestore','firebase/storage'],plugins:[await workspaceSyncPlugin()]})
 Dashboard=(await import(pathToFileURL(join(scratch,'Dashboard.mjs')))).default;CustomerDetail=(await import(pathToFileURL(join(scratch,'CustomerDetail.mjs')))).default
})
after(async()=>{await auditDb?.terminate();if(auditApp)await deleteAuditApp(auditApp);await env?.cleanup();if(scratch)await rm(scratch,{recursive:true,force:true});dom?.window.close();delete globalThis.__workspaceSyncDb;delete globalThis.__workspaceSyncDbSetters;delete globalThis.__workspaceCalendarDate;delete globalThis.__workspaceCalendarNow})
async function eventually(check,label){
 let last;const until=Date.now()+10000
 while(Date.now()<until){try{let result;await act(async()=>{await delay(25);result=check()});if(result)return}catch(e){last=e}}
 throw Error(`${label}${last?' — '+last.message:''}`)
}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text)
const workspace=(host,id=C)=>host.querySelector(`section[aria-label="Summary and to-do for ${id}"]`)
const selectControl=(host,text)=>{const label=[...host.querySelectorAll('label')].find(l=>l.textContent.startsWith(text));return label.querySelector('select')||host.querySelector('#'+label.htmlFor)}
const row=(host,text)=>[...host.querySelectorAll('li')].find(li=>li.textContent.includes(text))
async function click(host,text){const b=button(host,text);assert.ok(b,`Missing button ${text}`);await act(async()=>b.click())}
async function fill(el,value){assert.ok(el);await act(async()=>{el.value=value;Simulate.change(el,{target:{value}})})}
async function save(host){await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await eventually(()=>!host.isConnected||!host.querySelector('form')||host.querySelector('[role="alert"]'),'Save must finish')}
async function choose(host,id){if(workspace(host,id))return;if(host.querySelector('dialog'))await click(host,'Close customer details');await click(host,'Browse all B2B');await fill(host.querySelector('dialog select'),id);await eventually(()=>workspace(host,id),'Chosen customer dialog loads')}
function CustomerNavigation({id}) {
 const navigate=useNavigate()
 React.useEffect(()=>{navigate(`/customers/${id}`,{replace:true})},[id,navigate])
 return null
}
async function fixture(t,{withLegacy=false,withCategories=false}={}){
 const step=stepFor(t)
 // Reset the client as well as the server. clearFirestore() does not reset a
 // surviving Web SDK cache/watch stream. Both real page bundles receive this
 // same fresh SDK instance; remounts inside a case still share it unchanged.
 await step('terminate previous page client',()=>db.terminate())
 await step('clear Firestore',()=>env.clearFirestore());localStorage.clear()
 db=env.authenticatedContext('sync_admin').firestore();globalThis.__workspaceSyncDb=db
 for(const setDb of globalThis.__workspaceSyncDbSetters)setDb(db)
 await step('seed base records',()=>env.withSecurityRulesDisabled(async ctx=>{
  const admin=ctx.firestore();await setDoc(doc(admin,'users/sync_admin'),{role:'admin'})
  for(const id of [C,OTHER])await setDoc(doc(admin,'customers',id),{company_name:id,contacts:[],tags:[],channels:[],...(withCategories?{crm_category:id===C?'Distributor':'Gift / OEM'}:{})})
  await setDoc(doc(admin,'dashboard_cache/weekly_summary'),{items:[{customerId:C,digest:'Current saved summary'},{customerId:OTHER,digest:'Other customer summary'}]})
  if(withLegacy)await setDoc(doc(admin,'customers',C,'enquiries/legacy'),legacy)
 }))
 const hosts=[document.createElement('div'),document.createElement('div')];hosts.forEach(h=>document.body.append(h));let roots=hosts.map(h=>createRoot(h))
 const render=async(index,id=C)=>{await act(async()=>roots[index].render(React.createElement(MemoryRouter,{initialEntries:[index?`/customers/${id}`:'/dashboard']},index?React.createElement(React.Fragment,null,React.createElement(CustomerNavigation,{id}),React.createElement(Routes,null,React.createElement(Route,{path:'/customers/:id',element:React.createElement(CustomerDetail)}))):React.createElement(Dashboard))));await eventually(()=>index?workspace(hosts[index],id):button(hosts[index],'Browse all B2B'),'Actual page loads')}
 let closed=false
 const close=async()=>{if(closed)return;closed=true;await step('unmount pages',async()=>{for(const r of roots)await act(async()=>r.unmount());hosts.forEach(h=>h.remove())})}
 t.after(close)
 await step('render Dashboard',()=>render(0));await step('choose customer',()=>choose(hosts[0],C));await step('render CustomerDetail',()=>render(1))
 return {dash:hosts[0],customer:hosts[1],d:()=>workspace(hosts[0]),c:()=>workspace(hosts[1]),render,close,remount:async(index,id=C)=>{await act(async()=>roots[index].unmount());roots[index]=createRoot(hosts[index]);await render(index,id);if(!index)await choose(hosts[index],id)}}
}
async function create(w,kind,text,{date,state}={}){await click(w,kind==='task'?'Add task':'Add note');await fill(w.querySelector('textarea'),text);if(date!==undefined)await fill(w.querySelector('input[type=date]'),date);if(state)await fill(w.querySelector('form select'),state);await save(w)}
async function edit(w,text,next,{date,state}={}){await click(row(w,text),'Edit');await fill(w.querySelector('textarea'),next);if(date!==undefined)await fill(w.querySelector('input[type=date]'),date);if(state)await fill(w.querySelector('form select'),state);await save(w)}
for(const fromDashboard of [true,false])test(`real pages create task and note from ${fromDashboard?'Dashboard':'customer'} and sync without remount`,async t=>{
 const v=await fixture(t),source=fromDashboard?v.d:v.c,target=fromDashboard?v.c:v.d
 for(const kind of ['task','note']){await create(source(),kind,`New ${kind}`);await eventually(()=>row(target(),`New ${kind}`),`${kind} reaches other live page`)}
 const docs=await getDocs(collection(db,'customers',C,'work_items'));assert.equal(docs.size,2);assert.equal((await getDocs(collection(db,'customers',OTHER,'work_items'))).size,0)
 for(const snap of docs.docs){assert.equal(snap.data().revision,1);assert.equal(snap.data().created_by,'sync_admin')}
 await v.remount(0);await v.remount(1);for(const w of [v.d(),v.c()]){assert.ok(row(w,'New task'));assert.ok(row(w,'New note'))}
})
test('text, due date, Waiting/To do and notes sync in both directions without losing authorship',async t=>{
 const v=await fixture(t);await create(v.d(),'task','Task original');await create(v.d(),'note','Note original');await eventually(()=>row(v.c(),'Note original'),'Create visible')
 await edit(v.c(),'Task original','Task customer',{date:'2026-10-20',state:'waiting'});await edit(v.c(),'Note original','Note customer')
 await eventually(()=>row(v.d(),'Task customer')?.textContent.includes('Waiting · 2026-10-20')&&row(v.d(),'Note customer'),'Customer edits reach Dashboard')
 await edit(v.d(),'Task customer','Task dashboard',{date:'2026-10-21',state:'todo'});await edit(v.d(),'Note customer','Note dashboard')
 await eventually(()=>row(v.c(),'Task dashboard')?.textContent.includes('To do · 2026-10-21')&&row(v.c(),'Note dashboard'),'Dashboard edits reach customer')
 for(const snap of (await getDocs(collection(db,'customers',C,'work_items'))).docs){assert.equal(snap.data().revision,3);assert.equal(snap.data().created_by,'sync_admin');assert.equal(snap.data().updated_by,'sync_admin')}
})
for(const fromDashboard of [true,false])test(`complete/archive from ${fromDashboard?'Dashboard':'customer'}, reopen on other page, preserve after remount`,async t=>{
 const v=await fixture(t),source=fromDashboard?v.d:v.c,target=fromDashboard?v.c:v.d
 await create(source(),'task','Complete task');await create(source(),'note','Archive note');await eventually(()=>row(target(),'Archive note'),'Both created')
 for(const [text,action]of [['Complete task','Done'],['Archive note','Archive']]){await click(row(source(),text),action);await eventually(()=>!row(target(),text),`${action} removes other outstanding row`)}
 for(const get of [source,target]){assert.match(get().textContent,/No outstanding/);await click(get(),'Show completed / archived (2)')}
 for(const text of ['Complete task','Archive note']){await click(row(target(),text),'Reopen');await eventually(()=>button(row(source(),text),text==='Complete task'?'Done':'Archive'),'Reopen sync')}
 await v.remount(0);await v.remount(1);for(const w of [v.d(),v.c()]){assert.ok(button(row(w,'Complete task'),'Done'));assert.ok(button(row(w,'Archive note'),'Archive'))}
 assert.equal((await getDocs(collection(db,'customers',C,'work_items'))).size,2)
})
test('an editor opened before the other page saves cannot overwrite newer content; draft remains',async t=>{
 const v=await fixture(t);await create(v.d(),'task','Original');await eventually(()=>row(v.c(),'Original'),'Task visible')
 await click(row(v.d(),'Original'),'Edit');await fill(v.d().querySelector('textarea'),'Stale local draft')
 await edit(v.c(),'Original','Newer customer edit',{date:'2026-10-22',state:'waiting'});await eventually(()=>row(v.d(),'Newer customer edit'),'Snapshot updated while editor open')
 await save(v.d());assert.match(v.d().querySelector('[role=alert]').textContent,/changed/);assert.equal(v.d().querySelector('textarea').value,'Stale local draft')
 const saved=(await getDocs(collection(db,'customers',C,'work_items'))).docs[0].data();assert.equal(saved.text,'Newer customer edit');assert.equal(saved.revision,2)
 await click(v.d(),'Cancel');assert.ok(row(v.d(),'Newer customer edit'))
})
test('legacy follow-ups sync without changing original conversation, attachments, status or date',async t=>{
 const v=await fixture(t,{withLegacy:true});await eventually(()=>row(v.d(),'Original conversation')&&row(v.c(),'Original conversation'),'Legacy available on both')
 await edit(v.c(),'Original conversation','Revised follow-up',{date:'2026-10-23',state:'waiting'});await eventually(()=>row(v.d(),'Revised follow-up')?.textContent.includes('2026-10-23'),'Legacy edit sync')
 await click(row(v.d(),'Revised follow-up'),'Done');await eventually(()=>!row(v.c(),'Revised follow-up'),'Legacy completion sync')
 const saved=(await getDoc(doc(db,'customers',C,'enquiries/legacy'))).data();for(const field of ['description','attachments','status','date','follow_up_date'])assert.deepEqual(saved[field],legacy[field]);assert.equal(saved.todo_status,'done');assert.equal(saved.todo_revision,2)
 assert.equal((await getDocs(collection(db,'customers',C,'work_items'))).size,0)
})
test('changing the customer route never shows or writes another customer workspace',async t=>{
 const v=await fixture(t);await create(v.d(),'note','Only first customer');await v.render(1,OTHER)
 const second=workspace(v.customer,OTHER);assert.ok(second);assert.ok(!second.textContent.includes('Only first customer'))
 await create(second,'note','Only second customer');assert.ok(!v.d().textContent.includes('Only second customer'));await choose(v.dash,OTHER);assert.match(workspace(v.dash,OTHER).textContent,/Only second customer/);await choose(v.dash,C);
 assert.ok(!v.d().textContent.includes('Only second customer'));await v.render(1,C);assert.ok(!v.c().textContent.includes('Only second customer'))
 assert.equal((await getDocs(collection(db,'customers',OTHER,'work_items'))).size,1)
})
test('anonymous and customer portal identities cannot read or change internal task/note records',async t=>{
 const v=await fixture(t);await create(v.d(),'note','Internal note');const snap=(await getDocs(collection(db,'customers',C,'work_items'))).docs[0]
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'users/sync_portal'),{role:'customer',status:'approved',customer_id:C}))
 for(const unsafe of [env.unauthenticatedContext().firestore(),env.authenticatedContext('sync_portal').firestore()]){await assertFails(getDoc(doc(unsafe,snap.ref.path)));await assertFails(setDoc(doc(unsafe,snap.ref.path),{...snap.data(),text:'Overwritten'}))}
 assert.equal((await getDoc(snap.ref)).data().text,'Internal note')
})


// Read the real tile and drilldown, never a copied implementation of its count.
const dueCard=host=>host.querySelector('[data-task-filter=due]')
const dueCount=host=>Number(dueCard(host)?.dataset.count)
const duePanel=host=>host.querySelector('[aria-label="Follow-ups due"]')
const PAST='2000-01-01',FUTURE='2099-01-01'
function hkToday(){return new Date(globalThis.__workspaceCalendarNow()+8*3600000).toISOString().slice(0,10)}
async function expectDue(v,n){await eventually(()=>dueCount(v.dash)===n,`Follow-ups Due should be ${n}, saw ${dueCount(v.dash)}`)}
async function mirrored(v,text,{date,state}={}){
 await eventually(()=>[v.d(),v.c()].every(w=>{
  const item=row(w,text);if(!item)return false
  if(date!==undefined&&(date?!item.textContent.includes(date):/\d{4}-\d{2}-\d{2}/.test(item.textContent)))return false
  return !state||item.textContent.includes(state)
 }),`Both pages must show current ${text}`)
}
for(const fromDashboard of [true,false])test(`Follow-ups Due tracks the full task lifecycle from ${fromDashboard?'Dashboard':'customer page'}`,async t=>{
 const v=await fixture(t),source=fromDashboard?v.d:v.c,other=fromDashboard?v.c:v.d,today=hkToday()
 if(process.env.WORKSPACE_EXPECT_TODAY)assert.equal(today,process.env.WORKSPACE_EXPECT_TODAY,'Same instant must use the Hong Kong business date')
 await expectDue(v,0)
 await create(source(),'task','Counted task',{date:PAST});await mirrored(v,'Counted task',{date:PAST});await expectDue(v,1)
 await create(source(),'note','Uncounted note');await mirrored(v,'Uncounted note');await expectDue(v,1)
 for(const [date,n]of [[today,1],[PAST,1],[FUTURE,0],['',0],[PAST,1]]){
  await edit(source(),'Counted task','Counted task',{date});await mirrored(v,'Counted task',{date});await expectDue(v,n)
 }
 await edit(source(),'Counted task','Counted task',{state:'waiting'});await mirrored(v,'Counted task',{state:'Waiting'});await expectDue(v,1)
 await click(row(source(),'Counted task'),'Done');await eventually(()=>!row(v.d(),'Counted task')&&!row(v.c(),'Counted task'),'Completed task hidden in both');await expectDue(v,0)
 await click(other(),'Show completed / archived (1)');await click(row(other(),'Counted task'),'Reopen');await mirrored(v,'Counted task',{date:PAST,state:'To do'});await expectDue(v,1)
 // Reopening a future-dated task must not add it back to the overdue total.
 await edit(source(),'Counted task','Counted task',{date:FUTURE});await mirrored(v,'Counted task',{date:FUTURE});await expectDue(v,0)
 await click(row(source(),'Counted task'),'Done');await eventually(()=>!!button(row(other(),'Counted task'),'Reopen'),'Future task completed')
 await click(row(other(),'Counted task'),'Reopen');await mirrored(v,'Counted task',{date:FUTURE,state:'To do'});await expectDue(v,0)
 await v.remount(0);await expectDue(v,0)
})
for(const fromDashboard of [true,false])test(`Follow-ups Due combines native and old interaction tasks when changed from ${fromDashboard?'Dashboard':'customer page'}`,async t=>{
 const v=await fixture(t,{withLegacy:true}),source=fromDashboard?v.d:v.c,other=fromDashboard?v.c:v.d
 await mirrored(v,'Original conversation');await expectDue(v,1)
 await create(source(),'task','Separate task same customer',{date:PAST});await mirrored(v,'Separate task same customer',{date:PAST});await expectDue(v,2)
 await click(row(source(),'Original conversation'),'Done');await eventually(()=>!row(v.d(),'Original conversation')&&!row(v.c(),'Original conversation'),'Legacy completed in both');await expectDue(v,1)
 await click(other(),'Show completed / archived (1)');await click(row(other(),'Original conversation'),'Reopen');await mirrored(v,'Original conversation',{state:'To do'});await expectDue(v,2)
 for(const date of [hkToday(),FUTURE,'']){await edit(source(),'Original conversation','Original conversation',{date});await mirrored(v,'Original conversation',{date});await expectDue(v,date===hkToday()?2:1)}
 await edit(source(),'Original conversation','Original conversation',{date:PAST});await mirrored(v,'Original conversation',{date:PAST});await expectDue(v,2)
 await v.remount(0);await expectDue(v,2)
 const saved=(await getDoc(doc(db,'customers',C,'enquiries/legacy'))).data();for(const field of ['description','date','follow_up_date','attachments','status'])assert.deepEqual(saved[field],legacy[field])
 assert.equal((await getDocs(collection(db,'customers',C,'work_items'))).size,1,'No duplicate carried follow-up was created')
})
test('Follow-ups Due tile and already-open drilldown stay in agreement during edits on either page',async t=>{
 const v=await fixture(t);await create(v.c(),'task','First overdue',{date:PAST});await mirrored(v,'First overdue',{date:PAST});await expectDue(v,1)
 await act(async()=>dueCard(v.dash).click())
 async function panelCount(n,text){await eventually(()=>dueCount(v.dash)===n&&duePanel(v.dash)?.querySelectorAll('li').length===n&&(!text||duePanel(v.dash).textContent.includes(text)),`Tile and drilldown should both contain ${n} due tasks`)}
 await panelCount(1,'First overdue')
 // The same task moves between groups without changing the total, from either page.
 const group=label=>duePanel(v.dash)?.querySelector(`[aria-label="${label} tasks"]`)
 async function grouped(overdue,today){await eventually(()=>group('Overdue')?.querySelectorAll('li').length===overdue&&group('Today')?.querySelectorAll('li').length===today&&duePanel(v.dash).textContent.includes(`${overdue} overdue · ${today} today`),'Tile breakdown and separate task groups agree')}
 await grouped(1,0)
 await edit(v.c(),'First overdue','First overdue',{date:hkToday()});await panelCount(1);await grouped(0,1)
 await edit(v.d(),'First overdue','First overdue',{date:PAST});await panelCount(1);await grouped(1,0)
 await create(v.c(),'task','Due today',{date:hkToday(),state:'waiting'});await panelCount(2,'Due today');await grouped(1,1)
 await click(row(v.d(),'Due today'),'Done');await panelCount(1);await grouped(1,0)
 await click(v.c(),'Show completed / archived (1)');await click(row(v.c(),'Due today'),'Reopen');await panelCount(2);await grouped(1,1)
 await edit(v.c(),'Due today','Due today',{date:FUTURE});await panelCount(1);await grouped(1,0)
 await create(v.c(),'task','Future then overdue',{date:FUTURE});await eventually(()=>row(v.c(),'Future then overdue'),'Future saved');await panelCount(1)
 await edit(v.c(),'Future then overdue','Future then overdue',{date:PAST});await panelCount(2,'Future then overdue')
 await click(row(v.d(),'First overdue'),'Done');await panelCount(1,'Future then overdue');await eventually(()=>!!button(row(v.c(),'First overdue'),'Reopen'),'Dashboard completion reaches customer')
 await edit(v.c(),'Future then overdue','Future then overdue',{date:FUTURE});await panelCount(0);assert.match(duePanel(v.dash).textContent,/0 overdue/)
 await click(row(v.c(),'First overdue'),'Reopen');await panelCount(1,'First overdue')
 await edit(v.d(),'First overdue','First overdue',{date:FUTURE});await panelCount(0)
 await click(v.dash,'Show all open tasks');await mirrored(v,'First overdue',{date:FUTURE});await expectDue(v,0)
})
test('Follow-ups Due B2B counts obey category/search filters and remain independent of summary period',async t=>{
 const v=await fixture(t,{withCategories:true})
 await create(v.d(),'task','First C task',{date:PAST});await create(v.d(),'task','Second C task',{date:hkToday(),state:'waiting'});await mirrored(v,'Second C task',{date:hkToday()});await expectDue(v,2)
 await v.render(1,OTHER);const other=()=>workspace(v.customer,OTHER)
 await create(other(),'task','Other customer task',{date:PAST});await expectDue(v,3)
 await create(other(),'task','Already completed',{date:PAST,state:'done'});await expectDue(v,3)
 await env.withSecurityRulesDisabled(async ctx=>{const d=ctx.firestore();await setDoc(doc(d,'customers','sync_retail'),{company_name:'Individual B2C',customer_type:'retail'});await setDoc(doc(d,'customers','sync_retail','work_items','retail_task'),{kind:'task',text:'Retail task',due_on:PAST,state:'todo',revision:1,created_by:'sync_admin',updated_by:'sync_admin'});await setDoc(doc(d,'customers',C,'work_items/dated_note'),{kind:'note',text:'Dated reference note',due_on:PAST,state:'todo',revision:1,created_by:'sync_admin',updated_by:'sync_admin'})})
 await eventually(()=>row(v.d(),'Dated reference note'),'Dated note delivered');await expectDue(v,3)
 const category=selectControl(v.dash,'Category')
 await fill(category,'Distributor');await expectDue(v,2);await fill(category,'Gift / OEM');await expectDue(v,1);await fill(category,'');await expectDue(v,3)
 const period=[...v.dash.querySelectorAll('label')].find(l=>l.textContent.startsWith('Summary context')).querySelector('select')
 for(const days of ['14','90','30']){await fill(period,days);await expectDue(v,3)}
 await act(async()=>dueCard(v.dash).click());await eventually(()=>duePanel(v.dash)?.querySelectorAll('li').length===3,'Due view contains all B2B tasks')
 assert.doesNotMatch(duePanel(v.dash).textContent,/Dated reference note|Already completed|Retail task/)
 await fill(category,'Distributor');await expectDue(v,2)
 await edit(other(),'Other customer task','Other rescheduled',{date:FUTURE});await expectDue(v,2)
 await click(v.dash,'Clear filters');await expectDue(v,2)
})

for(const wake of ['midnight','focus','pageshow','visibilitychange','watchdog'])test(`Follow-ups Due rolls forward without remount or writes on ${wake}`,async t=>{
 const clock=calendarClock(Date.parse('2026-10-17T15:59:59Z')),restore=clock.installOn(window)
 globalThis.__workspaceCalendarNow=clock.now
 const v=await fixture(t,{withLegacy:true,withCategories:true})
 t.after(()=>{assert.equal(clock.pending(),0,'Page unmount releases all calendar timers');restore();globalThis.__workspaceCalendarNow=()=>CALENDAR_NOW})
 await edit(v.c(),'Original conversation','Original conversation',{date:'2026-10-17'})
 await create(v.c(),'task','Today becomes overdue',{date:'2026-10-17',state:'waiting'})
 await create(v.c(),'task','Tomorrow becomes today',{date:'2026-10-18',state:'waiting'})
 await create(v.c(),'task','Undated stays excluded')
 await create(v.c(),'task','Future stays excluded',{date:'2026-10-20'})
 await create(v.c(),'task','Completed stays excluded',{date:'2026-10-17',state:'done'})
 await create(v.c(),'note','Reference stays excluded')
 await expectDue(v,2);await fill(selectControl(v.dash,'Category'),'Distributor')
 const period=[...v.dash.querySelectorAll('label')].find(l=>l.textContent.startsWith('Summary context')).querySelector('select')
 await fill(period,'90');await act(async()=>dueCard(v.dash).click())
 const panel=duePanel(v.dash),group=label=>panel.querySelector(`[aria-label="${label} tasks"]`)
 await eventually(()=>group('Today')?.querySelectorAll('li').length===2,'Initial Today group')
 const mountedCustomer=v.c()
 await click(row(v.c(),'Today becomes overdue'),'Edit');await fill(v.c().querySelector('textarea'),'Unsaved reference draft')
 const before=await getDocs(collection(db,'customers',C,'work_items')),legacyBefore=(await getDoc(doc(db,'customers',C,'enquiries/legacy'))).data()
 if(wake==='midnight')await act(async()=>clock.advance(1000))
 else {
  clock.setTime(Date.parse('2026-10-18T01:00:00Z')) // sleep/system change: no timer has fired
  assert.equal(dueCount(v.dash),2)
  await act(async()=>{
   if(wake==='watchdog')clock.fireIntervals()
   else if(wake==='visibilitychange'){
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'})
    document.dispatchEvent(new window.Event('visibilitychange'));assert.equal(dueCount(v.dash),2)
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
    document.dispatchEvent(new window.Event('visibilitychange'))
   }else window.dispatchEvent(new window.Event(wake))
  })
 }
 await expectDue(v,3)
 await eventually(()=>group('Overdue')?.querySelectorAll('li').length===2&&group('Today')?.querySelectorAll('li').length===1,'Midnight updates the already-open groups')
 assert.equal(duePanel(v.dash),panel,'Dashboard panel was not remounted')
 assert.equal(v.c(),mountedCustomer,'Customer workspace was not remounted')
 assert.match(group('Overdue').textContent,/Today becomes overdue/);assert.match(group('Overdue').textContent,/Original conversation/)
 assert.match(group('Today').textContent,/Tomorrow becomes today/)
 assert.match(row(v.c(),'Today becomes overdue').textContent,/Waiting · Overdue · 2026-10-17/)
 assert.match(row(v.c(),'Tomorrow becomes today').textContent,/Today · 2026-10-18/)
 const order=[...v.c().querySelectorAll('li')].map(el=>el.textContent)
 assert.ok(order.findIndex(text=>text.includes('Tomorrow becomes today'))<order.findIndex(text=>text.includes('Undated stays excluded')),'Customer tasks re-sort at midnight')
 assert.equal(v.c().querySelector('textarea').value,'Unsaved reference draft','Calendar updates preserve unsaved edits')
 assert.equal(period.value,'90');assert.ok(button(v.dash,'Clear filters'),'Customer filter preserved')
 assert.ok(duePanel(v.dash).textContent.includes('2 overdue · 1 today'))
 assert.ok(!panel.textContent.includes('Future stays excluded'));assert.ok(!panel.textContent.includes('Completed stays excluded'));assert.ok(!panel.textContent.includes('Reference stays excluded'))
 const after=await getDocs(collection(db,'customers',C,'work_items'))
 assert.deepEqual(after.docs.map(d=>[d.id,d.data()]),before.docs.map(d=>[d.id,d.data()]),'Calendar change does not write task data')
 assert.deepEqual((await getDoc(doc(db,'customers',C,'enquiries/legacy'))).data(),legacyBefore,'Carried interaction unchanged')
 await click(v.c(),'Cancel')
})

test(SUMMARY_CASE,{timeout:45000},async t=>{
 const step=stepFor(t),v=await fixture(t)
 await step('seed long-period caches',()=>env.withSecurityRulesDisabled(async ctx=>{for(const days of [180,365])await setDoc(doc(ctx.firestore(),'dashboard_cache','customer_summary_'+days),{lookbackDays:days,items:[{customerId:C,digest:'Saved '+days+' day customer context'}]})}))
 for(const [host,label] of [[v.dash,'Summary context'],[v.customer,'Summary period']]){
  const select=[...host.querySelectorAll('label')].find(l=>l.textContent.includes(label)).querySelector('select')
  assert.deepEqual([...select.options].map(o=>o.value),['14','30','90','180','365'])
  for(const days of [180,365]){await step(`select ${label} ${days}`,()=>fill(select,String(days)));await step(`wait for ${label} ${days}`,()=>eventually(()=>(host===v.dash?host.querySelector('dialog'):workspace(host)).textContent.includes('Saved '+days+' day customer context'),'Selected long-period saved summary appears'))}
 }
 assert.equal((await step('read original cache',()=>auditDb.doc('dashboard_cache/weekly_summary').get())).data().items[0].digest,'Current saved summary')
})

test('real summary-status hook retains failure on Dashboard remount without AI or cache writes',async t=>{
 const v=await fixture(t),cache=doc(db,'dashboard_cache/weekly_summary')
 const before=(await getDoc(cache)).data()
 await click(v.dash,'Update AI summaries')
 await eventually(()=>v.dash.querySelector('[role="alert"]')?.textContent.includes('AI generation is disabled in the workspace sync fixture'),'Real update store reports the blocked AI boundary')
 assert.equal(button(v.dash,'Update AI summaries').disabled,false)
 await v.remount(0)
 assert.match(v.dash.querySelector('[role="alert"]').textContent,/AI generation is disabled in the workspace sync fixture/)
 assert.equal(button(v.dash,'Update AI summaries').disabled,false)
 assert.deepEqual((await getDoc(cache)).data(),before)
})

test('Follow-ups Due fixtures isolate client caches and keep both real pages connected after reset',async t=>{
 const first=await fixture(t)
 await create(first.d(),'task','Previous case task',{date:PAST});await mirrored(first,'Previous case task',{date:PAST});await expectDue(first,1)
 const oldDb=db,previous=(await getDocs(collection(db,'customers',C,'work_items'))).docs[0]
 assert.equal((await getDocFromCache(previous.ref)).data().text,'Previous case task','First fixture really populated the SDK cache')
 await first.close()
 const next=await fixture(t)
 assert.notEqual(db,oldDb,'A server reset must also replace the page client')
 await assert.rejects(getDocFromCache(doc(db,previous.ref.path)),{code:'unavailable'},'Fresh client must not retain the prior task in its cache')
 assert.equal((await auditDb.doc(previous.ref.path).get()).exists,false,'Server reset removed the prior task')
 for(const w of [next.d(),next.c()])assert.ok(!row(w,'Previous case task'))
 await expectDue(next,0)
 await create(next.c(),'task','Current case task',{date:hkToday(),state:'waiting'});await mirrored(next,'Current case task',{date:hkToday(),state:'Waiting'});await expectDue(next,1)
 await next.remount(0);await next.remount(1);await mirrored(next,'Current case task',{date:hkToday(),state:'Waiting'});await expectDue(next,1)
 assert.equal((await getDocs(collection(db,'customers',C,'work_items'))).size,1)
})
