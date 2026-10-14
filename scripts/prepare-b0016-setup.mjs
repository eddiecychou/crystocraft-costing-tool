// Owner read-only preparation. No catalogue, approval or audit writes.
import { readFileSync, writeFileSync } from 'node:fs'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { handleMcpFigurineRange, identity, designDraft, ITEM_CODES, SOURCE_PRODUCT_ID, SOURCE_PARTS, RANGE_SERVICE_UID, encode } from '../netlify/edge-functions/lib/mcpFigurineRange.js'
import { approvalPlan, B0016_REUSE_ID } from '../netlify/edge-functions/lib/b0016ColourBom.js'
import { auditFmMigration } from './audit-b0016-fm-migration.mjs'
import { b0016ReleaseRules } from './b0016-release-rules.mjs'

export const DESIGN_REQUEST_ID='6939c061-6bb8-4c45-a9c0-3b063916d159'
export const BOM_REQUEST_ID='bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a'
if (!process.env.SA_KEY_PATH || !process.env.B0016_PREVIEW_DIR) throw Error('Owner key path and scratch preview directory required')
const key=JSON.parse(readFileSync(process.env.SA_KEY_PATH,'utf8'))
if(key.project_id!=='crystocraft-costing')throw Error('Unexpected project')
const app=initializeApp({credential:cert(key)},'b0016-setup-read-only')
const timestamp=v=>{const base=new Date(v.seconds*1000).toISOString().split('.')[0];const n=v.nanoseconds;return base+(n?'.'+String(n).padStart(9,'0').slice(0,n%1000000===0?3:n%1000===0?6:9):'')+'Z'}
const value=v=>v?.toDate?{timestampValue:timestamp(v)}:Array.isArray(v)?{arrayValue:{values:v.map(value)}}:v&&typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,value(x)]))}}:encode(v)
const fsDoc=d=>({name:`projects/crystocraft-costing/databases/(default)/documents/${d.ref.path}`,fields:Object.fromEntries(Object.entries(d.data()).map(([k,v])=>[k,value(v)])),updateTime:timestamp(d.updateTime)})
try {
 const db=getFirestore(app)
 const allowed=new Set(['settings/crystal_colors',`products/${SOURCE_PRODUCT_ID}`,`range_components/${B0016_REUSE_ID}`,...ITEM_CODES.map(c=>`range_sku_claims/${c}`)])
 for(const part of Object.values(SOURCE_PARTS)){const p=`products/${SOURCE_PRODUCT_ID}/components/${part.component_id}`;allowed.add(p);allowed.add(`${p}/supplier_quotes/${part.quote_id}`);allowed.add(`suppliers/${part.supplier_id}`)}
 let futureRange=null, writesAttempted=0
 const fetchImpl=async(url,options={})=>{
  if(url.endsWith(':commit')){writesAttempted++;throw Error('PRODUCTION WRITE FORBIDDEN')}
  if(url.endsWith(':runQuery')){const s=await db.collection('range_products').where('design_no','==','0016').get();return Response.json(s.docs.map(d=>({document:fsDoc(d)})))}
  if((options.method||'GET')!=='GET')throw Error('Only reads allowed')
  const path=new URL(url).pathname.split('/documents/')[1]
  if(futureRange&&path===`range_products/${futureRange.id}`)return Response.json({name:`projects/crystocraft-costing/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(futureRange.fields).map(([k,v])=>[k,value(v)])),updateTime:'{created_design_update_time}'})
  if(path===`range_components/${B0016_REUSE_ID}/supplier_quotes`){const s=await db.collection(path).get();return Response.json({documents:s.docs.map(fsDoc)})}
  if(!allowed.has(path))throw Error('Out of scope preparation read: '+path)
  const d=await db.doc(path).get();return d.exists?Response.json(fsDoc(d)):new Response('{}',{status:404})
 }
 const call=async(op,input)=>{const r=await handleMcpFigurineRange(new Request('https://portal.crystocraft.com/api/mcp-figurine-range',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,input})}),{projectId:'crystocraft-costing',authorize:async()=>({ok:true,uid:RANGE_SERVICE_UID,role:'staff'}),fetchImpl,writesEnabled:false});const d=await r.json();if(!r.ok||d.will_write!==false)throw Error(JSON.stringify(d));return d}
 const designPreview=await call('prepare_mezuzah_range_design',{item_codes:ITEM_CODES,dry_run:true})
 if(designPreview.conflicts.length)throw Error('Existing SKU/claim conflict')
 const acknowledge_warnings=[...new Set(designPreview.warnings.map(w=>w.code))].sort()
 const ids=await identity('range_design',DESIGN_REQUEST_ID,{item_codes:ITEM_CODES,acknowledge_warnings})
 if((await db.doc(`range_products/${ids.range_id}`).get()).exists)throw Error('Planned design ID exists; inspect before continuing')
 const design={...designDraft(),mcp_creator_uid:RANGE_SERVICE_UID,mcp_request_id:DESIGN_REQUEST_ID,mcp_request_hash:ids.hash}
 futureRange={id:ids.range_id,fields:design}
 const bom=await call('prepare_mezuzah_colour_bom',{range_id:ids.range_id,request_id:BOM_REQUEST_ID,dry_run:true})
 const usage=await auditFmMigration(db)
 if(usage.reference_count||usage.exact_code_conflicts.length||Object.values(usage.legacy_c1.child_counts).some(n=>n>0))throw Error('C1 usage/code/child conflict')
 const c1=await db.doc(`range_components/${B0016_REUSE_ID}`).get()
 // approvalPlan expects the same REST-decoded timestamp strings as the endpoint.
 const {decode}=await import('../netlify/edge-functions/lib/mcpFigurineRange.js')
 const c1Decoded={id:c1.id,updateTime:timestamp(c1.updateTime),...Object.fromEntries(Object.entries(fsDoc(c1).fields).map(([k,v])=>[k,decode(v)]))}
 const exact=approvalPlan(bom,c1Decoded,RANGE_SERVICE_UID)
 const designAudit={action:'create_mezuzah_range_design',service_principal:RANGE_SERVICE_UID,requested_by:'unknown',request_id:DESIGN_REQUEST_ID,request_hash:ids.hash,range_id:ids.range_id,source_product_id:SOURCE_PRODUCT_ID}
 const release={approved:false,service_principal:RANGE_SERVICE_UID,range_id:ids.range_id,design_request_id:DESIGN_REQUEST_ID,bom_request_id:BOM_REQUEST_ID,bom_hash:bom.request_hash,design_audit_id:ids.audit_id,design,design_audit:designAudit}
 const source=await db.doc(`products/${SOURCE_PRODUCT_ID}`).get()
 const result={mode:'READ-ONLY release preparation; future range simulated only for exact plan, not created',production_writes:0,writes_attempted:writesAttempted,created_at:new Date().toISOString(),source_concept:{id:source.id,active:source.data().active,status:source.data().status,update_time:timestamp(source.updateTime)},design:{range_id:ids.range_id,request_id:DESIGN_REQUEST_ID,hash:ids.hash,acknowledge_warnings,fields:design,records:8,audit:designAudit},bom,usage_audit:usage,c1_firestore_fields:fsDoc(c1).fields,private_release_control:release,private_bom_approval:exact,approval_documents_written:false,execution_sequence:['owner approval','release rules and endpoint','refresh usage/code/SKU audit','provision short-lived exact owner controls','MCP create design','fresh live BOM dry run and owner-bound exact approval','MCP atomic seven-component BOM','verify all records and retry IDs','revoke approval controls']}
 writeFileSync(`${process.env.B0016_PREVIEW_DIR}/final-plan.json`,JSON.stringify(result,null,2))
 writeFileSync(`${process.env.B0016_PREVIEW_DIR}/firestore.candidate.rules`,b0016ReleaseRules(readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')))
 console.log(JSON.stringify({range_id:ids.range_id,design_hash:ids.hash,bom_hash:bom.request_hash,c1_references:usage.reference_count,code_conflicts:usage.exact_code_conflicts.length,design_records:8,bom_records:bom.proposed.records.length,live_writes:0,preview:`${process.env.B0016_PREVIEW_DIR}/final-plan.json`}))
}finally{await deleteApp(app)}
