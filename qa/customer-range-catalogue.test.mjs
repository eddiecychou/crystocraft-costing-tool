import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerCatalogueHandler } from '../netlify/functions/lib/customerCatalogue.js'
import { loadCustomerRange } from '../netlify/functions/lib/customerRange.js'
import { resolveRangeSelection } from '../src/domain/customerRangeSelection.js'

const v = {sku:'QA-C', plating_name:'Chrome', ws_price_usd:12.125, supplier:'PRIVATE',
  crystal_colors:['RED'], colour_images:{RED:'red.jpg', REMOVED:'PRIVATE'}, image:'visible.jpg'}
const visible = {active:true,status:'stock',design_code:'QA',gallery:[{url:'ok.jpg',caption:'QA',cost:'PRIVATE'}],
  variants:[v], costing:{markup:'PRIVATE'},packing:{pcs_per_carton:12,supplier:'PRIVATE'},notes:'PRIVATE'}
const docs = {visible,legacy:{design_code:'QA0',finishes:[{finish_name:'Gold',ws_price_usd:4}]},
  hidden:{...visible,active:false,design_name:'PRIVATE'},retired:{...visible,status:'retired'},unpriced:{...visible,variants:[{ws_price_usd:null}]}}
const snapshot = id => ({id,data:()=>docs[id]})
const db = { collection: () => ({doc: id=>({get:async()=>snapshot(id)}),orderBy:()=>({get:async()=>({docs:Object.keys(docs).map(snapshot)})})}) }
const pick = (id,image_url) => ({id,product_id:id,product_type:'range',image_url})
async function request(params, profile = {role:'customer',status:'approved',ws_discount_pct:125}) {
  const handler = createCustomerCatalogueHandler({
    verifyToken:async()=>({uid:'buyer'}), getProfile:async()=>profile,
    loadRange:(id, viewer)=>loadCustomerRange(db,id,viewer),load:async()=>[],
    loadFeatured:async()=>({items:[pick('hidden','PRIVATE'),pick('retired','ok.jpg'),pick('visible','outdated.jpg'),pick('visible','ok.jpg')]})
  })
  return handler(new Request('https://example.test/api/customer-catalogue'+params,{headers:{authorization:'Bearer fixture'}}))
}
test('Range list and detail project only published data and buyer-adjusted selling prices', async()=>{
  const list = await (await request('?range=1')).json()
  assert.deepEqual(list.products.map(p=>p.id),['visible','legacy','unpriced'])
  assert.doesNotMatch(JSON.stringify(list),/PRIVATE|markup|costing|ws_price_usd|supplier/)
  const p = (await (await request('?range=1&id=visible')).json()).products[0]
  assert.deepEqual(p,list.products[0])
  assert.equal(p.variants[0].customer_price_usd,15.15625)
  assert.equal(list.products[1].variants[0].customer_price_usd,5)
  assert.equal(list.products[2].variants[0].customer_price_usd,null)
  for(const id of ['hidden','retired','missing']) assert.deepEqual((await (await request('?range=1&id='+id)).json()).products,[])
  for(const status of ['pending','suspended']) assert.equal((await request('?range=1',{role:'customer',status})).status,403)
  const other = await (await request('?range=1&id=visible',{role:'customer',status:'approved',ws_discount_pct:80})).json()
  assert.equal(other.products[0].variants[0].customer_price_usd,12.125 * 0.8)
  const line={id:'visible',finish:'Chrome',color:'RED',ws_price_usd:999}
  assert.equal(resolveRangeSelection(line,list.products).customer_price_usd,15.15625)
  assert.equal(resolveRangeSelection({...line,id:'hidden'},list.products),null)
})
test('featured picks use current visibility and current Range images',async()=>{
 const result=await (await request('')).json()
 assert.deepEqual(result.featured.items.map(i=>i.image_url),['ok.jpg'])
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|outdated|retired|hidden/)
})

test('enquiry units, legacy drafts, and finish/colour limits', async () => {
  const {rangeOrderMode, quantityIssue, stockLimit} = await import('../src/domain/enquiryQuantity.js')
  const stock = {status:'stock', qty:5, pcs_per_carton:24, cartons:1, plating_code:'C', color:'RED'}
  const available = {verified:true, buildable:30, byPlating:{C:12}, byVariant:{'C|RED':5}}
  assert.equal(rangeOrderMode(stock),'stock')
  assert.equal(quantityIssue(stock, available),'')
  assert.match(quantityIssue({...stock, qty:6}, available),/Only 5/)
  assert.equal(stockLimit({...stock, color:'BLUE'}, available),0)
  assert.equal(stockLimit(stock, {...available,verified:false}),null)
  const first = {...stock, id:'design', type:'figurine', qty:4}
  const shared = {...available, byVariant:{}, buildable:6}
  assert.match(quantityIssue(first, shared, [first, {...first, qty:3}]), /Only 3/)
  const oldActive = {...stock, status:'active'}
  assert.match(quantityIssue(oldActive, available),/Choose how/)
  const cartons = {...oldActive, order_mode:'mto', qty:48, cartons:2}
  assert.equal(quantityIssue(cartons, null),'')
  assert.match(quantityIssue({...cartons, qty:25},null),/confirm the number/)
  assert.match(quantityIssue({...cartons, pcs_per_carton:0},null),/needs confirmation/)
  assert.equal(quantityIssue({...stock, status:'concept'},null),'')
})
