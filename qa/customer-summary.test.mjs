import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {SUMMARY_PERIODS,summaryDays,summaryCacheId,summarySource} from '../src/customerSummary.js'
import {weeklyDigest} from '../netlify/edge-functions/lib/weeklyDigest.js'
test('periods are 14/30/90 days with independent caches and legacy one-month compatibility',()=>{
 assert.deepEqual(SUMMARY_PERIODS.map(p=>p.days),[14,30,90]);assert.equal(summaryCacheId(30),'weekly_summary');assert.equal(summaryCacheId(14),'customer_summary_14');assert.equal(summaryCacheId(90),'customer_summary_90');assert.throws(()=>summaryDays(365));assert.equal(summaryDays('90'),90)
})
test('short sources retain all messages and dates; busy sources cover new and older activity within bounds',()=>{
 const messages=[{date:'2026-10-17',from:'Buyer',snippet:'Newest quotation request'},{date:'2026-08-01',from:'Buyer',snippet:'Earlier sample request'}]
 const all=summarySource([],[{subject:'Project',messages}],[]);assert.equal(all.limited,false);assert.match(all.text,/Newest/);assert.match(all.text,/Earlier/)
 const busy=summarySource([],[{subject:'Project',messages:Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,9,17)-i*86400000).toISOString(),from:'Buyer',snippet:'Activity '+i+' '+ 'x'.repeat(580)}))}],[],5000)
 assert.equal(busy.limited,true);assert.ok(busy.text.length<=5000);assert.match(busy.text,/Activity 0 /);assert.match(busy.text,/Activity 99 /)
})
const request=(days,customers=[{id:'c1',name:'QA',text:'Requested a sample, then a quotation. Sample sent; repeat pricing still outstanding.'}])=>new Request('https://example.test',{method:'POST',body:JSON.stringify({lookbackDays:days,customers})})
const response=(digests,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify({digests})}}]}))
for(const days of [14,30,90])test(`AI uses the selected ${days}-day period and asks for a fuller factual summary`,async()=>{
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
 export const getDocs=async q=>{const path=q.path||q;if(path==='group/enquiries'){globalThis.__summaryCutoff=q.filters[0][2];return{docs:Array.from({length:globalThis.__summaryCount},(_,i)=>({id:'e'+i,ref:{parent:{parent:{id:'c'+i,parent:{id:'customers'}}}},data:()=>({date:{toDate:()=>new Date()},description:'Request a quotation',channel:'Email'})}))}}return{docs:[]}};
 export const getDoc=async path=>({exists:()=>true,data:()=>({company_name:path,tags:[]})});export const setDoc=async(path,data)=>{globalThis.__summarySaved={path,data}};`
 :a.path.endsWith('/firebase')?'export const db={};export const authedUser=async()=>({getIdToken:async()=>"test-only"});'
 :'export const NOT_CUSTOMER_TAG="Not a Real Customer";export const RETAIL_TAG="Retail Customer";'}))
 }}]});api=await import(pathToFileURL(join(scratch,'summary.mjs')))
})
after(async()=>{globalThis.fetch=originalFetch;await rm(scratch,{recursive:true,force:true})})
test('all 43 active customers are batched without silent cap; selected cutoff and cache are correct',async()=>{
 globalThis.__summaryCount=43;const calls=[];globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Detailed request, decision and outstanding action.'}))}))}
 const result=await api.generateWeeklySummary(90);assert.equal(result.items.length,43);assert.equal(calls.length,8);assert.ok(calls.every(c=>c.customers.length<=6&&c.lookbackDays===90));assert.equal(globalThis.__summarySaved.path,'dashboard_cache/customer_summary_90');assert.equal(globalThis.__summarySaved.data.lookbackDays,90);assert.ok(Math.abs(Date.now()-globalThis.__summaryCutoff-90*86400000)<5000)
})
test('a later batch failure preserves previous saved summaries in every period',async()=>{
 const old=globalThis.__summarySaved;globalThis.__summaryCount=9;let calls=0;globalThis.fetch=async(url,options)=>{if(++calls===2)return new Response(JSON.stringify({error:'Incomplete AI'}),{status:502});const body=JSON.parse(options.body);return new Response(JSON.stringify({digests:body.customers.map(c=>({id:c.id,digest:'Valid first batch'}))}))}
 await assert.rejects(api.generateWeeklySummary(14),/Incomplete/);assert.equal(globalThis.__summarySaved,old)
})
test('both customer and dashboard expose period selection; tasks remain independent of period',async()=>{
 for(const path of ['src/pages/Dashboard.jsx','src/pages/CustomerDetail.jsx']){const src=await readFile(path,'utf8');assert.match(src,/Summary period/);assert.match(src,/useSummaryPeriod/);assert.match(src,/summaryDays=\{summaryPeriod\}/);assert.match(src,/combineWorkItems/)}
})
