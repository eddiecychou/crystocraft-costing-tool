// Real Dashboard + CustomerDetail, real listeners/transactions/rules, fictional
// data on a loopback emulator only. No .env, service account, or network API.
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
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
import {doc,getDoc,getDocs,collection,setDoc,Timestamp} from 'firebase/firestore'
import {workspaceSyncPlugin} from './customer-workspace-sync-fixture.mjs'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore emulator required; live fixture writes forbidden.')
let env,db,Dashboard,CustomerDetail,scratch,dom
const C='sync_customer',OTHER='sync_other',legacy={description:'Original conversation',status:'Quoted',date:Timestamp.fromMillis(1000),follow_up_date:Timestamp.fromMillis(2000),attachments:[{name:'original.pdf'}]}
before(async()=>{
 dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost'});for(const name of ['window','document','HTMLElement','Event','MouseEvent','localStorage'])globalThis[name]=dom.window[name]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 env=await initializeTestEnvironment({projectId:'crystocraft-rbac-test',firestore:{rules:await readFile('firestore.rules','utf8')}})
 db=env.authenticatedContext('sync_admin').firestore();globalThis.__workspaceSyncDb=db
 scratch=await mkdtemp(resolve('.qa-workspace-sync-'))
 await build({entryPoints:['src/pages/Dashboard.jsx','src/pages/CustomerDetail.jsx'],outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom','lucide-react','firebase/firestore','firebase/storage'],plugins:[await workspaceSyncPlugin()]})
 Dashboard=(await import(pathToFileURL(join(scratch,'Dashboard.mjs')))).default;CustomerDetail=(await import(pathToFileURL(join(scratch,'CustomerDetail.mjs')))).default
})
after(async()=>{await env?.cleanup();if(scratch)await rm(scratch,{recursive:true,force:true});dom?.window.close();delete globalThis.__workspaceSyncDb})
async function eventually(check,label){
 let last;const until=Date.now()+10000
 while(Date.now()<until){try{let result;await act(async()=>{await delay(25);result=check()});if(result)return}catch(e){last=e}}
 throw Error(`${label}${last?' — '+last.message:''}`)
}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const workspace=(host,id=C)=>host.querySelector(`section[aria-label="Summary and to-do for ${id}"]`)
const row=(host,text)=>[...host.querySelectorAll('li')].find(li=>li.textContent.includes(text))
async function click(host,text){const b=button(host,text);assert.ok(b,`Missing button ${text}`);await act(async()=>b.click())}
async function fill(el,value){assert.ok(el);await act(async()=>{el.value=value;Simulate.change(el,{target:{value}})})}
async function save(host){await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await eventually(()=>!host.querySelector('form')||host.querySelector('[role="alert"]'),'Save must finish')}
async function choose(host,id){const select=[...host.querySelectorAll('label')].find(l=>l.textContent.includes('Find a customer')).querySelector('select');await fill(select,id)}
function CustomerNavigation({id}) {
 const navigate=useNavigate()
 React.useEffect(()=>{navigate(`/customers/${id}`,{replace:true})},[id,navigate])
 return null
}
async function fixture(t,{withLegacy=false}={}){
 await env.clearFirestore();localStorage.clear()
 await env.withSecurityRulesDisabled(async ctx=>{
  const admin=ctx.firestore();await setDoc(doc(admin,'users/sync_admin'),{role:'admin'})
  for(const id of [C,OTHER])await setDoc(doc(admin,'customers',id),{company_name:id,contacts:[],tags:[],channels:[]})
  await setDoc(doc(admin,'dashboard_cache/weekly_summary'),{items:[{customerId:C,digest:'Current saved summary'},{customerId:OTHER,digest:'Other customer summary'}]})
  if(withLegacy)await setDoc(doc(admin,'customers',C,'enquiries/legacy'),legacy)
 })
 const hosts=[document.createElement('div'),document.createElement('div')];hosts.forEach(h=>document.body.append(h));let roots=hosts.map(h=>createRoot(h))
 const render=async(index,id=C)=>{await act(async()=>roots[index].render(React.createElement(MemoryRouter,{initialEntries:[index?`/customers/${id}`:'/dashboard']},index?React.createElement(React.Fragment,null,React.createElement(CustomerNavigation,{id}),React.createElement(Routes,null,React.createElement(Route,{path:'/customers/:id',element:React.createElement(CustomerDetail)}))):React.createElement(Dashboard))));await eventually(()=>workspace(hosts[index],id),'Actual page workspace loads')}
 t.after(async()=>{for(const r of roots)await act(async()=>r.unmount());hosts.forEach(h=>h.remove())})
 await render(0);await choose(hosts[0],C);await render(1)
 return {dash:hosts[0],customer:hosts[1],d:()=>workspace(hosts[0]),c:()=>workspace(hosts[1]),render,remount:async(index,id=C)=>{await act(async()=>roots[index].unmount());roots[index]=createRoot(hosts[index]);await render(index,id);if(!index)await choose(hosts[index],id)}}
}
async function create(w,kind,text){await click(w,kind==='task'?'Add task':'Add note');await fill(w.querySelector('textarea'),text);await save(w)}
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
 await create(second,'note','Only second customer');await eventually(()=>workspace(v.dash,OTHER)?.textContent.includes('Only second customer'),'Other customer appears in its own Dashboard card')
 assert.ok(!v.d().textContent.includes('Only second customer'));await v.render(1,C);assert.ok(!v.c().textContent.includes('Only second customer'))
 assert.equal((await getDocs(collection(db,'customers',OTHER,'work_items'))).size,1)
})
test('anonymous and customer portal identities cannot read or change internal task/note records',async t=>{
 const v=await fixture(t);await create(v.d(),'note','Internal note');const snap=(await getDocs(collection(db,'customers',C,'work_items'))).docs[0]
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'users/sync_portal'),{role:'customer',status:'approved',customer_id:C}))
 for(const unsafe of [env.unauthenticatedContext().firestore(),env.authenticatedContext('sync_portal').firestore()]){await assertFails(getDoc(doc(unsafe,snap.ref.path)));await assertFails(setDoc(doc(unsafe,snap.ref.path),{...snap.data(),text:'Overwritten'}))}
 assert.equal((await getDoc(snap.ref)).data().text,'Internal note')
})
