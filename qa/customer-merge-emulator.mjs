// Explicitly emulator-only: never create a test customer in the live project.
import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore,Timestamp} from 'firebase-admin/firestore'
import {mergeCustomerRecords,MERGE_COLLECTIONS} from '../netlify/functions/lib/customerMerge.js'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))throw Error('Local emulator required; live fixture writes are forbidden.')
const app=initializeApp({projectId:'crystocraft-rbac-test'},'merge-fixtures'),db=getFirestore(app)
after(async()=>{await db.terminate();await deleteApp(app)})
let sequence=0
async function fixtures(){const prefix=`merge_${++sequence}_`;const a=prefix+'a',b=prefix+'b';await db.doc(`customers/${a}`).set({company_name:'A',notes:'Alpha notes',contacts:[]});await db.doc(`customers/${b}`).set({company_name:'B',notes:'Beta notes',contacts:[]});return {a,b}}
const task=(text,state='todo')=>({kind:'task',text,state,due_on:'2026-08-17',revision:7,created_by:'original-author',updated_by:'original-editor',createdAt:Timestamp.fromMillis(1000),updatedAt:Timestamp.fromMillis(2000)})
for(const reverse of [false,true])test(`real merge keeps both complete workspaces, history and audit metadata (${reverse?'keep A':'keep B'})`,async()=>{
 const {a,b}=await fixtures();const [source,target]=reverse?[b,a]:[a,b]
 for(const id of [a,b]){
 await db.doc(`customers/${id}/work_items/same-id`).set(task(id,'done'))
 await db.doc(`customers/${id}/work_items/note`).set({...task('Private reference '+id,'done'),kind:'note',due_on:''})
 await db.doc(`customers/${id}/enquiries/same-id`).set({description:'History '+id,date:Timestamp.fromMillis(3000),follow_up_date:Timestamp.fromMillis(4000),todo_status:'waiting',attachments:[{url:'https://example.test/file.pdf',path:'original/blob.pdf'}]})
 for(const name of ['email_threads','whatsapp_threads','alibaba_threads'])await db.doc(`customers/${id}/${name}/same-thread`).set({subject:name+id,messages:[{body_text:id}],contact_id:null})
 await db.doc(`customers/${id}/whatsapp_threads/same-thread/media/urls`).set({file:'https://example.test/photo.jpg'})
 }
 await db.doc(`orders/${source}`).set({customer_id:source,status:'confirmed'})
 await db.doc(`users/${source}`).set({customer_id:source,role:'customer',status:'approved',pricing_group:'unchanged'})
 const result=await mergeCustomerRecords(db,source,target,'admin',{budgetMs:120000});assert.equal(result.complete,true);assert.equal((await db.doc(`customers/${source}`).get()).exists,false)
 const survivor=(await db.doc(`customers/${target}`).get()).data();assert.match(survivor.notes,/Alpha/);assert.match(survivor.notes,/Beta/);assert.equal(survivor.customer_merge_lock,undefined)
 const work=(await db.collection(`customers/${target}/work_items`).get()).docs.map(d=>d.data());assert.equal(work.length,4);assert.equal(work.filter(d=>d.kind==='note').length,2);for(const d of work){assert.equal(d.state,'done');assert.equal(d.created_by,'original-author');assert.equal(d.revision,7);assert.equal(d.createdAt.toMillis(),1000)}
 assert.equal((await db.collection(`customers/${target}/enquiries`).get()).size,2)
 for(const name of ['email_threads','whatsapp_threads','alibaba_threads'])assert.equal((await db.collection(`customers/${target}/${name}`).get()).size,2)
 const wa=(await db.collection(`customers/${target}/whatsapp_threads`).get()).docs;for(const d of wa)assert.equal((await d.ref.collection('media').get()).size,1)
 assert.equal((await db.doc(`users/${source}`).get()).data().customer_id,target);assert.equal((await db.doc(`users/${source}`).get()).data().role,'customer');assert.equal((await db.doc(`users/${source}`).get()).data().pricing_group,'unchanged')
 assert.equal((await db.collection(`customers/${source}/work_items`).get()).size,0);assert.ok((await db.collection(`customer_merges/${source}/history`).get()).size >= 4,'Original data remains in server-only audit snapshots')
 await mergeCustomerRecords(db,source,target,'admin');assert.equal((await db.collection(`customers/${target}/work_items`).get()).size,4,'Retry must not duplicate history')
})
test('interruption leaves both parents and original data; retry resumes without duplicate copies',async()=>{
 const {a,b}=await fixtures();await db.doc(`customers/${a}/work_items/t`).set(task('Keep me'))
 await assert.rejects(mergeCustomerRecords(db,a,b,'admin',{afterCopy:async()=>{throw Error('Injected interruption')}}),/Injected/)
 assert.equal((await db.doc(`customers/${a}`).get()).exists,true);assert.equal((await db.doc(`customers/${b}`).get()).data().customer_merge_lock,a)
 assert.equal((await db.collection(`customer_merges/${a}/history`).get()).size,1)
 await mergeCustomerRecords(db,a,b,'admin');assert.equal((await db.collection(`customers/${b}/work_items`).get()).size,1)
})
test('continuation deadline keeps work safe; an opposite or different-target merge cannot steal a lock',async()=>{
 const {a,b}=await fixtures();const c='merge_third';await db.doc(`customers/${c}`).set({company_name:'C'})
 await db.doc(`customers/${a}/work_items/t`).set(task('Undated'))
 const paused=await mergeCustomerRecords(db,a,b,'admin',{budgetMs:-1});assert.equal(paused.complete,false)
 await assert.rejects(mergeCustomerRecords(db,a,c,'admin'),/another record/)
 await assert.rejects(mergeCustomerRecords(db,b,a,'admin'),/another merge/)
 await mergeCustomerRecords(db,a,b,'admin');assert.equal((await db.collection(`customers/${b}/work_items`).get()).size,1)
})
test('large workspace transfers more than 500 records without dropping or duplicating entries',async()=>{
 const {a,b}=await fixtures();for(let start=0;start<505;start+=100){const batch=db.batch();for(let i=start;i<Math.min(start+100,505);i++)batch.set(db.doc(`customers/${a}/work_items/t${i}`),task('Task '+i));await batch.commit()}
 let result;do{result=await mergeCustomerRecords(db,a,b,'admin',{budgetMs:1000})}while(!result.complete)
 assert.equal((await db.collection(`customers/${b}/work_items`).get()).size,505)
})
test('same customer, invalid paths and missing records fail before mutation',async()=>{
 for(const [a,b] of [['same','same'],['../escape','target'],['missing_source','missing_target']])await assert.rejects(mergeCustomerRecords(db,a,b,'admin'))
})
test('concurrent requests for the same pair cannot run two workers',async()=>{
 const {a,b}=await fixtures();await db.doc(`customers/${a}/work_items/t`).set(task('One task'))
 let entered,release;const copied=new Promise(resolve=>{entered=resolve}),hold=new Promise(resolve=>{release=resolve})
 const first=mergeCustomerRecords(db,a,b,'admin',{afterCopy:async()=>{entered();await hold}})
 await copied
 try{await assert.rejects(mergeCustomerRecords(db,a,b,'other-admin'),/still running/)}finally{release()}
 await first;assert.equal((await db.collection(`customers/${b}/work_items`).get()).size,1)
})
