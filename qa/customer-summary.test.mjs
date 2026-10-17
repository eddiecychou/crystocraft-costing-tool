import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {SUMMARY_PERIODS,summaryDays,summaryCacheId,summarySource,validSummaryCache} from '../src/customerSummary.js'
import {weeklyDigest} from '../netlify/edge-functions/lib/weeklyDigest.js'
test('periods are 14/30/90/180/365 days with independent caches and legacy one-month compatibility',()=>{
 assert.deepEqual(SUMMARY_PERIODS.map(p=>p.days),[14,30,90,180,365]);assert.equal(summaryCacheId(30),'weekly_summary');assert.equal(summaryCacheId(14),'customer_summary_14');assert.equal(summaryCacheId(90),'customer_summary_90');assert.equal(summaryCacheId(180),'customer_summary_180');assert.equal(summaryCacheId(365),'customer_summary_365');assert.ok(validSummaryCache('customer_summary_365'));assert.equal(validSummaryCache('customer_summary_7'),false);assert.throws(()=>summaryDays(7));assert.equal(summaryDays('90'),90)
})
test('short sources retain all messages and dates; busy sources cover new and older activity within bounds',()=>{
 const messages=[{date:'2026-10-17',from:'Buyer',snippet:'Newest quotation request'},{date:'2026-08-01',from:'Buyer',snippet:'Earlier sample request'}]
 const all=summarySource([],[{subject:'Project',messages}],[]);assert.equal(all.limited,false);assert.match(all.text,/Newest/);assert.match(all.text,/Earlier/)
 const busy=summarySource([],[{subject:'Project',messages:Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,9,17)-i*86400000).toISOString(),from:'Buyer',snippet:'Activity '+i+' '+ 'x'.repeat(580)}))}],[],5000)
 assert.equal(busy.limited,true);assert.ok(busy.text.length<=5000);assert.match(busy.text,/Activity 0 /);assert.match(busy.text,/Activity 99 /)
})
const request=(days,customers=[{id:'c1',name:'QA',text:'Requested a sample, then a quotation. Sample sent; repeat pricing still outstanding.'}])=>new Request('https://example.test',{method:'POST',body:JSON.stringify({lookbackDays:days,customers})})
const response=(digests,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify({digests})}}]}))
for(const days of [14,30,90,180,365])test(`AI uses the selected ${days}-day period and asks for a fuller factual summary`,async()=>{
 const r=await weeklyDigest(request(days),'key',async(url,options)=>{const body=JSON.parse(options.body);assert.match(body.messages[0].content,new RegExp(`last ${days} days`));assert.match(body.messages[0].content,/3–6 sentences/);assert.match(body.messages[0].content,/repeat-order/);return response([{id:'c1',digest:'Specific request. Sample sent. Repeat pricing remains outstanding.'}])});assert.equal(r.status,200)
})
test('incomplete, duplicate, unknown, truncated and malformed summary output never replaces a cache',async()=>{
 for(const result of [[],[{id:'other',digest:'Wrong customer'}],[{id:'c1',digest:''}],[{id:'c1',digest:'x'},{id:'c1',digest:'y'}]])assert.equal((await weeklyDigest(request(30),'key',async()=>response(result))).status,502)
 assert.equal((await weeklyDigest(request(30),'key',async()=>response([{id:'c1',digest:'partial'}],'length'))).status,502)
 assert.equal((await weeklyDigest(request(30),'key',async()=>new Response('invalid'))).status,502)
 assert.equal((await weeklyDigest(request(7),'key')).status,400)
})
let scratch,api,originalFetch
before(async()=>{
 scratch=await mkdtemp(resolve('.qa-summary-'));originalFetch=globalThis.fetch
 await build({entryPoints:['src/domain/weeklySummary.js'],outfile:join(scratch,'summary.mjs'),bundle:true,format:'esm',platform:'node',plugins:[{name:'local-only',setup(b){
 b.onResolve({filter:/firebase\/firestore$|\/firebase$|^\.\/customer$/},a=>({path:a.path,namespace:'fake'}))
 b.onLoad({filter:/.*/,namespace:'fake'},a=>({loader:'js',contents:a.path==='firebase/firestore'?`
 export const collectionGroup=(db,name)=>'group/'+name;export const collection=(db,...p)=>p.join('/');export const doc=(db,...p)=>p.join('/');export const Timestamp={fromDate:d=>d};export const serverTimestamp=()=>'SERVER';
 export const where=(...a)=>a;export const orderBy=(...a)=>a;export const query=(path,...filters)=>({path,filters});
 export const getDocs=async q=>{const path=q.path||q;if(path==='group/enquiries'){globalThis.__summaryCutoff=q.filters[0][2];return{docs:Array.from({length:globalThis.__summaryCount},(_,i)=>({id:'e'+i,ref:{parent:{parent:{id:'c'+(globalThis.__summaryBusy?Math.floor(i/100):i),parent:{id:'customers'}}}},data:()=>({date:{toDate:()=>new Date()},description:globalThis.__summaryBusy?'Request a quotation '+'x'.repeat(380):'Request a quotation',channel:'Email'})}))}}return{docs:[]}};
 export const getDoc=async path=>({exists:()=>true,data:()=>({company_name:path,tags:[]})});export const setDoc=async(path,data)=>{globalThis.__summarySaved={path,data}};`
 :a.path.endsWith('/firebase')?'export const db={};export const authedUser=async()=>({getIdToken:async()=>"test-only"});'
 :'export const NOT_CUSTOMER_TAG="Not a Real Customer";export const RETAIL_TAG="Retail Customer";'}))
 }}]});api=await import(pathToFileURL(join(scratch,'summary.mjs')))
})
after(async()=>{globalThis.fetch=originalFetch;await rm(scratch,{recursive:true,force:true})})
test('all 43 active customers are batched without silent cap; selected cutoff and cache are correct',async()=>{
 globalThis.__summaryCount=43;const calls=[];globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Detailed request, decision and outstanding action.'}))}))}
 const result=await api.generateWeeklySummary(90);assert.equal(result.items.length,43);assert.equal(calls.length,15);assert.ok(calls.every(c=>c.customers.length<=3&&c.lookbackDays===90));assert.equal(globalThis.__summarySaved.path,'dashboard_cache/customer_summary_90');assert.equal(globalThis.__summarySaved.data.lookbackDays,90);assert.ok(Math.abs(Date.now()-globalThis.__summaryCutoff-90*86400000)<5000)
})
test('a later batch failure preserves previous saved summaries in every period',async()=>{
 const old=globalThis.__summarySaved;globalThis.__summaryCount=9;let calls=0;globalThis.fetch=async(url,options)=>{if(++calls>=2)return new Response(JSON.stringify({error:'Incomplete AI'}),{status:502});const body=JSON.parse(options.body);return new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Valid first batch'}))}))}
 await assert.rejects(api.generateWeeklySummary(14),/Incomplete/);assert.equal(globalThis.__summarySaved,old)
})
test('both customer and dashboard expose period selection; tasks remain independent of period',async()=>{
 for(const path of ['src/pages/Dashboard.jsx','src/pages/CustomerDetail.jsx']){const src=await readFile(path,'utf8');assert.match(src,path.includes('Dashboard') ? /Conversation window/ : /Summary period/);assert.match(src,/useSummaryPeriod/);assert.match(src,/summaryDays=\{summaryPeriod\}/);assert.match(src,/combineWorkItems/)}
})

test('recoverable batch failures split to individual customers before saving one complete cache',async()=>{
 globalThis.__summaryCount=5;let calls=0;globalThis.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);return body.customers.length>1?new Response(JSON.stringify({code:'truncated',retryable:true,error:'AI reply cut short'}),{status:502}):new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Verified complete summary'}))}))}
 const progress=[];const result=await api.generateWeeklySummary(365,(n)=>progress.push(n));assert.equal(result.items.length,5);assert.equal(calls,8);assert.deepEqual(progress,[3,5]);assert.equal(globalThis.__summarySaved.path,'dashboard_cache/customer_summary_365')
})
test('provider configuration failures are actionable and never retried by splitting',async()=>{
 globalThis.__summaryCount=5;const old=globalThis.__summarySaved;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'configuration',retryable:false,error:'AI credentials need checking'}),{status:502})};await assert.rejects(api.generateWeeklySummary(180),/credentials/);assert.equal(calls,1);assert.equal(globalThis.__summarySaved,old)
})
test('edge reports distinct safe failure reasons without leaking provider response text',async()=>{
 for(const [fake,code,status] of [
 [async()=>response([{id:'c1',digest:'partial'}],'length'),'truncated',502],
 [async()=>{throw Object.assign(Error('private'),{name:'TimeoutError'})},'timeout',502],
 [async()=>new Response('private',{status:429}),'rate_limited',429],
 [async()=>new Response('private',{status:401}),'configuration',502],
 ]){const r=await weeklyDigest(request(365),'key',fake);assert.equal(r.status,status);const body=await r.json();assert.equal(body.code,code);assert.doesNotMatch(body.error,/private/)}
})
test('paged imported conversations are assembled exactly once; missing history fails closed',()=>{
 const d=(id,data)=>({id,data:()=>data});const docs=[d('parent',{subject:'Customer',messages:[{date:'2026-10-18',body_text:'New'}],history_part_ids:['parent--history-00000']}),d('parent--history-00000',{history_parent_id:'parent',messages:[{date:'2025-12-01',body_text:'Earlier request'}]})];const result=api.summaryThreadHistory(docs);assert.equal(result.length,1);assert.equal(result[0].data().messages.length,2);assert.throws(()=>api.summaryThreadHistory(docs.slice(0,1)),/history is incomplete/)
})

test('busy customers are batched by total source size, not only count',async()=>{
 globalThis.__summaryCount=300;globalThis.__summaryBusy=true;const calls=[]
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Complete long-period summary'}))}))}
 try{const result=await api.generateWeeklySummary(180);assert.equal(result.items.length,3);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.customers.reduce((n,x)=>n+x.text.length,0)<=24000));assert.ok(result.items.every(i=>i.sourceLimited))}finally{globalThis.__summaryBusy=false}
})
