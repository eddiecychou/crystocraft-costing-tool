import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectCorporateProduct, createCustomerCatalogueHandler } from '../netlify/functions/lib/customerCatalogue.js'
import { createCustomerOrderHistoryHandler } from '../netlify/functions/lib/customerOrderHistory.js'
import { productFormFields, productFormPatch } from '../src/productFormFields.js'
import { pricingMigrationPlan } from '../netlify/functions/lib/accountPricingMigration.js'
import { projectCustomerActivity } from '../netlify/functions/lib/customerWorkbench.js'
import { quietCustomerIds } from '../src/dashboardWorkbench.js'
const req = (method='GET', body) => new Request('https://fictional.test/api/test', { method, headers: { Authorization:'Bearer fictional', 'Content-Type':'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}) })
const context = { verifyToken:async()=>({uid:'buyer'}), getProfile:async()=>({role:'customer',status:'approved',customer_id:'ours',erp_code:'ATTACK',sensitive:false}), getCustomer:async()=>({erp_code:'OUR_CODE',sensitive:true}) }
const product = { id:'p', name:'Fictional 玻璃 & Gift', active:true, description:'Specs', heroImage:'SECRET_URL', assembly_notes:'SECRET_NOTES', prices_signature:'SECRET_COSTS', arbitrary_private:'SECRET_DATA', videos:['https://youtube.com/watch?v=fictional'], blog_links:[{url:'https://example.test/story',label:'Story',private:'SECRET_LINK'}] }
const images = [{id:'private',visibility:'internal',file_url:'SECRET_URL'},{id:'other',visibility:'public',file_url:'SECRET_BRAND',branded_for_customer_id:'theirs'},{id:'ours',visibility:'private',file_url:'https://example.test/our.jpg',branded_for_customer_id:'ours',prompt:'SECRET_PROMPT'},{id:'generic',file_url:'https://example.test/generic.jpg',is_hero:true}]
const price = {markup:2.375,cost:99,tiers:[{quantity:100,price_hkd:12.345,lead_time_days:30,cost:5},{quantity:200,price_hkd:0}]}
test('catalogue projection omits internal fields, ineligible images and every markup while preserving precise selling price',()=>{
 const p=projectCorporateProduct(product,images,price,{customerId:'ours',sensitive:true})
 assert.deepEqual(p.images.map(im=>im.id),['generic','ours']);assert.equal(p.heroImage,'https://example.test/generic.jpg')
 assert.deepEqual(p.tiers,[{quantity:100,price_hkd:12.345,lead_time_days:30}]);assert.doesNotMatch(JSON.stringify(p),/SECRET|markup|storage_path|prices_signature/)
 assert.equal(projectCorporateProduct({...product,active:false},images,price,{}),null)
 assert.equal(projectCorporateProduct({...product,status:'discontinued'},images,price,{}),null)
 assert.equal(projectCorporateProduct({...product,heroImage:'SECRET_URL'},[],null,{}).heroImage,null)
 assert.equal(projectCorporateProduct(product,images,price,{sensitive:false}).images.length,3,'ordinary viewers retain eligible branded photos')
})
test('API verifies identity/status, derives sensitivity from company, serves only own pricing and filters featured photos',async()=>{
 let readUid
 const deps={...context,load:async(id,uid)=>{readUid=uid;return [{product,images,price}]},loadFeatured:async()=>({items:[{id:'f',product_id:'p',product_type:'corp_gift',image_url:'SECRET_URL'},{id:'g',product_id:'p',product_type:'corp_gift',image_url:images[2].file_url}]})}
 const response=await createCustomerCatalogueHandler(deps)(req());assert.equal(response.status,200);assert.equal(readUid,'buyer');assert.match(response.headers.get('cache-control'),/no-store/)
 const data=await response.json();assert.deepEqual(data.featured.items.map(i=>i.id),['g']);assert.doesNotMatch(JSON.stringify(data),/SECRET|markup/)
 for(const profile of [null,{role:'customer',status:'pending'},{role:'customer',status:'suspended'},{role:'staff',modules:[]},{role:'admin'}]){
  const r=await createCustomerCatalogueHandler({...deps,getProfile:async()=>profile,load:async()=>assert.fail('Denied reader reached data')})(req());assert.equal(r.status,403)
 }
 assert.equal((await createCustomerCatalogueHandler({...deps,verifyToken:async()=>{throw Error('private')}})(req())).status,401)
 assert.equal((await createCustomerCatalogueHandler(deps)(new Request('https://fictional.test'))).status,401)
 assert.equal((await createCustomerCatalogueHandler(deps)(req('POST'))).status,405)
 assert.equal((await createCustomerCatalogueHandler({...deps,load:async()=>{throw Error('SECRET')}})(req())).status,503)
})
test('ERP history never trusts mirrored profile code and blocks arbitrary invoice ownership',async()=>{
 const urls=[];const deps={...context,SUPABASE_URL:'https://erp.test',SERVICE_KEY:'fictional',fetcher:async url=>{urls.push(url);return Response.json(url.includes('code=eq.')&&!url.includes('customer_code')?[{customer_code:'OTHER'}]:[])}}
 const history=await createCustomerOrderHistoryHandler(deps)(req('POST'));assert.equal(history.status,200);assert.match(urls[0],/customer_code=eq.OUR_CODE/);assert.doesNotMatch(urls[0],/ATTACK/)
 urls.length=0
 const lines=await createCustomerOrderHistoryHandler({...deps,fetcher:async url=>{urls.push(url);return Response.json([{customer_code:'OTHER'}])}})(req('POST',{action:'lines',code:'FOREIGN'}))
 assert.equal(lines.status,404);assert.equal(urls.length,1)
 for(const customer of [null,{}, {erp_code:'SHARED',erp_code_shared:true}]){
  const result=await createCustomerOrderHistoryHandler({...deps,getCustomer:async()=>customer,fetcher:()=>assert.fail('Unlinked/shared must not query ERP')})(req('POST'))
  assert.equal(result.status,200);assert.deepEqual((await result.json()).rows,[])
 }
 const fail=await createCustomerOrderHistoryHandler({...deps,fetcher:async()=>new Response('private',{status:500})})(req('POST'));assert.equal(fail.status,503)
})
test('changed-field product save preserves gallery/publication updates and refuses same-field conflicts without modifying draft',()=>{
 const original={...product,active:true,name:'Original',status:'concept',video_url:'https://youtu.be/abcdef'}
 const baseline=productFormFields(original),draft={...baseline,name:'My draft'}
 const current={...original,active:false,heroImage:'New internal hero',prices_signature:'NEW',assembly_notes:'Updated by another operator'}
 assert.deepEqual(productFormPatch(baseline,draft,current),{name:'My draft'})
 assert.throws(()=>productFormPatch(baseline,draft,{...current,name:'Someone else'}),/draft has been kept/)
 assert.equal(draft.name,'My draft');assert.equal(current.heroImage,'New internal hero')
 assert.deepEqual(productFormPatch(baseline,draft,{...current,name:'My draft'}),{name:'My draft'})
 assert.throws(()=>productFormPatch(baseline,draft,null),/no longer exists/)
 assert.deepEqual(productFormPatch(baseline,baseline,current),{})
 assert.ok(!Object.hasOwn(productFormFields(original),'assembly_cost'))
})
test('pricing migration preserves exact settings, is idempotent and refuses divergent destinations',()=>{
 assert.deepEqual(pricingMigrationPlan({corp_markup_override:1.2345,pricing_group:'group-a',email:'preserved'}),{corp_markup_override:1.2345,pricing_group:'group-a'})
 assert.deepEqual(pricingMigrationPlan({}, {corp_markup_override:1.2345}),{})
 assert.throws(()=>pricingMigrationPlan({corp_markup_override:2},{corp_markup_override:3}),/Conflicting/)
})
test('linked lead communications update recent work and exclude quiet90; duplicate links and unrelated/private dates do not',()=>{
 const now=Date.parse('2026-11-12T00:00:00Z'),ago=d=>new Date(now-d*86400000).toISOString()
 const customers=[{id:'c',last_contacted:ago(120),linked_marketing_contact_ids:['lead','lead']}]
 const record={path:'marketing_contacts/lead/whatsapp_threads/one',date_range:[ago(2),ago(1)]}
 const records=[{path:'marketing_contacts/lead'},record,record,{path:'marketing_contacts/not-linked/email_threads/ignored',date_range:[ago(0),ago(0)]},{path:'marketing_contacts/lead/enquiries/note',channel:'Internal',date:ago(0)}]
 const rows=projectCustomerActivity(customers,records,now);assert.equal(rows[0].lastContactAt,ago(1));assert.equal(rows[0].historyState,'known');assert.equal(quietCustomerIds(rows,90,now).size,0)
 const missing=projectCustomerActivity(customers,[],now);assert.equal(missing[0].historyState,'partial');assert.equal(quietCustomerIds(missing,90,now).size,0)
 assert.equal(projectCustomerActivity(customers,[{path:'marketing_contacts/lead',lastOutreachAt:ago(3)}],now)[0].lastContactAt,ago(3))
})
