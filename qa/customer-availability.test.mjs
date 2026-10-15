import test from 'node:test'
import assert from 'node:assert/strict'
import { productAvailability } from '../src/availability.js'
import { projectAvailability, createAvailabilityHandler } from '../netlify/functions/lib/customerAvailability.js'
const product={status:'stock',active:true,variants:[{plating_code:'C'},{plating_code:'G'}],critical_components:[{id:'body',qty_per_unit:2},{id:'chrome',plating_code:'C'},{id:'gold',plating_code:'G'}],lead_time_weeks:2}
const parts=[{id:'body',code:'PRIVATE-BODY',stock_qty:100,reserved_qty:20,unit_cost:999,supplier_id:'SECRET-SUPPLIER'},{id:'chrome',code:'PRIVATE-C',stock_qty:30,reserved_qty:5},{id:'gold',code:'PRIVATE-G',stock_qty:10,reserved_qty:0}]
const now=()=>new Date('2026-10-15T06:00:00Z')
test('server returns exact shared admin availability, including reservations and finish limits',()=>{
 const admin=productAvailability(product,parts),out=projectAvailability(product,parts,{},now)
 assert.equal(out.verified,true);assert.equal(out.buildable,admin.buildable);assert.deepEqual(out.byPlating,admin.byPlating)
 assert.equal(out.byPlating.C,25);assert.equal(out.byPlating.G,10);assert.equal(out.buildable,35);assert.equal(out.leadWeeks,2)
})
test('short parts use procurement plus assembly lead time, without leaking bottleneck code',()=>{
 const p={...product,status:'active'},lib=parts.map(p=>({...p,stock_qty:0,lead_time_weeks:7}))
 const admin=productAvailability(p,lib),out=projectAvailability(p,lib,{},now)
 assert.equal(out.leadWeeks,9);assert.equal(out.leadWeeks,admin.leadWeeks)
 assert.match(admin.promise,/PRIVATE/);assert.doesNotMatch(out.customerPromise,/PRIVATE/)
})
test('response allowlist strips all costs, suppliers, bottlenecks and raw inventory records',()=>{
 const out=JSON.stringify(projectAvailability(product,parts,{},now))
 assert.doesNotMatch(out,/SECRET|PRIVATE|supplier|unit_cost|bottleneck|reserved_qty|stock_qty/)
 assert.deepEqual(Object.keys(JSON.parse(out)).sort(),['verified','status','buildable','finished','byPlating','byVariant','leadWeeks','effectiveMoq','customerPromise','checkedAt'].sort())
})
test('missing component cannot inflate availability or produce a false fast promise',()=>{
 const out=projectAvailability(product,parts.slice(1),{},now)
 assert.equal(out.verified,false);assert.equal(out.buildable,null);assert.equal(out.leadWeeks,null)
 assert.deepEqual(out.byPlating,{})
})
test('zero stock, concept and published note retain their distinct meaning',()=>{
 assert.equal(projectAvailability(product,parts.map(p=>({...p,stock_qty:0})),{},now).buildable,0)
 assert.match(projectAvailability({...product,status:'concept'},parts,{},now).customerPromise,/Concept/)
 assert.equal(projectAvailability({...product,delivery_note:'Customer production note'},parts,{},now).customerPromise,'Customer production note')
})
function fixture(overrides={}){
 const calls=[]
 const handler=createAvailabilityHandler({verifyToken:async token=>{if(token!=='valid')throw Error();return{uid:'qa'}},getProfile:async()=>({role:'customer',status:'approved'}),getProduct:async id=>{calls.push(id);return product},getComponents:async()=>parts,getDefaults:async()=>({}),now,...overrides})
 return{calls,handler,request:(data={productId:'public-product'},token='valid',method='POST')=>handler(new Request('https://example.test/api/customer-availability',{method,headers:token?{Authorization:`Bearer ${token}`}:{},...(method==='POST'?{body:JSON.stringify(data)}:{})}))}
}
test('anonymous/invalid tokens are rejected before product reads',async()=>{for(const token of ['', 'bad']){const f=fixture();assert.equal((await f.request(undefined,token)).status,401);assert.deepEqual(f.calls,[])}})
for(const profile of [{role:'customer',status:'pending'},{role:'customer',status:'disabled'},{role:'staff',modules:['supply']},null])test(`reject profile ${JSON.stringify(profile)}`,async()=>{const f=fixture({getProfile:async()=>profile});assert.equal((await f.request()).status,403);assert.deepEqual(f.calls,[])})
test('approved customer and admin get only private no-store projection',async()=>{for(const role of ['admin','customer']){const f=fixture({getProfile:async()=>({role,status:'approved'})});const response=await f.request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).productId,'public-product')}})
test('hidden, retired and missing products cannot be accessed by guessing an ID',async()=>{for(const p of [null,{...product,active:false},{...product,status:'retired'}]){const f=fixture({getProduct:async()=>p,getComponents:async()=>{throw Error('Must not read supply')}});assert.equal((await f.request()).status,404)}})
test('arbitrary document paths, oversized body and wrong method are rejected',async()=>{const f=fixture();assert.equal((await f.request({productId:'../suppliers/private'})).status,400);assert.equal((await f.request({productId:'x',padding:'x'.repeat(2100)})).status,400);assert.equal((await f.request(undefined,'valid','GET')).status,405);assert.deepEqual(f.calls,[])})
test('server failure returns no internal error data',async()=>{const f=fixture({getComponents:async()=>{throw Error('SECRET COST 999')}});const res=await f.request();assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/SECRET|999/)})

test('colour-specific quantities preserve shared-pool limits without publishing part identity',()=>{
 const p={status:'stock',variants:[{plating_code:'C',crystal_colors:['RED','BLUE']}],critical_components:[{id:'metal'},{id:'red',crystal_code:'RED'},{id:'blue',crystal_code:'BLUE'}]}
 const lib=[{id:'metal',code:'INTERNAL-METAL',stock_qty:10},{id:'red',code:'INTERNAL-RED',stock_qty:8},{id:'blue',code:'INTERNAL-BLUE',stock_qty:7}]
 const out=projectAvailability(p,lib,{},now)
 assert.equal(out.buildable,10);assert.equal(out.byVariant['C|RED'],8);assert.equal(out.byVariant['C|BLUE'],7)
 assert.doesNotMatch(JSON.stringify(out),/INTERNAL/)
})
