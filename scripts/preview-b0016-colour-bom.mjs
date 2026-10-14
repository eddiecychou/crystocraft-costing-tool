// Privileged read-only owner review. Never provisions credentials or commits.
import { readFileSync } from 'node:fs'
import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { handleMcpFigurineRange, ITEM_CODES, SOURCE_PRODUCT_ID, SOURCE_PARTS, RANGE_SERVICE_UID, encode, usedSkus, designDraft } from '../netlify/edge-functions/lib/mcpFigurineRange.js'
import { B0016_REUSE_ID, B0016_FABRIC_CODES, B0016_METAL_CODE } from '../netlify/edge-functions/lib/b0016ColourBom.js'

if (!process.env.SA_KEY_PATH) throw Error('Supply an existing owner credential path, not a new service identity')
const key = JSON.parse(readFileSync(process.env.SA_KEY_PATH, 'utf8'))
if (key.project_id !== 'crystocraft-costing') throw Error('Unexpected project')
const app = initializeApp({credential:cert(key)},'b0016-final-read-only-preview')
const request_id = '70e51438-1e69-4ec1-a122-bd6e0621a023'
try {
 const db=getFirestore(app)
 const [designs,components]=await Promise.all([db.collection('range_products').select('design_no','design_code','format_code','variants','finishes').get(),db.collection('range_components').select('code','name').get()])
 const codes=[B0016_METAL_CODE,...B0016_FABRIC_CODES]
 const collisions=components.docs.filter(d=>codes.includes(String(d.data().code||'').trim().toUpperCase())&&d.id!==B0016_REUSE_ID).map(d=>({id:d.id,...d.data()}))
 const skuCollisions=designs.docs.flatMap(d=>usedSkus(d.data()).filter(sku=>ITEM_CODES.includes(sku)).map(sku=>({range_id:d.id,sku})))
 const allowed=new Set(['settings/crystal_colors',`products/${SOURCE_PRODUCT_ID}`,`range_components/${B0016_REUSE_ID}`,...ITEM_CODES.map(c=>`range_sku_claims/${c}`)])
 for(const part of Object.values(SOURCE_PARTS)){
   const p=`products/${SOURCE_PRODUCT_ID}/components/${part.component_id}`
   allowed.add(p);allowed.add(`${p}/supplier_quotes/${part.quote_id}`);allowed.add(`suppliers/${part.supplier_id}`)
 }
 let writeAttempts=0
 const fsDoc=d=>({name:`projects/crystocraft-costing/databases/(default)/documents/${d.ref.path}`,fields:Object.fromEntries(Object.entries(d.data()).map(([k,v])=>[k,encode(v)])),updateTime:d.updateTime.toDate().toISOString()})
 const fetchImpl=async(url,options={})=>{
   if(url.endsWith(':commit')){writeAttempts++;throw Error('WRITES FORBIDDEN')}
   if(url.endsWith(':runQuery')){
     const snap=await db.collection('range_products').where('design_no','==','0016').get()
     return Response.json(snap.docs.map(d=>({document:fsDoc(d)})))
   }
   if((options.method||'GET')!=='GET')throw Error('Only reads supported')
   const path=new URL(url).pathname.split('/documents/')[1]
   if(path===`range_components/${B0016_REUSE_ID}/supplier_quotes`){const snap=await db.collection(path).get();return Response.json({documents:snap.docs.map(fsDoc)})}
   if(!allowed.has(path))throw Error('Out of scope read')
   const d=await db.doc(path).get();return d.exists?Response.json(fsDoc(d)):new Response('{}',{status:404})
 }
 const response=await handleMcpFigurineRange(new Request('https://portal.crystocraft.com/api/mcp-figurine-range',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'prepare_mezuzah_colour_bom',input:{request_id,dry_run:true}})}),{projectId:'crystocraft-costing',fetchImpl,writesEnabled:false,authorize:async()=>({ok:true,uid:RANGE_SERVICE_UID,role:'staff'})})
 const result=await response.json()
 if(!response.ok||writeAttempts||result.will_write!==false)throw Error(JSON.stringify(result))
 console.log(JSON.stringify({mode:'Local implemented preparation handler using scoped read-only owner bridge; NOT deployed MCP or production-RBAC verification',read_only:true,production_writes:0,scan:{range_products:designs.size,range_components:components.size},legacy_audit:{component_conflicts:collisions,sku_conflicts:skuCollisions,certification_written:false},proposed_design:designDraft(),...result},null,2))
}finally{await deleteApp(app)}
