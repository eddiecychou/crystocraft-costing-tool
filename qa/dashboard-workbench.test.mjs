import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isDashboardB2B,customerWorkRows,dashboardTasks,quietCustomerIds,cleanWorkStages,groupCustomerItems,contactTime} from '../src/dashboardWorkbench.js'
import {projectCustomerActivity,createCustomerWorkbenchHandler,loadCustomerActivity} from '../netlify/functions/lib/customerWorkbench.js'
import {customerMergeFields} from '../src/customerMergeFields.js'
const now=Date.parse('2026-11-10T08:00:00Z'),ago=days=>new Date(now-days*86400000).toISOString()
const customers=[{id:'trade',company_name:'Trade'},{id:'retail',customer_type:'retail'},{id:'legacy-retail',tags:['Retail Customer']},{id:'chain',customer_type:'b2b',tags:['Retail Customer','Retail']},{id:'industry',tags:['Retail']},{id:'fake',tags:['Not a Real Customer']},{id:'online-crystocraft-o07'}]
test('one B2B scope retains legacy trade and reviewed wholesale retailers; no name/domain inference',()=>{
 assert.deepEqual(customers.filter(isDashboardB2B).map(c=>c.id),['trade','chain','industry'])
 assert.equal(isDashboardB2B({id:'x',customer_type:'retail',tags:['Retail']}),false)
})
test('all open includes future, waiting and undated; due includes overdue/today only; notes and B2C excluded',()=>{
 const grouped=new Map(customers.map(c=>[c.id,['past','today','future','undated','waiting','done','note'].map((id,n)=>({id,kind:id==='note'?'note':'task',state:id==='done'?'done':id==='waiting'?'waiting':'todo',due_on:n<3?['2026-11-09','2026-11-10','2026-11-11'][n]:''}))]))
 assert.equal(dashboardTasks(customers,grouped,'2026-11-10').length,15)
 assert.equal(dashboardTasks(customers,grouped,'2026-11-10','due').length,6)
 assert.equal(dashboardTasks(customers,grouped,'2026-11-10','waiting').length,3)
 assert.ok(dashboardTasks(customers,grouped,'2026-11-10').every(i=>isDashboardB2B(i.customer)))
})
test('parallel quote/order/exploration work survives review windows; historical confirmed quotes and shipped orders do not activate',()=>{
 const grouped=new Map([['trade',[{kind:'task',state:'todo'}]],['industry',[{kind:'note',state:'todo'}]]])
 const c=customers.map(c=>c.id==='chain'?{...c,dashboard_work:{stages:['exploration']}}:c)
 const args={customers:c,grouped,quotes:[{id:'q',customer_id:'chain',status:'sent'},{customer_id:'industry',status:'confirmed'},{customer_id:'retail',status:'draft'}],orders:[{id:'o',customer_id:'chain',status:'packing'},{customer_id:'industry',status:'shipped'}],activity:[{customerId:'chain',lastContactAt:ago(180),historyState:'known'},{customerId:'industry',lastContactAt:ago(45),historyState:'known'}],now}
 const rows=customerWorkRows({...args,days:30})
 assert.deepEqual(rows.map(r=>r.customer.id).sort(),['chain','trade']);assert.deepEqual(rows.find(r=>r.customer.id==='chain').stages,['exploration','quotation','order'])
 assert.deepEqual(rows.find(r=>r.customer.id==='trade').stages,[],'Task does not invent Exploration')
 assert.ok(customerWorkRows({...args,days:60}).some(r=>r.customer.id==='industry'))
 for(const days of [30,60,90,180,365])assert.ok(customerWorkRows({...args,days}).find(r=>r.customer.id==='chain').active)
})
test('contact dates come from actual communication headers/logs/send stamps; task, note, draft, sync and AI dates never count',()=>{
 const records=[
  {path:'customers/trade/email_threads/one',date_range:[ago(300),ago(100)],synced_at:ago(0)},
  {path:'customers/trade/whatsapp_threads/two',date_range:[ago(80),ago(50)]},
  {path:'customers/trade/enquiries/call',channel:'Email',date:ago(20)},
  {path:'customers/trade/enquiries/note',channel:'Internal',date:ago(0)},
  {path:'customers/trade/work_items/task',date:ago(0)},
  {path:'customers/trade/email_threads/moved',date_range:[ago(1),ago(1)],migrated_to:'elsewhere'},
  {path:'suppliers/trade/email_threads/spoof',date_range:[ago(0),ago(0)]},
 ]
 const result=projectCustomerActivity(customers,records,now)
 assert.equal(result.find(c=>c.customerId==='trade').lastContactAt,ago(20))
 assert.deepEqual(result.map(c=>c.customerId),['trade','chain','industry'])
 assert.equal(result.find(c=>c.customerId==='industry').historyState,'unknown')
 const newer=projectCustomerActivity([{id:'trade',lastOutreachAt:ago(5),updatedAt:ago(0)}],records,now)[0]
 assert.equal(newer.lastContactAt,ago(5))
})
test('quiet 90 selection excludes unknown, invalid, future and partial histories at exact boundary',()=>{
 const items=[{customerId:'boundary',lastContactAt:ago(90),historyState:'known'},{customerId:'older',lastContactAt:ago(365),historyState:'known'},{customerId:'newer',lastContactAt:ago(89),historyState:'known'},{customerId:'unknown',lastContactAt:null,historyState:'unknown'},{customerId:'partial',lastContactAt:ago(120),historyState:'partial'},{customerId:'future',lastContactAt:ago(-1),historyState:'known'}]
 assert.deepEqual([...quietCustomerIds(items,90,now)],['boundary','older'])
 assert.equal(contactTime('invalid',now),null)
 assert.equal(projectCustomerActivity([{id:'c'}],[{path:'customers/c/email_threads/missing'}],now)[0].historyState,'partial')
})
test('work stages validate a three-stage set and customer merges preserve both current projects',()=>{
 assert.deepEqual(cleanWorkStages(['order','exploration','order']),['exploration','order']);assert.throws(()=>cleanWorkStages(['production']))
 const merged=customerMergeFields({dashboard_work:{stages:['exploration'],revision:2}},{dashboard_work:{stages:['order'],revision:5}})
 assert.deepEqual(merged.dashboard_work.stages,['exploration','order']);assert.equal(merged.dashboard_work.revision,6)
})
test('grouping does not mutate history or merge identities by company name',()=>{
 const e=[{customerId:'trade',id:'e'}],w=[{customerId:'chain',id:'w'}]
 const map=groupCustomerItems(customers,e,w,(a,b)=>[...a,...b]);assert.equal(map.get('trade')[0].id,'e');assert.equal(map.get('chain')[0].id,'w');assert.equal(e.length,1)
})
const request=(token='valid',method='GET')=>new Request('https://example.test/api/customer-workbench',{method,headers:token?{Authorization:'Bearer '+token}:{}})
test('API requires fresh verified identity and CRM profile; customer/anonymous/service/non-CRM cannot read metadata',async()=>{
 for(const profile of [{role:'customer',status:'approved'},{role:'staff',modules:['marketing']},null]){
  let reads=0;const handler=createCustomerWorkbenchHandler({verifyToken:async()=>({uid:'u'}),getProfile:async()=>profile,load:async()=>{reads++;return {customers,records:[]}}})
  assert.equal((await handler(request())).status,403);assert.equal(reads,0)
 }
 const handler=createCustomerWorkbenchHandler({verifyToken:async()=>{throw Error()},getProfile:async()=>({role:'admin'}),load:async()=>assert.fail('Forbidden load')})
 assert.equal((await handler(request())).status,401);assert.equal((await handler(request(''))).status,401);assert.equal((await handler(request('valid','POST'))).status,405)
 const service=createCustomerWorkbenchHandler({verifyToken:async()=>({uid:'mcp-range-upload-service'}),getProfile:async()=>assert.fail(),load:async()=>assert.fail()});assert.equal((await service(request())).status,401)
})
test('authorized response contains only scoped dates, has no shared cache, and read failures fail closed',async()=>{
 for(const profile of [{role:'admin'},{role:'staff',modules:['customers']}]){
  const handler=createCustomerWorkbenchHandler({verifyToken:async()=>({uid:'u'}),getProfile:async()=>profile,load:async()=>({customers:[{id:'trade',last_contacted:ago(10),supplier_cost:900}],records:[]}),now:()=>now})
  const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('Vary'),'Authorization');assert.match(response.headers.get('Cache-Control'),/no-store/)
  const data=await response.json();assert.equal(data.customers[0].lastContactAt,ago(10));assert.doesNotMatch(JSON.stringify(data),/supplier_cost|messages|attachments/)
 }
 const failure=createCustomerWorkbenchHandler({verifyToken:async()=>({uid:'u'}),getProfile:async()=>({role:'admin'}),load:async()=>{throw Error('private server error')}})
 const response=await failure(request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private server error/)
})
test('repository selects metadata only and paginates every source without fetching bodies',async()=>{
 const selections=[],reads=[]
 const target=name=>({select(...fields){selections.push([name,...fields]);return {orderBy(){return this},limit(){return this},startAfter(){return this},async get(){reads.push(name);return {size:0,docs:[]}}}}})
 const data=await loadCustomerActivity({collection:target,collectionGroup:target},()=> '__name__')
 assert.deepEqual(data,{customers:[],records:[]});assert.equal(reads.length,5)
 assert.ok(selections.every(s=>!s.includes('messages')&&!s.includes('attachments')))
})
