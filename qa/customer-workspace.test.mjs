import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { cleanWorkItem, legacyWorkItems, combineWorkItems, sortWorkItems, dateOnly, assertRevision } from '../src/customerWorkItems.js'
let scratch, Workspace, api, dom
before(async () => {
  scratch = await mkdtemp(resolve('node_modules/.customer-workspace-'))
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost/'})
  for (const k of ['window','document','HTMLElement','Event','MouseEvent']) globalThis[k] = dom.window[k]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await build({entryPoints:{workspace:'src/components/CustomerWorkspace.jsx', api:'src/domain/customerWorkItems.js'},outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom'],plugins:[{name:'isolated-data',setup(b){
    b.onResolve({filter:/firebase\/firestore$/},()=>({path:'firestore',namespace:'mock'}))
    b.onResolve({filter:/\/firebase$|^\.\.\/firebase$/},()=>({path:'firebase',namespace:'mock'}))
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path==='firebase'?`export const db={};export const authedUser=async()=>({uid:'admin'});`:`
    export const collectionGroup=(...a)=>a.slice(1).join('/');export const collection=(...a)=>a.slice(1).join('/');export const doc=(...a)=>a.slice(1).join('/');
    export const serverTimestamp=()=> 'SERVER_TIME';export const onSnapshot=()=>()=>{};
    export const runTransaction=async(db,fn)=>fn({get:async(path)=>({exists:()=>!!globalThis.__workDb[path],data:()=>globalThis.__workDb[path]}),set:(path,value)=>{globalThis.__workDb[path]=value},update:(path,value)=>{globalThis.__workDb[path]={...globalThis.__workDb[path],...value}}});`}))
  }}]})
  Workspace=(await import(pathToFileURL(join(scratch,'workspace.mjs')))).default
  api=await import(pathToFileURL(join(scratch,'api.mjs')))
})
after(async()=>{dom.window.close();await rm(scratch,{recursive:true,force:true});delete globalThis.__workDb})
const legacy={id:'legacy',description:'Original quote conversation',follow_up_date:{seconds:Date.parse('2026-08-17T12:00:00Z')/1000},status:'Quoted',attachments:[{name:'quote.pdf'}]}
test('legacy carry-over is read-only, preserves every interaction and includes old follow-ups',()=>{
 const before=structuredClone(legacy);const items=legacyWorkItems([legacy,{id:'no-task',description:'History only'}]);assert.equal(items.length,1);assert.equal(items[0].text,legacy.description);assert.equal(items[0].due_on,'2026-08-17');assert.deepEqual(legacy,before)
})
test('completed and rescheduled legacy tasks retain source history and do not reappear as outstanding',()=>{
 const [item]=legacyWorkItems([{...legacy,todo_status:'done',todo_text:'Send revised quote',todo_due_on:'',todo_revision:2}]);assert.equal(item.state,'done');assert.equal(item.due_on,'');assert.equal(item.text,'Send revised quote');assert.equal(item.revision,2)
})
test('sorts overdue and today first, retains undated and waiting work independently of summary window',()=>{
 const items=[{id:'a',kind:'note',state:'todo'},{id:'b',kind:'task',state:'done',due_on:'2020-01-01'},{id:'c',kind:'task',state:'waiting'},{id:'d',kind:'task',state:'todo',due_on:'2026-10-17'},{id:'e',kind:'task',state:'todo',due_on:'2026-08-17'}];assert.deepEqual(sortWorkItems(items,'2026-10-17').map(i=>i.id),['e','d','c','a','b']);assert.equal(combineWorkItems([legacy],items).length,6)
})
test('validates text, statuses and real dates; reference notes carry no due date',()=>{
 for(const input of [{text:' '},{kind:'task',text:'a',state:'bad'},{kind:'task',text:'a',due_on:'2026-02-30'},{kind:'task',text:'a'.repeat(4001)}])assert.throws(()=>cleanWorkItem(input))
 assert.deepEqual(cleanWorkItem({kind:'note',text:' Personal reference ',due_on:'2026-10-17'}),{kind:'note',text:'Personal reference',state:'todo',due_on:''});assert.equal(dateOnly({seconds:0}),'1970-01-01')
})
test('revision check rejects missing or concurrently edited records',()=>{
 assert.throws(()=>assertRevision(null,0),/changed/);assert.throws(()=>assertRevision({revision:2},1),/changed/);assert.doesNotThrow(()=>assertRevision({revision:2},2))
})
test('real save transaction creates once on retry, updates with revision, refuses stale edits',async()=>{
 globalThis.__workDb={};const input={kind:'task',text:'Send quotation',state:'waiting',due_on:'2026-10-18'};await api.saveCustomerWorkItem('c1',null,input,'stable');await api.saveCustomerWorkItem('c1',null,input,'stable');assert.equal(Object.keys(globalThis.__workDb).length,1)
 const saved=globalThis.__workDb['customers/c1/work_items/stable'];assert.equal(saved.revision,1);await api.saveCustomerWorkItem('c1',{id:'stable',source:'work_item',revision:1},{...input,state:'done'});assert.equal(globalThis.__workDb['customers/c1/work_items/stable'].revision,2);await assert.rejects(api.saveCustomerWorkItem('c1',{id:'stable',source:'work_item',revision:1},input),/changed/)
})
test('legacy completion transaction changes only task metadata, preserving original content and dated follow-up',async()=>{
 globalThis.__workDb={'customers/c1/enquiries/legacy':structuredClone(legacy)};const item=legacyWorkItems([legacy])[0];await api.saveCustomerWorkItem('c1',item,{...item,state:'done'});const saved=globalThis.__workDb['customers/c1/enquiries/legacy'];for(const key of ['description','follow_up_date','status','attachments'])assert.deepEqual(saved[key],legacy[key]);assert.equal(saved.todo_status,'done');assert.equal(legacyWorkItems([{...saved,id:'legacy'}])[0].state,'done')
})
async function mount(fn, props={}) {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Workspace,{customerId:'c1',customerName:'QA customer',...props}))));await fn(host,root)}finally{await act(async()=>root.unmount());host.remove()}
}
function button(host,text){return [...host.querySelectorAll('button')].find(b=>b.textContent===text)}
async function fill(el,value){await act(async()=>{el.value=value;Simulate.change(el,{target:{value}})})}
for(const showLink of [false,true])test(`shared ${showLink?'dashboard':'customer'} view retains tasks through summary refresh, offers Done and preserves history`,async()=>mount(async(host,root)=>{
 assert.match(host.textContent,/Original quote conversation/);assert.match(host.textContent,/From interaction history/);await act(async()=>button(host,'Done').click());assert.equal(globalThis.__saved.at(-1)[2].state,'done')
 await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Workspace,{customerId:'c1',customerName:'QA customer',showLink,digest:'Fresh email and WhatsApp summary',items:legacyWorkItems([legacy]),saveItem:async(...a)=>globalThis.__saved.push(a)}))));assert.match(host.textContent,/Original quote conversation/)
},{showLink,digest:'Recent messages',items:legacyWorkItems([legacy]),saveItem:async(...a)=>{globalThis.__saved??=[];globalThis.__saved.push(a)}}))
test('task/note editor is simple; failed save retains draft and same retry ID; cancel does not save',async()=>mount(async(host)=>{
 await act(async()=>button(host,'Add note').click());assert.equal(host.querySelectorAll('input[type="date"]').length,0)
 await fill(host.querySelector('textarea'),'Keep within agreed budget');await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.match(host.querySelector('[role="alert"]').textContent,/Offline/);assert.equal(host.querySelector('textarea').value,'Keep within agreed budget');assert.equal(globalThis.__attempts.length,1)
 await act(async()=>host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(globalThis.__attempts[0][3],globalThis.__attempts[1][3]);await act(async()=>button(host,'Cancel').click());assert.equal(host.querySelector('form'),null)
},{saveItem:async(...a)=>{globalThis.__attempts??=[];globalThis.__attempts.push(a);throw Error('Offline; try again')}}))
test('completed tasks can be reopened without deleting the record',async()=>mount(async host=>{
 assert.doesNotMatch(host.textContent,/Finished task/);await act(async()=>button(host,'Show completed / archived (1)').click());assert.match(host.textContent,/Finished task/);await act(async()=>button(host,'Reopen').click());assert.equal(globalThis.__reopen[2].state,'todo')
},{items:[{id:'done',source:'work_item',kind:'task',text:'Finished task',state:'done',revision:2}],saveItem:async(...a)=>{globalThis.__reopen=a}}))
test('both real pages use the same workflow and legacy carry-over; dashboard no longer has a second follow-up list',async()=>{
 const dashboard=await readFile('src/pages/Dashboard.jsx','utf8'), customer=await readFile('src/pages/CustomerDetail.jsx','utf8');for(const source of [dashboard,customer]){assert.match(source,/<CustomerWorkspace/);assert.match(source,/combineWorkItems/);assert.match(source,/useCustomerWorkItems/)}assert.doesNotMatch(dashboard,/Priority Follow-ups/);assert.match(customer,/Interaction history/);assert.match(customer,/defaultOpen=\{false\}/)
})

const longSummary = 'Recent customer discussions and quotation requests. '.repeat(18) + 'Unique final detail.'
test('Dashboard summary preview expands and collapses without hiding tasks or saving data',async()=>mount(async host=>{
 const more=button(host,'Show more');assert.ok(more);assert.equal(more.getAttribute('aria-expanded'),'false')
 const paragraph=host.querySelector(`[id="${more.getAttribute('aria-controls')}"]`)
 assert.ok(paragraph.textContent.length<=501);assert.ok(paragraph.textContent.endsWith('…'));assert.doesNotMatch(paragraph.textContent,/Unique final detail/)
 assert.match(host.textContent,/Original quote conversation/);assert.ok(button(host,'Add task'));assert.ok(button(host,'Add note'))
 await act(async()=>more.click());assert.equal(paragraph.textContent,longSummary);assert.equal(button(host,'Show less').getAttribute('aria-expanded'),'true')
 await act(async()=>button(host,'Show less').click());assert.doesNotMatch(paragraph.textContent,/Unique final detail/)
},{digest:longSummary,collapseSummary:true,items:legacyWorkItems([legacy]),saveItem:async()=>assert.fail('Expanding must not save')}))
test('short/empty summaries need no expansion; customer page retains its full summary',async()=>{
 for(const props of [{digest:'Short summary',collapseSummary:true},{digest:'',collapseSummary:true},{digest:longSummary}])await mount(async host=>{
 assert.equal(button(host,'Show more'),undefined);assert.equal(button(host,'Show less'),undefined)
 assert.match(host.textContent,new RegExp(props.digest?'Short summary|Unique final detail':'No recent summary'))
 },props)
})
test('new summary or conversation window resets expansion and does not retain the old text',async()=>mount(async(host,root)=>{
 await act(async()=>button(host,'Show more').click())
 const fresh=longSummary.replace('Unique final detail.','Replacement final detail.')
 await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Workspace,{customerId:'c1',customerName:'QA customer',collapseSummary:true,summaryDays:180,digest:fresh}))))
 assert.equal(button(host,'Show more').getAttribute('aria-expanded'),'false');assert.doesNotMatch(host.textContent,/Unique final detail|Replacement final detail/)
 await act(async()=>button(host,'Show more').click());assert.match(host.textContent,/Replacement final detail/)
},{digest:longSummary,collapseSummary:true}))
