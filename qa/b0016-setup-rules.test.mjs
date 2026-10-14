// Exact candidate release only, emulator. No production credentials or writes.
import {readFileSync} from 'node:fs'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,writeBatch,updateDoc,serverTimestamp,Timestamp} from 'firebase/firestore'
import {b0016ReleaseRules} from '../scripts/b0016-release-rules.mjs'
const p=JSON.parse(readFileSync('/private/tmp/b0016-end-to-end-release/final-plan.json','utf8'))
const source=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')
const env=await initializeTestEnvironment({projectId:'crystocraft-b0016-setup-candidate',firestore:{rules:b0016ReleaseRules(source)}})
const uid=p.private_release_control.service_principal,range=p.design.range_id
const db=env.authenticatedContext(uid,{figurine_range_writer:true}).firestore()
let passed=0,failed=0
const timestamp=s=>{const seconds=Math.floor(Date.parse(s)/1000),fraction=(s.match(/\.(\d+)Z$/)?.[1]||'').padEnd(9,'0');return new Timestamp(seconds,Number(fraction))}
const restore=(v,key='')=>Array.isArray(v)?v.map(x=>restore(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,restore(x,k)])):['updatedAt','createdAt'].includes(key)&&typeof v==='string'&&/^\d{4}-/.test(v)?timestamp(v):v
const expiry=()=>Timestamp.fromMillis(Date.now()+1800000)
async function seed(control={}){
 await env.clearFirestore()
 await env.withSecurityRulesDisabled(async c=>{
  const a=c.firestore()
  await setDoc(doc(a,`users/${uid}`),{role:'staff',modules:[],service_scope:'figurine-range-b0016'})
  await setDoc(doc(a,'range_mcp_approvals/b0016_setup_release'),{...p.private_release_control,approved:true,expires_at:expiry(),...control})
  await setDoc(doc(a,'range_components/rc_mv7xu3mmayc5g'),restore(p.private_bom_approval.c1_before))
  await setDoc(doc(a,`range_mcp_approvals/${p.bom.proposed.records.at(-1).path.split('/')[1]}`),{...restore(p.private_bom_approval),approved:true,expires_at:expiry(),usage_review:{reference_count:0,code_conflict_count:0,child_record_count:0,checked_at:Timestamp.now(),c1_update_time:'fixture'}})
 })
}
function design(mutate=()=>{}){
 const b=writeBatch(db),d=structuredClone(p.design.fields);mutate(d)
 b.set(doc(db,`range_products/${range}`),{...d,createdAt:serverTimestamp()})
 for(const item_code of d.variants.map(v=>v.sku))b.set(doc(db,`range_sku_claims/${item_code}`),{item_code,range_id:range,service_principal:uid,createdAt:serverTimestamp()})
 b.set(doc(db,`range_mcp_audit/${p.design.audit&&p.private_release_control.design_audit_id}`),{...p.design.audit,at:serverTimestamp()})
 return b.commit()
}
function bom(mutate=()=>{}){
 const rs=structuredClone(p.bom.proposed.records);mutate(rs);const b=writeBatch(db)
 for(const r of rs){if(r.action==='create')b.set(doc(db,r.path),{...r.fields,[r.path.startsWith('range_mcp_audit/')?'at':'createdAt']:serverTimestamp()});else b.update(doc(db,r.path),r.fields)}
 return b.commit()
}
async function check(label,fn){try{await seed();await fn();passed++;console.log('ok '+label)}catch(e){failed++;console.error('FAIL '+label+': '+e.message)}}
await check('exact planned missing design readable for create',()=>assertSucceeds(getDoc(doc(db,`range_products/${range}`))))
await check('unplanned missing design denied',()=>assertFails(getDoc(doc(db,'range_products/mcp_range_'+ 'f'.repeat(32)))))
await check('owner-approved exact design and seven-component bundle accepted',async()=>{await assertSucceeds(design());await assertSucceeds(bom());const r=(await getDoc(doc(db,`range_products/${range}`))).data();if(r.active!==false||r.variants.length!==6||r.critical_components.length!==7)throw Error('Wrong counts');if((await getDoc(doc(db,'range_components/rc_mv7xu3mmayc5g'))).data().code!=='FM-CF003-C1')throw Error('Wrong C1 code')})
for(const [label,change] of [['activation',d=>d.active=true],['selling price',d=>d.price_hkd=62],['cost leakage',d=>d.description='RMB 11.30 supplier cost'],['changed SKU',d=>d.variants[0].sku='B0016-000-GXX'],['wrong request UUID',d=>d.mcp_request_id='other']])await check('design '+label+' denied',()=>assertFails(design(change)))
await check('missing release control denies design',async()=>{await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'range_mcp_approvals/b0016_setup_release'),{approved:false}));await assertFails(design())})
await check('expired release control denies design',async()=>{await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'range_mcp_approvals/b0016_setup_release'),{expires_at:Timestamp.fromMillis(Date.now()-1)}));await assertFails(design())})
await check('orphan claim denied even during release',()=>assertFails(setDoc(doc(db,'range_sku_claims/B0016-000-GBK'),{item_code:'B0016-000-GBK',range_id:range,service_principal:uid,createdAt:serverTimestamp()})))
await check('missing quote atomically rejects whole BOM',async()=>{await assertSucceeds(design());await assertFails(bom(rs=>rs.splice(rs.findIndex(r=>r.path.includes('/supplier_quotes/')),1)));if((await getDoc(doc(db,'range_components/rc_mv7xu3mmayc5g'))).data().code!=='P-CF003-C1')throw Error('Partial rename')})
await check('service cannot self-approve release',()=>assertFails(updateDoc(doc(db,'range_mcp_approvals/b0016_setup_release'),{approved:true})))
await check('revoked control denies all new BOM writes',async()=>{await assertSucceeds(design());await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'range_mcp_approvals/b0016_setup_release'),{approved:false}));await assertFails(bom())})
await check('repeat raw write denied after complete setup',async()=>{await assertSucceeds(design());await assertSucceeds(bom());await assertFails(design());await assertFails(bom())})
await check('mismatched BOM hash in release denies bundle',async()=>{await assertSucceeds(design());await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'range_mcp_approvals/b0016_setup_release'),{bom_hash:'f'.repeat(64)}));await assertFails(bom())})
await check('legacy arbitrary component path remains denied during release',()=>assertFails(setDoc(doc(db,'range_components/mcp_b0016_m_'+ 'a'.repeat(20)),{code:'UNREVIEWED',mcp_creator_uid:uid})))
await check('customer-readable design contains no supplier data',async()=>{
 await assertSucceeds(design());await assertSucceeds(bom())
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users/approved-customer'),{role:'customer',status:'approved'}))
 const customer=env.authenticatedContext('approved-customer').firestore()
 const d=(await getDoc(doc(customer,`range_products/${range}`))).data()
 if(d.critical_components.some(c=>c.unit_cost!==undefined||c.supplier_id!==undefined)||d.variants.some(v=>v.ws_price_usd!==null))throw Error('Supplier/price leakage')
 await assertFails(getDoc(doc(customer,'range_components/rc_mv7xu3mmayc5g')))
})
await env.cleanup()
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed?1:0)
