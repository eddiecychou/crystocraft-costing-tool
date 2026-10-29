// Actual PO engine, stock ledger and Firestore transactions/rules. Loopback only.
import {test,before,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment} from '@firebase/rules-unit-testing'
import {doc,getDoc,getDocs,collection,setDoc,updateDoc,Timestamp} from 'firebase/firestore'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore emulator required; live writes forbidden.')
const P='receipt_fixture',ids=['red','pink','fuchsia','violet','peach','clear'],suffix=['RE','PI','FU','VL','PE','C1'],quantities=[102,60,64,65,60,65]
const components=ids.map((id,i)=>({id,code:'P-CF001-'+suffix[i],name:'Petal '+suffix[i]}))
const lines=components.map((c,i)=>({code:c.code,description:c.name,qty:quantities[i],unit:'pcs',unit_price:5.8,linked:{type:'range',component_id:c.id,label:c.code}}))
const po={pu_number:'PU-FIXTURE',status:'issued',currency:'RMB',supplier_id:'supplier',notes:'Preserve commercial terms',subtotal:2412.8,total:5412.8,lines,receive_generation:0,stock_received:false}
let env,db,engine,scratch
before(async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':')
 env=await initializeTestEnvironment({projectId:'po-receive-regression',firestore:{host,port:Number(port),rules:await readFile('firestore.rules','utf8')}})
 db=env.authenticatedContext('po_admin').firestore();globalThis.__poDb=db
 await mkdir('qa/out',{recursive:true});scratch=await mkdtemp(resolve('qa/out/po-engine-'))
 await build({stdin:{contents:"export * from './src/poReceive.js';export {postMovement} from './src/stockLedger.js'",resolveDir:process.cwd()},outfile:join(scratch,'engine.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'po-test-db',setup(b){
  b.onResolve({filter:/^(firebase\/.*|react)$/},a=>({path:a.path,external:true}))
  b.onResolve({filter:/\/(firebase|criticalComponents|crystals|packaging)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='firebase'?'export const db=globalThis.__poDb;export const authedUser=async()=>({uid:"po_admin"});':`import{collection,getDocs}from'firebase/firestore';const load=async col=>(await getDocs(collection(globalThis.__poDb,col))).docs.map(d=>({id:d.id,...d.data()}));export const ${a.path==='criticalComponents'?'loadComponents':a.path==='crystals'?'loadCrystals':'loadPackaging'}=()=>load('${a.path==='criticalComponents'?'range_components':a.path}');`}))
 }}]})
 engine=await import(pathToFileURL(join(scratch,'engine.mjs')))
})
beforeEach(async()=>{
 await env.clearFirestore()
 await env.withSecurityRulesDisabled(async ctx=>{
  const seed=ctx.firestore();await setDoc(doc(seed,'users','po_admin'),{role:'admin',status:'approved'})
  await setDoc(doc(seed,'purchase_orders',P),po)
  for(const c of components){const {id,...d}=c;await setDoc(doc(seed,'range_components',id),{...d,stock_qty:0,reserved_qty:0,ledger_seeded:true,movement_seq:0})}
 })
})
after(async()=>{await env?.cleanup();if(scratch)await rm(scratch,{recursive:true,force:true});delete globalThis.__poDb})
const data=async(path)=>{const s=await getDoc(doc(db,path));return s.exists()?s.data():null}
const movementRows=async id=>(await getDocs(collection(db,'range_components',id,'movements'))).docs.map(d=>({id:d.id,...d.data()}))
async function preview(){return engine.computePoReceive(await data('purchase_orders/'+P))}
async function receive(){const p=await preview();return engine.receivePo(P,po.pu_number,p.items,p.source_lines)}
async function legacy(){
 const bad=lines.map(l=>({...l,description:components[0].name,linked:{type:'range',component_id:'red',label:components[0].code}}))
 const received=bad.map(l=>({cls:'metal',sku_id:'red',code:components[0].code,qty:l.qty}))
 await updateDoc(doc(db,'purchase_orders',P),{lines:bad,stock_received:true,stock_received_at:Timestamp.fromMillis(1000),received_lines:received})
 await updateDoc(doc(db,'range_components','red'),{stock_qty:102,movement_seq:1})
 await setDoc(doc(db,'range_components','red','movements',`po_receive_${P}_g0_red`),{type:'receipt',qty:102,balance_after:102,reserved_after:0,seq:1,note:'Received PU '+po.pu_number,createdAt:Timestamp.fromMillis(999)})
}
test('six correct colours commit one receipt each atomically',async()=>{
 await receive();const saved=await data('purchase_orders/'+P)
 assert.equal(saved.stock_received,true);assert.equal(saved.stock_receipt_version,2);assert.equal(saved.received_lines.length,6)
 for(const [i,id]of ids.entries()){assert.equal((await data('range_components/'+id)).stock_qty,quantities[i]);assert.equal((await movementRows(id)).length,1)}
})
test('legitimate repeated SKU rows receive their sum, and concurrent retries do not duplicate it',async()=>{
 await updateDoc(doc(db,'purchase_orders',P),{lines:[{...lines[0],qty:10},{...lines[0],qty:20}]})
 const p=await preview();await Promise.all([engine.receivePo(P,po.pu_number,p.items,p.source_lines),engine.receivePo(P,po.pu_number,p.items,p.source_lines)])
 assert.equal((await data('range_components/red')).stock_qty,30);assert.equal((await movementRows('red')).length,1)
 const receipt=(await data('purchase_orders/'+P)).received_lines[0];assert.equal(receipt.qty,30);assert.equal(receipt.source_lines.length,2)
})
test('stale component links cannot write a receipt',async()=>{
 await updateDoc(doc(db,'purchase_orders',P),{lines:lines.map(l=>({...l,linked:lines[0].linked}))})
 const p=await preview();assert.equal(p.conflicts.length,5)
 await assert.rejects(()=>engine.receivePo(P,po.pu_number,p.items,p.source_lines),/conflicts/)
 assert.equal((await movementRows('red')).length,0);assert.equal((await data('purchase_orders/'+P)).stock_received,false)
})
test('changed PO lines refuse a stale receive preview',async()=>{
 const p=await preview();await updateDoc(doc(db,'purchase_orders',P),{lines:[{...lines[0],qty:1}]})
 await assert.rejects(()=>engine.receivePo(P,po.pu_number,p.items,p.source_lines),/PO lines changed/)
 assert.equal((await movementRows('red')).length,0)
})
test('a failure during write staging commits neither earlier items nor the PO',async()=>{
 await updateDoc(doc(db,'range_components','violet'),{stock_qty:'invalid'})
 await assert.rejects(receive,/Invalid stock balance/)
 for(const id of ids)assert.equal((await movementRows(id)).length,0)
 assert.equal((await data('purchase_orders/'+P)).stock_received,false)
})
test('opening stock and reservations are preserved by composed ledger writes',async()=>{
 await updateDoc(doc(db,'range_components','red'),{stock_qty:10,reserved_qty:2,ledger_seeded:false})
 await receive();const c=await data('range_components/red');assert.equal(c.stock_qty,112);assert.equal(c.reserved_qty,2);assert.equal(c.movement_seq,2)
 assert.deepEqual((await movementRows('red')).map(m=>m.qty).sort((a,b)=>a-b),[10,102])
})
test('legacy partial postings cannot be silently posted again',async()=>{
 await setDoc(doc(db,'range_components','red','movements',`po_receive_${P}_g0_red`),{type:'receipt',qty:10})
 await assert.rejects(receive,/Existing receipt movements/)
 assert.equal((await movementRows('red')).length,1);assert.equal((await data('purchase_orders/'+P)).stock_received,false)
})
test('legacy correction adds only the five missing colours and retains red/audit/commercial history',async()=>{
 await legacy();const red=await data('range_components/red'),redMov=await movementRows('red'),before=await data('purchase_orders/'+P)
 const plan=await engine.previewPoReceiptCorrection(P)
 assert.equal(plan.items.reduce((n,l)=>n+l.delta,0),314);assert.equal(plan.items.find(l=>l.sku_id==='red').delta,0)
 await Promise.all([engine.applyPoReceiptCorrection(plan),engine.applyPoReceiptCorrection(plan)])
 assert.deepEqual(await data('range_components/red'),red);assert.deepEqual(await movementRows('red'),redMov)
 const after=await data('purchase_orders/'+P)
 for(const k of ['pu_number','supplier_id','subtotal','total','currency','notes','stock_received_at','receive_generation'])assert.deepEqual(after[k],before[k],k)
 assert.equal(after.received_lines.length,6);assert.equal(after.receipt_corrections.g0_v2.before.received_lines.length,6)
 for(const [i,id]of ids.entries()){assert.equal((await data('range_components/'+id)).stock_qty,quantities[i]);assert.equal((await movementRows(id)).length,1);assert.equal(after.lines[i].linked.component_id,id);assert.equal(after.lines[i].description,components[i].name);assert.equal(after.lines[i].unit_price,5.8)}
 const stamp=after.updatedAt;await engine.applyPoReceiptCorrection(plan);assert.deepEqual((await data('purchase_orders/'+P)).updatedAt,stamp)
 assert.equal((await engine.previewPoReceiptCorrection(P)).needed,false)
})
test('correction refuses concurrent stock changes without overwriting them',async()=>{
 await legacy();const plan=await engine.previewPoReceiptCorrection(P)
 await engine.postMovement('range_components','pink',{type:'receipt',qty:7,note:'Another delivery'})
 await assert.rejects(()=>engine.applyPoReceiptCorrection(plan),/Stock changed/)
 assert.equal((await data('range_components/pink')).stock_qty,7);assert.equal((await movementRows('clear')).length,0)
})
test('correction refuses a changed PO, quantities, commercial fields or generation',async()=>{
 await legacy();const plan=await engine.previewPoReceiptCorrection(P)
 for(const changed of [
  {...plan,generation:1},
  {...plan,items:plan.items.map((l,i)=>i?l:{...l,delta:l.delta+1})},
  {...plan,corrected_lines:plan.corrected_lines.map((l,i)=>i?l:{...l,unit_price:999})},
 ])await assert.rejects(()=>engine.applyPoReceiptCorrection(changed))
 await updateDoc(doc(db,'purchase_orders',P),{lines:[{...lines[0],qty:999}]})
 await assert.rejects(()=>engine.applyPoReceiptCorrection(plan),/PO receipt changed/)
 assert.equal((await movementRows('red')).length,1);assert.equal((await movementRows('pink')).length,0)
})
test('unknown, partial and over-received legacy receipts cannot be auto-corrected',async()=>{
 await legacy();const root=doc(db,'purchase_orders',P),old=(await data('purchase_orders/'+P)).received_lines
 await updateDoc(root,{received_lines:old.slice(0,2)});await assert.rejects(()=>engine.previewPoReceiptCorrection(P),/Partial/)
 await updateDoc(root,{received_lines:old})
 await updateDoc(doc(db,'range_components','red','movements',`po_receive_${P}_g0_red`),{qty:200});await assert.rejects(()=>engine.previewPoReceiptCorrection(P),/over-received/)
})
test('an unrecorded manual posting for this PO blocks correction instead of duplicating it',async()=>{
 await legacy()
 await setDoc(doc(db,'range_components','pink','movements','manual'),{type:'receipt',qty:60,note:'Manually received '+po.pu_number})
 await assert.rejects(()=>engine.previewPoReceiptCorrection(P),/unrecorded movement/)
 assert.equal((await movementRows('red')).length,1)
})
test('reversal uses actual legacy receipts and generation allows a later genuine receive',async()=>{
 await legacy();const saved=await data('purchase_orders/'+P)
 await engine.reversePoReceive(P,po.pu_number,{generation:0,lines:saved.received_lines})
 assert.equal((await data('range_components/red')).stock_qty,0);assert.equal((await data('purchase_orders/'+P)).receive_generation,1)
 await updateDoc(doc(db,'purchase_orders',P),{lines});await receive()
 assert.equal((await data('range_components/red')).stock_qty,102)
 await assert.rejects(()=>engine.reversePoReceive(P,po.pu_number,{generation:0,lines:saved.received_lines}),/Receipt changed/)
})
test('a corrected receipt reverses all six actual quantities once',async()=>{
 await legacy();await engine.applyPoReceiptCorrection(await engine.previewPoReceiptCorrection(P));const p=await data('purchase_orders/'+P)
 await Promise.all([engine.reversePoReceive(P,po.pu_number,{generation:0,lines:p.received_lines}),engine.reversePoReceive(P,po.pu_number,{generation:0,lines:p.received_lines})])
 for(const id of ids)assert.equal((await data('range_components/'+id)).stock_qty,0)
})
