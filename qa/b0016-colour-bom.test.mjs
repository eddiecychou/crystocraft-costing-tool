import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { handleMcpFigurineRange, SOURCE_PRODUCT_ID, SOURCE_PARTS, RANGE_SERVICE_UID, encode, ITEM_CODES, designDraft } from '../netlify/edge-functions/lib/mcpFigurineRange.js'
import { B0016_REUSE_ID } from '../netlify/edge-functions/lib/b0016ColourBom.js'
import { bomRefApplies, serializedColourScope } from '../src/rangeBomScope.js'

const outfile = `/private/tmp/b0016-bom-test-${process.pid}.cjs`
await build({stdin:{contents:'export * from "./src/criticalComponents.js"; export * from "./src/rangeCosting.js"; export * from "./src/mrp.js"',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile,plugins:[{name:'no-live-firebase',setup(b){b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const db = {}',loader:'js'}))}}]})
const domain = createRequire(import.meta.url)(outfile)
const uuid = '70e51438-1e69-4ec1-a122-bd6e0621a023'
function fixture() {
  const docs = new Map(), calls = []
  docs.set(`products/${SOURCE_PRODUCT_ID}`,{active:false,status:'concept'})
  docs.set(`range_components/${B0016_REUSE_ID}`,{code:'P-CF003-C1',name:'mezuza水晶布',stock_qty:0,notes:'Owner notes',images:['owner-photo']})
  docs.set('settings/crystal_colors',{colors:[]})
  for(const [kind,part] of Object.entries(SOURCE_PARTS)){
    const path=`products/${SOURCE_PRODUCT_ID}/components/${part.component_id}`
    docs.set(path,{name:kind});docs.set(`${path}/supplier_quotes/${part.quote_id}`,{supplier_id:part.supplier_id,unit_cost:part.cost??part.working_cost,unit_cost_currency:'RMB',moq:part.moq,tooling_sample_cost:part.tooling??null});docs.set(`suppliers/${part.supplier_id}`,{name:kind})
  }
  const asDoc = (path,value) => ({name:`projects/test/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])),updateTime:'2026-10-14T00:00:00Z'})
  const fetchImpl = async(url,opts={})=>{
    calls.push({url,method:opts.method||'GET'})
    assert.ok(!url.endsWith(':commit'),'dry-run must never commit')
    if(url.endsWith(':runQuery'))return Response.json([])
    const path=new URL(url).pathname.split('/documents/')[1]
    if(path.endsWith('/supplier_quotes'))return Response.json({documents:[...docs].filter(([p])=>p.startsWith(path+'/')).map(([p,v])=>asDoc(p,v))})
    return docs.has(path)?Response.json(asDoc(path,docs.get(path))):new Response('{}',{status:404})
  }
  const call=async(extra={},authorize)=>{
    const req=new Request('https://portal.crystocraft.com/api/mcp-figurine-range',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'prepare_mezuzah_colour_bom',input:{request_id:uuid,dry_run:true,...extra}})})
    const result=await handleMcpFigurineRange(req,{fetchImpl,projectId:'test',authorize:authorize||(async()=>({ok:true,uid:RANGE_SERVICE_UID,role:'staff'}))})
    return {status:result.status,...await result.json()}
  }
  return {docs,calls,call}
}

test('colour dry run proposes six creates and reuses exact C1 without touching its fields',async()=>{
 const f=fixture(),before=JSON.stringify([...f.docs]);const r=await f.call()
 assert.equal(r.status,200);assert.equal(r.will_write,false);assert.equal(r.proposed.new_components,6);assert.equal(r.proposed.reused_components,1);assert.equal(r.proposed.new_quotes,7)
 assert.equal(r.proposed.critical_components.length,7);assert.equal(r.proposed.critical_components[3].id,B0016_REUSE_ID)
 assert.equal(r.proposed.records.filter(v=>v.path===`range_components/${B0016_REUSE_ID}`&&v.action==='create').length,0)
 assert.deepEqual(r.proposed.records.find(v=>v.path===`range_components/${B0016_REUSE_ID}`).fields.unit_cost,9)
 assert.equal(JSON.stringify([...f.docs]),before);assert.equal(r.proposed.screws,false);assert.equal(r.proposed.price_publishing,false)
 assert.equal(r.proposed.records.filter(v=>v.path.startsWith('range_products/'))[0].fields.unit_cost,undefined)
 assert.ok(r.proposed.records.filter(v=>v.path.includes('/supplier_quotes/')).every(v=>v.fields.source_provenance.product_id===SOURCE_PRODUCT_ID))
 const again=await f.call();assert.equal(r.request_hash,again.request_hash);assert.deepEqual(r.proposed.records,again.proposed.records)
})
test('authentication, unknown fields, invalid UUID and non-dry run fail closed',async()=>{
 const f=fixture()
 assert.equal((await f.call({},async()=>({ok:true,uid:'other',role:'staff'}))).status,403)
 assert.equal((await f.call({publish_prices:true})).status,400)
 assert.equal((await f.call({request_id:'bad'})).status,400)
 assert.equal((await f.call({dry_run:false})).status,400)
})
test('legacy two-component write cannot bypass the new colour-BOM preparation',async()=>{
 let attempted=false
 const response=await handleMcpFigurineRange(new Request('https://portal.crystocraft.com/api/mcp-figurine-range',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'create_mezuzah_range_components',input:{range_id:'mcp_range_'+ 'a'.repeat(32),metal_component_code:'FM-B0016BY00-G',fabric_component_code:'P-CF003-C1',request_id:uuid,approved:true,dry_run:false}})}),{projectId:'test',writesEnabled:true,legacyCodeAuditCertified:true,authorize:async()=>({ok:true,uid:RANGE_SERVICE_UID,role:'staff'}),fetchImpl:async()=>{attempted=true;throw Error('Unexpected write/read')}})
 assert.equal((await response.json()).error.code,'COLOUR_BOM_REVIEW_REQUIRED');assert.equal(attempted,false)
})
test('changed reuse code, assigned cost or existing quote blocks reuse instead of overwriting',async()=>{
 for(const change of ['code','cost','quote']){
   const f=fixture();if(change==='code')f.docs.get(`range_components/${B0016_REUSE_ID}`).code='P-CF002-C1'
   if(change==='cost')f.docs.get(`range_components/${B0016_REUSE_ID}`).unit_cost=99
   if(change==='quote')f.docs.set(`range_components/${B0016_REUSE_ID}/supplier_quotes/existing`,{unit_cost:9})
   assert.equal((await f.call()).ok,false)
 }
})
test('all six variants select metal plus exactly one colour; fees are not multiplied',async()=>{
 const r=await fixture().call(),refs=r.proposed.critical_components
 const lib=refs.map(v=>({id:v.id,code:v.code,unit_cost:v.crystal_code?9:11.3,unit_cost_currency:'RMB',tooling_sample_cost:v.crystal_code?null:2912,tooling_sample_cost_currency:'RMB',stock_qty:v.crystal_code?100:500}))
 const product={id:'p',...designDraft(),critical_components:refs}
 for(const v of product.variants){
   assert.equal(refs.filter(ref=>bomRefApplies(ref,lib.find(c=>c.id===ref.id),v)).length,2)
   assert.equal(domain.componentsCostHKD(product,lib,{RMB:1},100,v),20.3)
   assert.equal(domain.toolingHKD(product,lib,{RMB:1},v),2912)
   const mrp=domain.computeRequirements({lines:[{product_id:'p',item_code:v.sku,qty_ordered:10}],products:[product],lib})
   assert.equal(mrp.rows.length,2);assert.ok(mrp.rows.every(row=>row.required===10))
 }
 assert.throws(()=>domain.componentsCostHKD(product,lib,{RMB:1},100),/BOM_VARIANT_REQUIRED/)
 assert.throws(()=>domain.componentsCostHKD(product,lib,{RMB:1},100,{plating_code:'G',crystal_code:'ZZ'}),/BOM_COLOUR_COMPONENT_MISSING/)
 assert.equal(domain.buildableFromComponents(product,lib).qty,500)
 assert.equal(domain.buildableFromComponents(product,lib).byVariant['G|VL'],100)
 assert.equal(domain.buildableFromComponents(product,lib).byPlating.G,500)
 assert.deepEqual(serializedColourScope(refs[3]),{crystal_code:'C1'})
 assert.deepEqual(serializedColourScope({}),{})
 assert.equal(bomRefApplies({all_variants:true,crystal_code:'BK'},{},{plating_code:'G',crystal_code:'BL'}),false)
})
test('legacy uncoloured plating BOM keeps its existing cost and stock behaviour',()=>{
 const lib=[{id:'m',code:'M',unit_cost:1,unit_cost_currency:'RMB',stock_qty:40},{id:'g',code:'G',unit_cost:2,unit_cost_currency:'RMB',plating_code:'G',stock_qty:20}]
 const product={critical_components:[{id:'m',qty_per_unit:1},{id:'g',qty_per_unit:1}],variants:[{plating_code:'G'}]}
 assert.equal(domain.componentsCostHKD(product,lib,{RMB:1},1,{plating_code:'G'}),3)
 assert.equal(domain.buildableFromComponents(product,lib).qty,20)
})
