import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {Simulate} from 'react-dom/test-utils'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {JSDOM} from 'jsdom'
import {emptyProject,cleanProject,projectMatches,projectGroups,projectCustomer,parseProjectHandoff} from '../src/pdProjects.js'
const input=()=>({...emptyProject(),title:'Fictional coach'})
test('internal project needs only title; optional blanks/null preserved and unsafe fields stripped',()=>{const p=cleanProject({...input(),price:99,published:true});assert.equal(p.customerId,null);assert.equal(p.leadImageUrl,'');assert.equal(p.brief,'');assert.equal(p.customerLabel,'');assert.equal(p.price,undefined);assert.deepEqual(p.links,[])})
test('bounded stages, image URLs, stable record IDs and safe typed links validated',()=>{
 for(const patch of [{title:' '},{status:'Published'},{leadImageUrl:'javascript:alert(1)'},{leadImageUrl:'https://unknown.example/a.jpg'},{customerId:'bad/id'},{links:[{type:'reference',label:'x',url:'https://user:secret@example.com'}]},{links:[{type:'range_product',label:'x',recordId:'../../bad'}]},{nextAction:'x'.repeat(601)},{archived:'yes'}])assert.throws(()=>cleanProject({...input(),...patch}))
 const p=cleanProject({...input(),customerId:'c1',customerLabel:'Customer',internalGroup:'discard',links:[{type:'range_product',recordId:'range-1',label:'Range',url:'https://wrong.example'}]});assert.equal(p.links[0].url,'/range/range-1');assert.equal(p.internalGroup,'')
})
test('Waiting is derived and excluded for hold/completed/archive; active includes waiting',()=>{for(const p of [{...input(),status:'Awaiting feedback'},{...input(),waitingOn:'Supplier'}]){assert.ok(projectMatches(p,'Waiting'));assert.ok(projectMatches(p,'Active'))}for(const status of ['Completed','On hold']){const p={...input(),status,waitingOn:'Old task'};assert.ok(!projectMatches(p,'Active'));assert.ok(!projectMatches(p,'Waiting'));assert.ok(projectMatches(p,status))}assert.ok(projectMatches({...input(),archived:true},'Archived'));assert.ok(!projectMatches({...input(),archived:true},'Waiting'))})
test('missing customer lookup never loses projects; grouping/search sorted by latest update',()=>{
 const projects=[{...input(),id:'a',customerId:'missing',customerLabel:'Saved client',updatedAt:{seconds:5}},{...input(),id:'b',updatedAt:{seconds:10}},{...input(),id:'c',customerId:'missing',customerLabel:'Saved client',updatedAt:{seconds:20}}];const groups=projectGroups(projects);assert.equal(groups[0].key,'missing');assert.deepEqual(groups[0].projects.map(p=>p.id),['c','a']);assert.equal(projectCustomer(projects[0]),'Saved client');assert.ok(projectMatches(projects[0],'Active','saved','missing'));assert.equal(projectGroups(projects).flatMap(g=>g.projects).length,3)
})
test('agent handoff only accepts editable update headings; no status or product writes',()=>{assert.deepEqual(parseProjectHandoff('Current state: Draft ready\nNext action: Check sample\nWaiting on:\nDecision: Use silver'),{currentState:'Draft ready',nextAction:'Check sample',waitingOn:'',note:'Use silver'});for(const text of ['Publish: yes','Status: Completed','random','Decision: A\nDecision: B'])assert.throws(()=>parseProjectHandoff(text))})
let scratch,Projects,Editor,Detail;const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'})
before(async()=>{globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;scratch=await mkdtemp(resolve('.qa-pd-projects-'));await build({entryPoints:['src/pages/pd/Projects.jsx'],outfile:join(scratch,'ui.mjs'),bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react-router-dom'],plugins:[{name:'mock',setup(b){b.onResolve({filter:/domain\/pdProjects$|firestore\/realCustomers$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path.endsWith('realCustomers')?'export async function listRealCustomers(){if(globalThis.__pdCustomerError)throw Error("Denied");return []}':'export const listDesignProjects=async()=>{if(globalThis.__pdListError)throw Error("Denied");return globalThis.__pdRows||[]};export const getDesignProject=async id=>(globalThis.__pdRows||[]).find(p=>p.id===id)||null;export const designProjectHistory=async()=>({items:[],more:false,cursor:null});export const saveDesignProject=async(...a)=>{globalThis.__pdSaves.push(a)};'}))}}]});const m=await import(pathToFileURL(join(scratch,'ui.mjs')));Projects=m.default;Editor=m.ProjectEditor;Detail=m.DesignProjectDetail})
after(async()=>{dom.window.close();await rm(scratch,{recursive:true,force:true})})
async function mount(Component,props,fn,path='/'){const h=document.createElement('div');document.body.append(h);const root=createRoot(h);try{await act(async()=>root.render(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Routes,null,React.createElement(Route,{path:'/design/projects/:id',element:React.createElement(Component,props)}),React.createElement(Route,{path:'*',element:React.createElement(Component,props)})))));await fn(h)}finally{await act(async()=>root.unmount());h.remove()}}
const button=(h,text)=>[...h.querySelectorAll('button')].find(b=>b.textContent===text)
async function fill(el,value){await act(async()=>{el.value=value;Simulate.change(el,{target:{value}})})}
test('real list has missing-customer fallback, correct filters and links to existing tools',async()=>{
 globalThis.__pdCustomerError=true;globalThis.__pdRows=[{...input(),id:'a',customerId:'missing',customerLabel:'Saved client',status:'Awaiting feedback',nextAction:'Review silver coach'}]
 await mount(Projects,{},async h=>{assert.match(h.textContent,/Saved client/);assert.match(h.textContent,/Customer lookup is unavailable/);for(const route of ['/design/products','/design/templates','/design/generations'])assert.ok(h.querySelector(`a[href="${route}"]`));await fill(h.querySelector('input[type=search]'),'no match');assert.match(h.textContent,/No projects match/);assert.equal(h.querySelectorAll('article').length,0)});delete globalThis.__pdCustomerError
})
test('internal create submits empty optional fields without touching linked collections',async()=>{
 const saved=[];await mount(Editor,{onSave:async(...a)=>saved.push(a),onCancel:()=>{}},async h=>{await fill(h.querySelector('input[required]'),'Internal family');await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(saved.length,1);assert.equal(saved[0][0].customerId,null);assert.equal(saved[0][0].leadImageUrl,'');assert.equal(saved[0][0].status,'Idea');assert.ok(saved[0][2])})
})
test('agent handoff is review-only until save, and failed save preserves local draft',async()=>{
 const calls=[];await mount(Editor,{project:{...input(),revision:3},onSave:async(...a)=>{calls.push(a);throw Error('Changed elsewhere')},onCancel:()=>{}},async h=>{await fill(h.querySelector('[aria-label="Agent update"]'),'Current state: Revised silver\nNext action: Check scale\nDecision: Keep original');await act(async()=>button(h,'Apply to draft').click());assert.equal(calls.length,0);assert.equal(h.querySelectorAll('textarea')[0].value,'Revised silver');await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.match(h.querySelector('[role=alert]').textContent,/Changed elsewhere/);assert.equal(h.querySelectorAll('textarea')[0].value,'Revised silver');assert.equal(calls[0][1],'Keep original')})
})
test('detail handles missing project and offers shared customer task link, no duplicate to-do store',async()=>{
 globalThis.__pdRows=[];await mount(Detail,{},async h=>assert.match(h.textContent,/Project not found/),'/design/projects/missing')
 globalThis.__pdRows=[{...input(),id:'p1',customerId:'c1',customerLabel:'Client',revision:1}];await mount(Detail,{},async h=>{assert.ok(h.querySelector('a[href="/customers/c1"]'));assert.match(h.textContent,/No references added/);assert.match(h.textContent,/Decision & update history/);assert.ok(!h.textContent.includes('Delete project'))},'/design/projects/p1')
})
test('new routes are gated and every existing gallery/tool route remains',async()=>{const app=await readFile('src/App.jsx','utf8');for(const path of ['/design/projects','/design/projects/new','/design/projects/:id'])assert.ok(app.includes(`path="${path}" element={<Gate module="product_design">`));for(const path of ['/design/products','/design/templates','/design/generations','/design/products/:id','/design/templates/:id'])assert.ok(app.includes(`path="${path}"`));const api=await readFile('src/domain/pdProjects.js','utf8');assert.doesNotMatch(api,/doc\(db,\s*['"](?:products|range_products|customers|pd_prompt_templates)['"]/);assert.match(api,/runTransaction/);assert.match(api,/updates/);assert.match(api,/limit\(50\)/)})
test('draft starting list is explicitly review-only, contains four valid proposals and is not auto-imported',async()=>{
 const draft=JSON.parse(await readFile('docs/plans/PRODUCT-DESIGN-PROJECTS-DRAFT-2026-10-17.json','utf8'));assert.equal(draft.status,'DRAFT_ONLY_NOT_IMPORTED');assert.equal(draft.projects.length,4)
 for(const p of draft.projects){cleanProject(p.proposedRecord);assert.ok(p.confirmBeforeImport.length);assert.equal(p.proposedRecord.leadImageUrl,'')}
 const page=await readFile('src/pages/pd/Projects.jsx','utf8'),api=await readFile('src/domain/pdProjects.js','utf8');assert.doesNotMatch(page+api,/PRODUCT-DESIGN-PROJECTS-DRAFT|importProjects|fetch\(/)
})

test('project navigation has a selected Projects link and a full-width accessible tools disclosure',async()=>{
 globalThis.__pdRows=[]
 await mount(Projects,{},async h=>{
  const navigation=h.querySelector('nav[aria-label="Product Design navigation"]'),projects=navigation.querySelector('a'),toggle=[...h.querySelectorAll('button')].find(b=>b.textContent.trim()==='Design tools')
  assert.equal(projects.getAttribute('href'),'/design/projects');assert.equal(projects.getAttribute('aria-current'),'page');assert.ok(toggle)
  const panel=h.querySelector('nav[aria-label="Product Design tools"]');assert.equal(toggle.getAttribute('aria-controls'),panel.id);assert.equal(panel.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false')
  await act(async()=>toggle.click());assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true')
  assert.deepEqual([...panel.querySelectorAll('a')].map(a=>a.getAttribute('href')),['/design/products','/design/templates','/design/generations','/design/tools'])
  await act(async()=>toggle.click());assert.equal(panel.hidden,true)
 },'/design/projects')
})
