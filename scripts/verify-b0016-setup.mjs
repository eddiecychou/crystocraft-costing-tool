// Read-only post-write verifier. Uses the dedicated scoped ID token, not Admin.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {decode,ITEM_CODES,SOURCE_PRODUCT_ID} from '../netlify/edge-functions/lib/mcpFigurineRange.js'
import {bomRefApplies} from '../src/rangeBomScope.js'
if(!process.env.B0016_MCP_AUTH_MODULE||!process.env.B0016_PREVIEW_DIR)throw Error('Persistent MCP auth module and reviewed plan directory required')
const {getRangeIdToken}=await import(process.env.B0016_MCP_AUTH_MODULE)
const token=await getRangeIdToken(),p=JSON.parse(readFileSync(`${process.env.B0016_PREVIEW_DIR}/final-plan.json`,'utf8'))
const base='https://firestore.googleapis.com/v1/projects/crystocraft-costing/databases/(default)/documents/'
async function get(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200,'Cannot verify '+path);const d=await r.json();return {fields:Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)])),updateTime:d.updateTime}}
const range=(await get(`range_products/${p.design.range_id}`)).fields
assert.equal(range.active,false);assert.equal(range.status,'concept')
assert.deepEqual(range.variants.map(v=>v.sku),ITEM_CODES)
assert.ok(range.variants.every(v=>v.ws_price_usd===null))
assert.equal(range.critical_components.length,7)
for(const forbidden of ['price','price_hkd','unit_cost','supplier_id','supplier_notes'])assert.equal(range[forbidden],undefined)
const components=[],quotes=[]
for(const record of p.bom.proposed.records){
 const actual=await get(record.path)
 for(const [k,v] of Object.entries(record.fields))assert.deepEqual(actual.fields[k],v,record.path+': '+k)
 if(record.path.split('/').length===2&&record.path.startsWith('range_components/'))components.push({id:record.path.split('/')[1],...actual.fields})
 if(record.path.includes('/supplier_quotes/'))quotes.push(actual.fields)
}
assert.equal(components.length,7);assert.equal(quotes.length,7)
const variants=range.variants.map(v=>{const selected=range.critical_components.filter(ref=>bomRefApplies(ref,components.find(c=>c.id===ref.id),v));assert.equal(selected.length,2);assert.ok(selected.some(c=>c.code==='FM-B0016BY00-G'));assert.ok(selected.some(c=>c.code==='FM-CF003-'+v.crystal_code));return {item_code:v.sku,component_codes:selected.map(c=>c.code)}})
const metal=quotes.find(q=>!q.crystal_code);assert.equal(metal.unit_cost,11.3);assert.equal(metal.moq,500);assert.equal(metal.tooling_sample_cost,2912)
assert.equal(quotes.filter(q=>q.tooling_sample_cost===2912).length,1)
for(const q of quotes.filter(q=>q.crystal_code)){assert.equal(q.unit_cost,9);assert.equal(q.source_unit_cost,8.1);assert.equal(q.moq,100);assert.equal(q.unit_cost_currency,'RMB');assert.ok(q.notes.includes('RMB 8.10'));assert.equal(q.source_provenance.product_id,SOURCE_PRODUCT_ID)}
const c1=components.find(c=>c.id==='rc_mv7xu3mmayc5g'),expected={...p.private_bom_approval.c1_before,...p.bom.proposed.records.find(r=>r.path==='range_components/rc_mv7xu3mmayc5g').fields}
for(const [k,v] of Object.entries(expected))assert.deepEqual(c1[k],v,'C1 preserved field '+k)
for(const item_code of ITEM_CODES){const claim=(await get(`range_sku_claims/${item_code}`)).fields;assert.equal(claim.range_id,p.design.range_id);assert.equal(claim.item_code,item_code)}
const source=await get(`products/${SOURCE_PRODUCT_ID}`);assert.equal(source.updateTime,p.source_concept.update_time,'Corporate source was modified');assert.equal(source.fields.active,false);assert.equal(source.fields.status,'concept')
const designAudit=(await get(`range_mcp_audit/${p.private_release_control.design_audit_id}`)).fields
assert.equal(designAudit.request_hash,p.design.hash);assert.equal(designAudit.service_principal,p.private_release_control.service_principal)
console.log(JSON.stringify({ok:true,range_id:p.design.range_id,edit_url:`https://portal.crystocraft.com/range/${p.design.range_id}`,variants:variants.length,components:components.length,quotes:quotes.length,variant_mapping:variants,c1_id_preserved:true,source_concept_unchanged:true,active:false,selling_price_published:false,screws:false,read_only:true},null,2))
