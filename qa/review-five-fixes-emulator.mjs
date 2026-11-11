import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, runTransaction } from 'firebase/firestore'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
import { migrateAccountPricing } from '../netlify/functions/lib/accountPricingMigration.js'
import { approveLegacyAccount } from '../netlify/functions/lib/approveLegacyAccount.js'
import { loadCorporateCatalogue, projectCorporateProduct } from '../netlify/functions/lib/customerCatalogue.js'
import { loadCustomerActivity, projectCustomerActivity } from '../netlify/functions/lib/customerWorkbench.js'
import { productFormFields, productFormPatch } from '../src/productFormFields.js'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '',/^(127\.0\.0\.1|localhost):\d+$/,'Loopback emulator required; live writes forbidden')
const projectId='crystocraft-rbac-test',id='five-fixes-qa',app=initializeApp({projectId},id),db=getFirestore(app)
let env
before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync('firestore.rules','utf8')}})
 await db.doc('users/'+id).set({role:'customer',status:'approved',customer_id:id,ws_discount_pct:0})
 await db.doc('users/'+id+'-admin').set({role:'admin'})
 await db.doc('customers/'+id).set({company_name:'Fictional company',erp_code:'SAFE',sensitive:true,linked_marketing_contact_ids:[id+'-lead',id+'-lead']})
 await db.doc('products/'+id).set({name:'Fictional gift',status:'concept',active:true,assembly_notes:'PRIVATE-NOTES',heroImage:'PRIVATE-IMAGE'})
 await db.doc(`products/${id}/images/internal`).set({file_url:'PRIVATE-IMAGE',visibility:'internal'})
 await db.doc(`products/${id}/images/public`).set({file_url:'https://example.test/fictional.jpg',visibility:'public'})
 await db.doc(`products/${id}/customer_prices/${id}`).set({markup:2.2345,tiers:[{quantity:100,price_hkd:13.37,lead_time_days:30}]})
 await db.doc('account_pricing/'+id).set({corp_markup_override:2.2345})
})
after(async()=>{await env?.cleanup();await db.terminate();await deleteApp(app)})
test('real rules deny signup identity injection, invitation bypass, raw product/image/price access and private account pricing',async()=>{
 const user=env.authenticatedContext(id).firestore(), pending=env.authenticatedContext(id+'-new').firestore()
 const safe={role:'customer',status:'pending',ws_discount_pct:0,company_name:'Fictional'}
 for(const patch of [{erp_code:'FOREIGN'},{erp_code_shared:false},{customer_id:'foreign'},{account_type:'internal'},{invitation_id:'forged'},{modules:['pricing']},{corp_markup_override:1.5},{pricing_group:'privileged'},{status:'approved'}])await assertFails(setDoc(doc(pending,'users',id+'-new'),{...safe,...patch}))
 await assertSucceeds(setDoc(doc(pending,'users',id+'-new'),safe))
 for(const patch of [{status:'approved'},{invitation_id:'forged'},{account_type:'internal'},{customer_id:'foreign'},{erp_code:'foreign'},{corp_markup_override:1.5}])await assertFails(updateDoc(doc(pending,'users',id+'-new'),patch))
 await assertSucceeds(updateDoc(doc(user,'users',id),{login_count:1,last_login_at:new Date()}))
 for(const path of [`products/${id}`,`products/${id}/images/internal`,`products/${id}/images/public`,`products/${id}/customer_prices/${id}`,`products/${id}/pricing_tiers/any`,`account_pricing/${id}`,'settings/front_page'])await assertFails(getDoc(doc(user,path)))
 await assertFails(getDocs(collection(user,'products')))
 const admin=env.authenticatedContext(id+'-admin').firestore()
 await assertSucceeds(getDoc(doc(admin,'products',id)));await assertSucceeds(getDoc(doc(admin,'account_pricing',id)))
 const records=await loadCorporateCatalogue(db,id,id),p=projectCorporateProduct(records[0].product,records[0].images,records[0].price,{customerId:id,sensitive:true})
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE|markup/);assert.equal(p.tiers[0].price_hkd,13.37);assert.equal(p.images.length,1)
})
test('legacy approval replaces forged mirrored ERP identity, retains unrelated fields and supports unlinked existing accounts',async()=>{
 const uid=id+'-legacy',ref=db.doc('users/'+uid)
 await ref.set({role:'customer',status:'pending',erp_code:'FOREIGN',sensitive:false,contact_name:'Preserved'})
 await approveLegacyAccount(db,uid,id)
 assert.equal((await ref.get()).data().erp_code,'SAFE');assert.equal((await ref.get()).data().contact_name,'Preserved')
 await approveLegacyAccount(db,uid,null)
 assert.equal((await ref.get()).data().erp_code,'');assert.equal((await ref.get()).data().status,'approved')
 await ref.update({invitation_id:'claimed',status:'pending'})
 await assert.rejects(approveLegacyAccount(db,uid,id),/invitation/)
})
test('pricing migration copies exact values atomically, leaves other fields intact, is idempotent and refuses conflicts',async()=>{
 const uid=id+'-migration',ref=db.doc('users/'+uid),target=db.doc('account_pricing/'+uid)
 const original={role:'customer',status:'approved',corp_markup_override:1.23456,pricing_group:'group_02',notes:'Preserved',contact_id:'unchanged'}
 await ref.set(original)
 assert.equal(await migrateAccountPricing(db,uid),true);assert.deepEqual((await ref.get()).data(),original);assert.equal((await target.get()).exists,false)
 const options={apply:true,deleteField:()=>FieldValue.delete(),timestamp:()=>FieldValue.serverTimestamp()}
 assert.equal(await migrateAccountPricing(db,uid,options),true)
 const data=(await ref.get()).data();assert.deepEqual(data,{role:'customer',status:'approved',notes:'Preserved',contact_id:'unchanged'})
 const privateData=(await target.get()).data();assert.equal(privateData.corp_markup_override,1.23456);assert.equal(privateData.pricing_group,'group_02');assert.deepEqual(privateData.legacy_profile_pricing,{corp_markup_override:1.23456,pricing_group:'group_02'})
 assert.equal(await migrateAccountPricing(db,uid,options),false)
 await ref.update({corp_markup_override:99});await assert.rejects(migrateAccountPricing(db,uid,options),/Conflicting/);assert.equal((await ref.get()).data().corp_markup_override,99)
})
test('real SDK product transaction preserves publication/gallery and refuses a conflicting draft',async()=>{
 const client=env.authenticatedContext(id+'-admin').firestore(),ref=doc(client,'products',id),baseline=productFormFields((await getDoc(ref)).data()),draft={...baseline,name:'New draft name'}
 await db.doc('products/'+id).update({active:false,heroImage:'Internal new image',heroImage_visibility:'internal'})
 async function save(form){await runTransaction(client,async tx=>{const s=await tx.get(ref);tx.update(ref,productFormPatch(baseline,form,s.data()))})}
 await save(draft);let stored=(await getDoc(ref)).data();assert.equal(stored.active,false);assert.equal(stored.heroImage,'Internal new image');assert.equal(stored.assembly_notes,'PRIVATE-NOTES')
 await assert.rejects(save({...draft,name:'Different draft'}),/draft has been kept/);stored=(await getDoc(ref)).data();assert.equal(stored.name,'New draft name')
})
test('metadata loader reads explicitly linked lead dates without bodies, including repeated link IDs',async()=>{
 await db.doc('marketing_contacts/'+id+'-lead').set({last_contacted:'2026-11-01',messages:'PRIVATE'})
 await db.doc(`marketing_contacts/${id}-lead/whatsapp_threads/t`).set({date_range:['2026-11-10','2026-11-11'],messages:'PRIVATE'})
 const all=await loadCustomerActivity(db,()=>FieldPath.documentId())
 assert.doesNotMatch(JSON.stringify(all),/PRIVATE/)
 const row=projectCustomerActivity(all.customers,all.records,Date.parse('2026-11-12')).find(r=>r.customerId===id)
 assert.equal(row.lastContactAt,'2026-11-11T00:00:00.000Z');assert.equal(row.historyState,'known')
})
