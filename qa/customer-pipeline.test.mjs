import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {Simulate} from 'react-dom/test-utils'
import {MemoryRouter} from 'react-router-dom'
import {emptyPipeline,pipelineTransition,summaryKey,validatePipelineSuggestions} from '../src/customerPipeline.js'
import {customerMergeFields} from '../src/customerMergeFields.js'
import {pipelineSuggestions,PIPELINE_SYSTEM} from '../netlify/edge-functions/lib/pipelineSuggestions.js'
const digest='Customer requests a sample and a quotation for a repeat order.'
const key=await summaryKey(digest)
const input=[{id:'c1',name:'QA customer',digest,source_key:key,pipeline:emptyPipeline()}]
const suggestion={id:'c1',status:'active',detail:'Sample and quotation for repeat order',reason:'Specific buying request',evidence:'requests a sample and a quotation',request_kind:'sample',all_requests_resolved:false}
const validated=()=>validatePipelineSuggestions({suggestions:[suggestion]},input)[0]
const stage=()=>pipelineTransition(emptyPipeline(),'suggest',{suggestion:validated()})
test('AI additions never count as active before human confirmation',()=>{
 const staged=stage();assert.equal(staged.status,'inactive');assert.equal(staged.detail,'');assert.equal(staged.suggestion.status,'active')
 const active=pipelineTransition(staged,'confirm',{sourceKey:key,detail:'Sample + quotation; keep both requests'});assert.equal(active.status,'active');assert.match(active.detail,/both/);assert.equal(active.suggestion,null)
})
test('dismiss preserves confirmed requests and suppresses the same reviewed summary',()=>{
 const current={...stage(),status:'active',detail:'Two outstanding requests'}
 const result=pipelineTransition(current,'dismiss',{sourceKey:key});assert.equal(result.status,'active');assert.equal(result.detail,current.detail)
 assert.equal(pipelineTransition(result,'suggest',{suggestion:validated()}),null)
})
test('repeat order confirmation and rolling-summary absence never close a customer',()=>{
 const current={...emptyPipeline(),status:'active',detail:'First order agreed; another sample request remains',revision:4}
 assert.equal(pipelineTransition(current,'suggest',{suggestion:{...validated(),based_on_revision:4}}).status,'active')
 assert.match(PIPELINE_SYSTEM,/order confirmation closes only that request/);assert.match(PIPELINE_SYSTEM,/missing mention/)
 const closed=pipelineTransition(current,'manual',{status:'inactive',detail:'All requests completed; no further request'});assert.equal(closed.status,'inactive')
})
test('unknown IDs, duplicates, hallucinated evidence, unqualified requests and unsupported closure fail closed',()=>{
 for(const change of [{id:'other'},{evidence:'Invented text'},{request_kind:'greeting'},{status:'inactive',all_requests_resolved:false},{status:'inactive',all_requests_resolved:true},{detail:''},{detail:'x'.repeat(2001)}])assert.throws(()=>validatePipelineSuggestions({suggestions:[{...suggestion,...change}]},input))
 assert.throws(()=>validatePipelineSuggestions({suggestions:[suggestion,suggestion]},input));assert.throws(()=>validatePipelineSuggestions({},input))
})
test('explicit all-request closure is a proposal until reviewed',()=>{
 const active={...emptyPipeline(),status:'active',detail:'Sample request',revision:2}
 const [s]=validatePipelineSuggestions({suggestions:[{...suggestion,status:'inactive',all_requests_resolved:true}]},[{...input[0],pipeline:active}])
 const proposed=pipelineTransition(active,'suggest',{suggestion:s});assert.equal(proposed.status,'active')
 assert.equal(pipelineTransition(proposed,'confirm',{sourceKey:key,detail:'All requests closed'}).status,'inactive')
})
test('stale review and concurrent generation cannot replace a human decision',()=>{
 assert.throws(()=>pipelineTransition({...emptyPipeline(),revision:2},'suggest',{suggestion:validated()}),/changed/)
 assert.throws(()=>pipelineTransition(stage(),'confirm',{sourceKey:'old',detail:'x'}),/changed/)
 assert.throws(()=>pipelineTransition(stage(),'confirm',{sourceKey:key,detail:' '}))
})
for(const reverse of [false,true])test(`customer merges keep active requests whichever record survives (${reverse})`,()=>{
 const a={sales_pipeline:{...emptyPipeline(),status:'active',detail:'Sample A',revision:3}},b={sales_pipeline:{...emptyPipeline(),status:'active',detail:'Repeat quotation B',revision:6}}
 const p=customerMergeFields(reverse?a:b,reverse?b:a).sales_pipeline;assert.equal(p.status,'active');assert.match(p.detail,/Sample A/);assert.match(p.detail,/quotation B/);assert.equal(p.revision,7);assert.equal(p.suggestion,null)
})
const request=customers=>new Request('https://example.test/api',{method:'POST',body:JSON.stringify({customers})})
const ai=(result,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof result==='string'?result:JSON.stringify(result)}}]}))
test('AI endpoint validates complete grounded output and preserves prompt-injection data boundaries',async()=>{
 let calls=0;const response=await pipelineSuggestions(request(input),'private-key',async(url,opts)=>{calls++;const body=JSON.parse(opts.body);assert.match(body.messages[0].content,/untrusted DATA/);return ai({suggestions:[suggestion]})});assert.equal(response.status,200);assert.equal(calls,1)
})
test('truncated JSON retries once and never salvages partial suggestions',async()=>{
 let calls=0;const response=await pipelineSuggestions(request(input),'key',async()=>{calls++;return ai('{"suggestions":[','length')});assert.equal(calls,2);assert.equal(response.status,502)
})
test('unknown AI IDs and invalid evidence cannot reach staging',async()=>{
 for(const result of [{suggestions:[{...suggestion,id:'bad'}]},{suggestions:[{...suggestion,evidence:'no evidence'}]}])assert.equal((await pipelineSuggestions(request(input),'key',async()=>ai(result))).status,502)
})
test('oversized/invalid batches rejected before calling AI; empty no-change result allowed',async()=>{
 let calls=0;const mock=async()=>{calls++;return ai({suggestions:[]})}
 assert.equal((await pipelineSuggestions(request([...input,...input]),'key',mock)).status,400)
 assert.equal((await pipelineSuggestions(request([{...input[0],digest:'x'.repeat(8001)}]),'key',mock)).status,400);assert.equal(calls,0)
 assert.equal((await pipelineSuggestions(request(input),'key',mock)).status,200)
})
let scratch,Component,Panel,Dashboard
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'})
before(async()=>{
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 scratch=await mkdtemp(resolve('.qa-pipeline-'))
 await build({entryPoints:['src/components/CustomerPipeline.jsx'],outdir:scratch,outExtension:{'.js':'.mjs'},bundle:true,jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom','lucide-react'],plugins:[{name:'mock-api',setup(b){b.onResolve({filter:/domain\/customerPipeline$/},()=>({path:'mock',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function savePipelineDecision(){};export async function suggestCustomerPipeline(){return 0}',loader:'js'}))}}]})
 const module=await import(pathToFileURL(join(scratch,'CustomerPipeline.mjs')));Component=module.CustomerPipeline;Panel=module.default
 await build({entryPoints:['src/pages/Dashboard.jsx'],outfile:join(scratch,'dashboard.mjs'),bundle:true,jsx:'automatic',format:'esm',platform:'node',external:['react','react-dom','react-router-dom','lucide-react'],plugins:[{name:'dashboard-fixtures',setup(b){
  b.onResolve({filter:/firebase\/firestore$|\/firebase$|domain\/customerWorkItems$|domain\/customer$|domain\/weeklySummary$|domain\/customerPipeline$|\/shipping$/},a=>({path:a.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='firebase/firestore'?`export const doc=(...a)=>a.slice(1).join('/');export const collection=(...a)=>a.slice(1).join('/');export const collectionGroup=(db,name)=>'group/'+name;export const query=x=>x;export const onSnapshot=(path,fn)=>{const rows=globalThis.__dashboardRows[path]||[];fn({docs:rows.map((r,i)=>({id:r.id||String(i),data:()=>r,ref:{parent:{parent:{id:'c1',parent:{id:'customers'}}}}})),exists:()=>true,data:()=>({items:[{customerId:'c1',digest:'Fixture summary'}]})});return()=>{}};`
   :a.path.endsWith('/firebase')?'export const db={};'
   :a.path.endsWith('customerWorkItems')?'export const useCustomerWorkItems=()=>({items:[],loading:false,error:""});export async function saveCustomerWorkItem(){};'
   :a.path.endsWith('weeklySummary')?'export async function generateWeeklySummary(days){globalThis.__dashboardAiCalls.push(days);return {items:[]}};'
   :a.path.endsWith('customerPipeline')?'export async function savePipelineDecision(){};export async function suggestCustomerPipeline(customers,progress,days){globalThis.__dashboardSuggestionCalls.push(days);return 0};'
   :a.path.endsWith('/shipping')?'export const orderStatusOf=v=>({label:v});export const orderUc=o=>o.uc_no;'
   :'export const normalizeCustomer=c=>c;export const RETAIL_TAG="Retail Customer";'}))
 }}]})
 Dashboard=(await import(pathToFileURL(join(scratch,'dashboard.mjs')))).default
})
after(async()=>{dom.window.close();await rm(scratch,{recursive:true,force:true})})
async function mount(component,props,fn){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);try{await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(component,props))));await fn(host,root)}finally{await act(async()=>root.unmount());host.remove()}}
const button=(h,t)=>[...h.querySelectorAll('button')].find(b=>b.textContent.trim()===t)
test('real review UI requires opening and explicit confirmation; cancellation does not save',async()=>{
 const saves=[];await mount(Component,{customer:{id:'c1',company_name:'QA',sales_pipeline:stage()},save:async(...args)=>saves.push(args)},async h=>{
 assert.match(h.textContent,/Awaiting your confirmation/);assert.equal(button(h,'Confirm active customer'),undefined)
 await act(async()=>button(h,'Review suggestion').click());await act(async()=>button(h,'Cancel').click());assert.equal(saves.length,0)
 await act(async()=>button(h,'Review suggestion').click());await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
 assert.equal(saves.length,1);assert.equal(saves[0][2],'confirm');assert.match(saves[0][3].detail,/Sample/)
 })
})
test('failed review keeps the editable draft and displays an error',async()=>mount(Component,{customer:{id:'c1',company_name:'QA',sales_pipeline:stage()},save:async()=>{throw Error('Changed elsewhere')}},async h=>{
 await act(async()=>button(h,'Review suggestion').click());await act(async()=>{const el=h.querySelector('textarea');el.value='Keep second request active';Simulate.change(el,{target:{value:el.value}})});await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
 assert.match(h.querySelector('[role="alert"]').textContent,/Changed/);assert.equal(h.querySelector('textarea').value,'Keep second request active')
}))
test('dashboard counts distinct confirmed customers separately from pending suggestions',async()=>mount(Panel,{customers:[{id:'a',company_name:'A',sales_pipeline:stage()},{id:'b',company_name:'B',sales_pipeline:{...emptyPipeline(),status:'active',detail:'Two requests, counted once'}}]},async h=>{
 assert.match(h.textContent,/1 confirmed active customers · 1 suggestions/);assert.equal(h.querySelectorAll('section').length,2)
}))
test('open editor submits its original revision even if a newer position arrives',async()=>{
 const saves=[],c={id:'c1',company_name:'QA',sales_pipeline:{...emptyPipeline(),status:'active',detail:'Old request',revision:4}}
 await mount(Component,{customer:c,save:async(...a)=>saves.push(a)},async(h,root)=>{
 await act(async()=>button(h,'Edit position').click())
 await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Component,{customer:{...c,sales_pipeline:{...c.sales_pipeline,revision:5,detail:'New request from another tab'}},save:async(...a)=>saves.push(a)}))))
 await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(saves[0][1],4);assert.ok(saves[0][4])
 })
})
test('every real Dashboard figure immediately replaces general summaries with its content',async()=>{
 globalThis.__dashboardRows={customers:[{id:'c1',company_name:'QA',sales_pipeline:{...emptyPipeline(),status:'active',detail:'Current repeat request'}}],orders:[{id:'o1',customer_id:'c1',status:'confirmed',order_date:new Date().toISOString().slice(0,10),uc_no:'QA-ONLY'}],'group/enquiries':[{id:'e1',follow_up_date:{seconds:1000},description:'Old task',status:'Open'}]}
 await mount(Dashboard,{},async h=>{
 assert.ok([...h.querySelectorAll('h2')].some(e=>e.textContent==='Customer Summary & To-do'))
 assert.ok(!h.textContent.includes('Current repeat request'));assert.ok(!button(h,'Suggest from summaries'))
 for(const name of ['Pipeline','Follow-ups Due','In Production','New Orders']){
  const card=[...h.querySelectorAll('button')].find(b=>[...b.querySelectorAll('p')].some(p=>p.textContent===name));assert.ok(card);await act(async()=>card.click())
  assert.ok(button(h,'Back to summaries'));assert.ok(![...h.querySelectorAll('h2')].some(e=>e.textContent==='Customer Summary & To-do'))
  if(name==='Pipeline')assert.match(h.textContent,/Current repeat request/)
  else if(name==='Follow-ups Due')assert.match(h.textContent,/Old task/)
  else assert.match(h.textContent,/QA-ONLY/)
  await act(async()=>button(h,'Back to summaries').click());assert.ok([...h.querySelectorAll('h2')].some(e=>e.textContent==='Customer Summary & To-do'))
 }
 });delete globalThis.__dashboardRows
})
test('Dashboard customer selection and conversation window only read saved data; AI actions are explicit',async()=>{
 globalThis.localStorage=dom.window.localStorage;localStorage.clear()
 globalThis.__dashboardAiCalls=[];globalThis.__dashboardSuggestionCalls=[]
 globalThis.__dashboardRows={customers:[{id:'c1',company_name:'QA',sales_pipeline:{...emptyPipeline(),status:'active',detail:'Private Pipeline position'}}]}
 await mount(Dashboard,{},async h=>{
  assert.ok(!button(h,'Refresh'));assert.match(h.textContent,/Saved data updates automatically/)
  assert.ok(!h.textContent.includes('Private Pipeline position'))
  const period=()=>[...h.querySelectorAll('label')].find(l=>l.textContent.startsWith('Conversation window'))?.querySelector('select')
  const customer=[...h.querySelectorAll('label')].find(l=>l.textContent.includes('Find a customer')).querySelector('select')
  await act(async()=>Simulate.change(customer,{target:{value:'c1'}}))
  assert.ok(!h.textContent.includes('Private Pipeline position'));assert.ok(!button(h,'Transaction completed'))
  await act(async()=>Simulate.change(period(),{target:{value:'90'}}))
  assert.deepEqual(globalThis.__dashboardAiCalls,[]);assert.deepEqual(globalThis.__dashboardSuggestionCalls,[])
  assert.match(h.textContent,/Tasks and dashboard figures are unaffected/)
  await act(async()=>button(h,'Update AI summaries').click())
  assert.deepEqual(globalThis.__dashboardAiCalls,[90]);assert.deepEqual(globalThis.__dashboardSuggestionCalls,[])
  const pipeline=()=>[...h.querySelectorAll('button')].find(b=>[...b.querySelectorAll('p')].some(p=>p.textContent==='Pipeline'))
  await act(async()=>pipeline().click());assert.match(h.textContent,/Private Pipeline position/)
  const source=[...h.querySelectorAll('label')].find(l=>l.textContent.startsWith('Use saved summaries from')).querySelector('select')
  assert.equal(source.value,'90');await act(async()=>Simulate.change(source,{target:{value:'14'}}))
  assert.deepEqual(globalThis.__dashboardSuggestionCalls,[])
  await act(async()=>button(h,'Suggest from summaries').click())
  assert.deepEqual(globalThis.__dashboardSuggestionCalls,[14]);assert.deepEqual(globalThis.__dashboardAiCalls,[90])
  await act(async()=>pipeline().click());assert.ok(period());assert.equal(period().value,'14')
  assert.ok(!button(h,'Suggest from summaries'));assert.ok(!h.textContent.includes('Private Pipeline position'))
 });delete globalThis.__dashboardRows;delete globalThis.localStorage
})
test('both real pages use the shared Pipeline; old interaction-status count removed',async()=>{
 const dash=await readFile('src/pages/Dashboard.jsx','utf8'),detail=await readFile('src/pages/CustomerDetail.jsx','utf8');assert.match(dash,/<PipelinePanel/);assert.match(detail,/<CustomerPipeline/);assert.doesNotMatch(dash,/allEnquiries.filter\(e => e.status === 'Open'/)
})

test('completed transaction with request kind none cannot become an active proposal',()=>{
 assert.throws(()=>validatePipelineSuggestions({suggestions:[{...suggestion,request_kind:'none'}]},input),/unresolved buying request/)
 assert.match(PIPELINE_SYSTEM,/completed transaction/);assert.match(PIPELINE_SYSTEM,/Do not relabel fulfilment/)
})
test('contradictory active/none response receives targeted retry feedback',async()=>{
 let calls=0
 const response=await pipelineSuggestions(request(input),'key',async(url,opts)=>{
  calls++;const prompt=JSON.parse(opts.body).messages[0].content
  if(calls===1)return ai({suggestions:[{...suggestion,request_kind:'none'}]})
  assert.match(prompt,/Previous response was rejected: Active suggestions require/)
  return ai({suggestions:[]})
 });assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual((await response.json()).suggestions,[])
})
test('server copies referenced evidence exactly and rejects unknown references',async()=>{
 const {pipelineEvidence}=await import('../netlify/edge-functions/lib/pipelineEvidence.js')
 const long='Buyer requested “engraving” and prices. '.repeat(100)
 assert.equal(pipelineEvidence(long).map(p=>p.text).join(''),long)
 for(const p of pipelineEvidence(long)){assert.ok(p.text.length<=900);assert.ok(long.includes(p.text))}
 const good=await pipelineSuggestions(request(input),'key',async()=>ai({suggestions:[{...suggestion,evidence:undefined,evidence_ref:'E1'}]}))
 assert.equal(good.status,200);assert.equal((await good.json()).suggestions[0].evidence,digest)
 const bad=await pipelineSuggestions(request(input),'key',async()=>ai({suggestions:[{...suggestion,evidence_ref:'E999'}]}))
 assert.equal(bad.status,502);assert.equal((await bad.json()).code,'invalid_evidence_or_output')
})
test('batch failure falls back to individuals and continues past unsupported customers',async()=>{
 const {runPipelineSuggestions}=await import('../src/pipelineSuggestionRun.js')
 const entries=['c1','c2','c3'].map(id=>({...input[0],id})),saved=[],calls=[],progress=[]
 await assert.rejects(runPipelineSuggestions(entries,{
  request:async batch=>{calls.push(batch.map(c=>c.id));return batch.length>1||batch[0].id==='c2'?{ok:false,status:502,data:{code:'invalid_evidence_or_output'}}:{ok:true,status:200,data:{suggestions:[{...suggestion,id:batch[0].id}]}}},
  save:async s=>saved.push(s.id),onProgress:(n,total)=>progress.push([n,total]),
 }),/2 suggestions prepared; 1 customer summaries/)
 assert.deepEqual(saved,['c1','c3']);assert.deepEqual(calls,[['c1','c2'],['c1'],['c2'],['c3']]);assert.deepEqual(progress.at(-1),[3,3])
})
test('authorization, stale revisions and malformed success responses never get bypassed',async()=>{
 const {runPipelineSuggestions}=await import('../src/pipelineSuggestionRun.js');let saves=0
 for(const response of [{ok:false,status:403,data:{error:'Forbidden'}},{ok:true,status:200,data:{suggestions:[{...suggestion,evidence:'invented'}]}}])await assert.rejects(runPipelineSuggestions(input,{request:async()=>response,save:async()=>saves++}))
 await assert.rejects(runPipelineSuggestions(input,{request:async()=>({ok:true,status:200,data:{suggestions:[suggestion]}}),save:async()=>{throw Error('Pipeline changed')}}),/Pipeline changed/)
 assert.equal(saves,0)
})

test('Transaction completed opens closure review without saving; cancel preserves requests',async()=>{
 const saves=[],customer={id:'c1',company_name:'QA',sales_pipeline:{...emptyPipeline(),status:'active',detail:'Separate repeat request',revision:7}}
 await mount(Component,{customer,save:async(...args)=>saves.push(args)},async h=>{
  await act(async()=>button(h,'Transaction completed').click())
  assert.equal(saves.length,0);assert.match(h.textContent,/repeat-order request remains/);assert.ok(button(h,'Confirm closure'))
  assert.equal(h.querySelector('select').value,'inactive');assert.equal(h.querySelector('select').disabled,true)
  await act(async()=>button(h,'Cancel').click());assert.equal(saves.length,0);assert.match(h.textContent,/Separate repeat request/)
  await act(async()=>button(h,'Transaction completed').click());await act(async()=>h.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(saves.length,1);assert.equal(saves[0][1],7);assert.equal(saves[0][2],'manual');assert.equal(saves[0][3].status,'inactive')
 })
})
test('completed inactive customers are omitted on targeted retry, never staged as closure',async()=>{
 let calls=0;const response=await pipelineSuggestions(request(input),'key',async(url,opts)=>{
  calls++;if(calls===1)return ai({suggestions:[{...suggestion,status:'inactive',request_kind:'none',all_requests_resolved:true}]})
  assert.match(JSON.parse(opts.body).messages[0].content,/already inactive: omit/);return ai({suggestions:[]})
 });assert.equal(response.status,200);assert.deepEqual((await response.json()).suggestions,[]);assert.equal(calls,2)
})
