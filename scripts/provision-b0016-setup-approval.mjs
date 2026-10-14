// Reviewed owner-only approval controls, NOT a catalogue writer.
// Default is preview. --owner-approved plus both exact hashes is mandatory.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {initializeApp,cert,deleteApp} from 'firebase-admin/app'
import {getFirestore,Timestamp} from 'firebase-admin/firestore'
import {auditFmMigration} from './audit-b0016-fm-migration.mjs'
import {ITEM_CODES,SOURCE_PARTS,SOURCE_PRODUCT_ID,RANGE_SERVICE_UID,usedSkus,decode,encode} from '../netlify/edge-functions/lib/mcpFigurineRange.js'
const p=JSON.parse(readFileSync(`${process.env.B0016_PREVIEW_DIR}/final-plan.json`,'utf8'))
const controlPath='range_mcp_approvals/b0016_setup_release'
const bomPath=p.bom.approval_required.path
assert.match(bomPath,/^range_mcp_approvals\/mcp_range_[a-f0-9]{64}$/)
assert.equal(p.private_release_control.service_principal,RANGE_SERVICE_UID)
assert.equal(p.private_release_control.range_id,p.design.range_id)
assert.equal(p.private_release_control.bom_hash,p.bom.request_hash)
assert.equal(p.private_bom_approval.range_id,p.design.range_id)
assert.equal(p.bom.proposed.records.length,16)
if(!process.argv.includes('--owner-approved')){
 console.log(JSON.stringify({dry_run:true,will_write:false,approval_paths:[controlPath,bomPath],design_hash:p.design.hash,bom_hash:p.bom.request_hash,expires_minutes:30}));process.exit(0)
}
assert.equal(process.env.B0016_APPROVED_DESIGN_HASH,p.design.hash,'Owner-reviewed design hash required')
assert.equal(process.env.B0016_APPROVED_BOM_HASH,p.bom.request_hash,'Owner-reviewed BOM hash required')
const key=JSON.parse(readFileSync(process.env.SA_KEY_PATH,'utf8'));assert.equal(key.project_id,'crystocraft-costing')
const app=initializeApp({credential:cert(key)},'b0016-exact-owner-approval')
const stamp=v=>{const n=v.nanoseconds;return new Date(v.seconds*1000).toISOString().split('.')[0]+(n?'.'+String(n).padStart(9,'0').slice(0,n%1000000===0?3:n%1000===0?6:9):'')+'Z'}
const value=v=>v?.toDate?{timestampValue:stamp(v)}:Array.isArray(v)?{arrayValue:{values:v.map(value)}}:v&&typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,value(x)]))}}:encode(v)
const plain=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,decode(value(v))]))
try{
 const db=getFirestore(app)
 if(process.argv.includes('--close')){
  for(const path of [controlPath,bomPath]){
   const ref=db.doc(path),d=await ref.get()
   if(!d.exists)continue
   assert.equal(d.data().service_principal,RANGE_SERVICE_UID)
   assert.equal(d.data().range_id,p.design.range_id)
   await ref.update({approved:false,closed_at:Timestamp.now()})
  }
  console.log('Closed both exact B0016 approval controls. No catalogue records changed.');process.exitCode=0
 }else{
  const audit=await auditFmMigration(db)
  assert.equal(audit.reference_count,0);assert.equal(audit.exact_code_conflicts.length,0)
  assert.ok(Object.values(audit.legacy_c1.child_counts).every(n=>n===0))
  const c1=await db.doc('range_components/rc_mv7xu3mmayc5g').get()
  assert.deepEqual(plain(c1.data()),p.private_bom_approval.c1_before,'C1 changed since review')
  const source=await db.doc(`products/${SOURCE_PRODUCT_ID}`).get()
  assert.equal(stamp(source.updateTime),p.source_concept.update_time,'Corporate source changed since review')
  for(const [kind,part] of Object.entries(SOURCE_PARTS)){
   const q=await db.doc(`products/${SOURCE_PRODUCT_ID}/components/${part.component_id}/supplier_quotes/${part.quote_id}`).get()
   assert.equal(q.data().supplier_id,part.supplier_id);assert.equal(q.data().unit_cost,part.cost??part.working_cost);assert.equal(q.data().unit_cost_currency,'RMB');assert.equal(q.data().moq,part.moq)
   if(kind==='metal')assert.equal(q.data().tooling_sample_cost,2912)
  }
  const designs=await db.collection('range_products').select('design_no','design_code','format_code','variants','finishes').get()
  for(const d of designs.docs)if(d.id!==p.design.range_id)assert.ok(!usedSkus(d.data()).some(code=>ITEM_CODES.includes(code)),'Legacy SKU conflict')
  const expiry=Timestamp.fromMillis(Date.now()+30*60*1000)
  const approval={...p.private_bom_approval,c1_before:c1.data(),components:{...p.private_bom_approval.components,rc_mv7xu3mmayc5g:{...c1.data(),...p.bom.proposed.records.find(r=>r.path==='range_components/rc_mv7xu3mmayc5g').fields}},approved:true,expires_at:expiry,usage_review:{reference_count:0,code_conflict_count:0,child_record_count:0,c1_update_time:stamp(c1.updateTime),checked_at:Timestamp.now()}}
  // Only the two explicitly reviewed private control paths are writable here.
  await db.runTransaction(async tx=>{
   const refs=[db.doc(controlPath),db.doc(bomPath)],old=await tx.getAll(...refs)
   for(let i=0;i<old.length;i++)if(old[i].exists){assert.equal(old[i].data().range_id,p.design.range_id);assert.equal(old[i].data().service_principal,RANGE_SERVICE_UID)}
   tx.set(refs[0],{...p.private_release_control,approved:true,expires_at:expiry})
   tx.set(refs[1],approval)
  })
  console.log('Provisioned only two expiring, exact owner approval controls; no catalogue writes.')
 }
}finally{await deleteApp(app)}
