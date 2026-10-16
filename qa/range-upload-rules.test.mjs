// Emulator only. No production credentials, hosted sign-ins or live writes.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { ref, uploadString } from 'firebase/storage'
import { RANGE_UPLOAD_UID } from '../src/domain/rangeUpload.js'
if (!/^(localhost|127\.0\.0\.1):[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Explicit loopback emulator required')
const env = await initializeTestEnvironment({ projectId: 'demo-range-mcp', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }, storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') } })
after(() => env.cleanup())
const seed = async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async c => {
  const db=c.firestore()
  for (const [id, data] of Object.entries({owner:{role:'admin'},customer:{role:'customer',status:'approved'},[RANGE_UPLOAD_UID]:{role:'service',status:'approved',service_scope:'range-upload-v1',modules:[]}})) await setDoc(doc(db,`users/${id}`),data)
  for (const path of ['range_products/existing','range_components/existing','suppliers/private','products/private','client_quotes/private','range_upload_controls/service','range_upload_approvals/a','range_upload_receipts/r']) await setDoc(doc(db,path),{private:true})
}) }
const family = (db,id,key='9999-001') => { const b=writeBatch(db),[design_no,format_code]=key.split('-');b.set(doc(db,`range_products/${id}`),{design_no,format_code,status:'concept',active:false});b.set(doc(db,`range_family_claims/${key}`),{range_id:id,design_no,format_code,createdAt:serverTimestamp()});return b.commit() }
const component = (db,id,code) => {const b=writeBatch(db);b.set(doc(db,`range_components/${id}`),{code});b.set(doc(db,`range_component_claims/${code.replace(/[^A-Z0-9]/g,'')}`),{component_id:id,code,createdAt:serverTimestamp()});return b.commit()}
test('scoped identity denied direct catalogue/private writes, approvals, self escalation and storage, even misprofiled admin/customer',async()=>{
 await seed()
 for (const role of ['service','admin','staff','customer']) {
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`users/${RANGE_UPLOAD_UID}`),{role,status:'approved',modules:['supply','figurine','products'],customer_id:'private'}))
  const c=env.authenticatedContext(RANGE_UPLOAD_UID,{range_upload:true}),db=c.firestore()
  for(const path of ['range_products/existing','range_components/existing','suppliers/private','client_quotes/private','range_upload_controls/service','range_upload_approvals/a','range_upload_receipts/r']) {await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),{hijack:true}))}
  await assertFails(updateDoc(doc(db,`users/${RANGE_UPLOAD_UID}`),{role:'admin'}))
  for(const path of ['range_products/x/test.png',`customer_uploads/${RANGE_UPLOAD_UID}/test.png`,`renders/${RANGE_UPLOAD_UID}/test.png`]) await assertFails(uploadString(ref(c.storage(),path),'fixture'))
 }
})
test('admin atomic family claim; orphan/hijack claims and unreserved creates/identity moves rejected',async()=>{
 await seed();const db=env.authenticatedContext('owner').firestore()
 await assertSucceeds(family(db,'f1'))
 await assertFails(family(db,'f2'))
 await assertFails(setDoc(doc(db,'range_products/unreserved'),{design_no:'9998',format_code:'001'}))
 await assertFails(setDoc(doc(db,'range_family_claims/9997-001'),{range_id:'missing',design_no:'9997',format_code:'001',createdAt:serverTimestamp()}))
 await assertFails(updateDoc(doc(db,'range_products/f1'),{design_no:'9996'}))
 await assertSucceeds(updateDoc(doc(db,'range_products/f1'),{description:'Ordinary correction'}))
 await assertFails(updateDoc(doc(db,'range_family_claims/9999-001'),{range_id:'f2'}))
 await assertFails(family(env.authenticatedContext('customer').firestore(),'bad','9995-001'))
})
test('normal component writer shares punctuation reservation; no orphan/hijack or unreserved code change',async()=>{
 await seed();const c=env.authenticatedContext('owner'),db=c.firestore()
 await assertSucceeds(component(db,'p1','FM-GLB-H(G)'))
 await assertFails(component(db,'p2','FM-GLB-H-G'))
 await assertFails(setDoc(doc(db,'range_components/p2'),{code:'NEW'}))
 await assertFails(updateDoc(doc(db,'range_components/p1'),{code:'OTHER'}))
 await assertSucceeds(updateDoc(doc(db,'range_components/p1'),{stock_qty:10,unit_cost:3}))
 await assertSucceeds(uploadString(ref(c.storage(),'range_products/f1/fixture.png'),'fixture'))
})
