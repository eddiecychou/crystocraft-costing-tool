// Real SDK/stock ledger/transaction checks. Never connect this suite to live OC.
import {test,before,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {initializeTestEnvironment} from '@firebase/rules-unit-testing'
import {doc,getDoc,getDocs,collection,setDoc,updateDoc} from 'firebase/firestore'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback emulator required. Live writes forbidden.')
let env,db,engine,scratch
before(async()=>{
 const[host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':')
 env=await initializeTestEnvironment({projectId:'order-reservation-add-test',firestore:{host,port:Number(port),rules:await readFile('firestore.rules','utf8')}})
 db=env.authenticatedContext('reservation_admin').firestore();globalThis.__reservationDb=db
 await mkdir('qa/out',{recursive:true});scratch=await mkdtemp(resolve('qa/out/reservation-engine-'))
 await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/orderStock.js';export {crystalInventory} from './src/crystals.js';export {packagingInventory} from './src/packaging.js'"},outfile:join(scratch,'engine.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'reservation-db',setup(b){
  b.onResolve({filter:/^(firebase\/.*|react)$/},a=>({path:a.path,external:true}))
  b.onResolve({filter:/\/(firebase|criticalComponents|mrp)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='firebase'?'export const db=globalThis.__reservationDb;':a.path==='mrp'?"export const computeRequirements=()=>{throw Error('BOM preview is outside this reservation-edit test')};":'export const loadComponents=async()=>[];'}))
 }}]});engine=await import(pathToFileURL(join(scratch,'engine.mjs')))
})
beforeEach(async()=>{
 await env.clearFirestore()
 await env.withSecurityRulesDisabled(async ctx=>{
  const seed=ctx.firestore();await setDoc(doc(seed,'users','reservation_admin'),{role:'admin',status:'approved'})
  const p={label:'Fixture',notes:'Preserve',price:1.222,component_gaps:{missing:[{code:'MISSING'}]}}
  for(const cfg of configs()){
   p[cfg.order.reserved]=true;p[cfg.order.committed]=false;p[cfg.order.lines]=[{[cfg.order.lineIdField]:'old',code:'OLD',qty:10,adj_seq:4,custom:'Keep'}];p[cfg.order.reserved+'_generation']=2
   for(const[id,reserved]of [['old',10],['new',5],['other',0]]){
    await setDoc(doc(seed,cfg.collectionPath,id),{code:id.toUpperCase(),stock_qty:100,reserved_qty:reserved,ledger_seeded:true,movement_seq:0,name:'Keep name'})
   }
  }
  await setDoc(doc(seed,'orders','fixture'),p)
 })
})
after(async()=>{await env?.cleanup();if(scratch)await rm(scratch,{recursive:true,force:true});delete globalThis.__reservationDb})
const configs=()=>[engine.metalOrderConfig,engine.crystalInventory,engine.packagingInventory]
const data=async path=>(await getDoc(doc(db,path))).data()
const moves=async(cfg,id='new')=>(await getDocs(collection(db,cfg.collectionPath,id,'movements'))).docs.map(d=>({id:d.id,...d.data()}))
const add=(cfg,patch={})=>engine.addReservedLine(cfg,'fixture','UC-FIXTURE',{component_id:'new',code:'NEW',qty:7,...patch})
for(const kind of ['metal','crystal','packaging'])test(`${kind}: adding reserves only the new item and preserves order/existing stock`,async()=>{
 const cfg=configs()[['metal','crystal','packaging'].indexOf(kind)],before=await data('orders/fixture'),old=await data(cfg.collectionPath+'/old')
 await add(cfg)
 const after=await data('orders/fixture'),field=cfg.order.lines,seq=field+'_add_sequence'
 assert.deepEqual(after,{...before,[field]:[...before[field],{[cfg.order.lineIdField]:'new',code:'NEW',qty:7,adj_seq:0}],[seq]:1})
 assert.deepEqual(await data(cfg.collectionPath+'/old'),old)
 const item=await data(cfg.collectionPath+'/new');assert.equal(item.stock_qty,100);assert.equal(item.reserved_qty,12)
 const rows=await moves(cfg);assert.equal(rows.length,1);assert.equal(rows[0].type,'reserve');assert.equal(rows[0].qty,0);assert.equal(rows[0].reserved_qty,7);assert.equal(rows[0].order_id,'fixture')
})
test('duplicate request and retry cannot reserve an existing item again',async()=>{
 const c=engine.crystalInventory;await add(c);const before=await data(c.collectionPath+'/new')
 await assert.rejects(()=>add(c),/already on the list/)
 assert.deepEqual(await data(c.collectionPath+'/new'),before);assert.equal((await moves(c)).length,1)
})
test('concurrent same-item additions post once',async()=>{
 const c=engine.crystalInventory,result=await Promise.allSettled([add(c),add(c)])
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await moves(c)).length,1)
 assert.equal((await data('crystals/new')).reserved_qty,12);assert.equal((await data('orders/fixture')).crystal_lines.length,2)
})
test('concurrent different-item additions retain both order rows and quantities',async()=>{
 const c=engine.crystalInventory;await Promise.all([add(c),add(c,{component_id:'other',code:'OTHER',qty:9})])
 const p=await data('orders/fixture');assert.equal(p.crystal_lines.length,3);assert.equal(p.crystal_lines_add_sequence,2)
 assert.equal((await data('crystals/new')).reserved_qty,12);assert.equal((await data('crystals/other')).reserved_qty,9)
})
test('production-in and legacy-issued stages reject additions',async()=>{
 const c=engine.crystalInventory
 for(const field of [c.order.committed,c.order.legacyIssued]){
  await updateDoc(doc(db,'orders','fixture'),{[field]:true});await assert.rejects(()=>add(c),/produced-in/)
  await updateDoc(doc(db,'orders','fixture'),{[field]:false})
 }
 assert.equal((await moves(c)).length,0)
})
test('open orders, deleted orders, missing stock and changed codes do not partially save',async()=>{
 const c=engine.crystalInventory,before=await data('orders/fixture')
 await assert.rejects(()=>add(c,{component_id:'missing'}),/no longer exists/)
 await assert.rejects(()=>add(c,{code:'WRONG'}),/code changed/)
 await assert.rejects(()=>engine.addReservedLine(c,'missing','X',{component_id:'new',qty:7}),/Order no longer exists/)
 assert.deepEqual(await data('orders/fixture'),before)
 await updateDoc(doc(db,'orders','fixture'),{crystals_reserved:false});await assert.rejects(()=>add(c),/Nothing is reserved/)
 assert.equal((await moves(c)).length,0);assert.equal((await data('crystals/new')).reserved_qty,5)
})
test('invalid quantities and corrupt stock cause no order or movement write',async()=>{
 const c=engine.crystalInventory,before=await data('orders/fixture')
 for(const qty of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>add(c,{qty}),/whole quantity/)
 await updateDoc(doc(db,'crystals','new'),{stock_qty:'invalid'});await assert.rejects(()=>add(c),/Invalid stock balance/)
 assert.deepEqual(await data('orders/fixture'),before);assert.equal((await moves(c)).length,0)
})
test('unfinished legacy add movement is refused rather than reserving twice',async()=>{
 const c=engine.crystalInventory,before=await data('orders/fixture')
 await setDoc(doc(db,'crystals','new','movements','add_fixture_g2_new'),{type:'reserve',qty:0,reserved_qty:7})
 await updateDoc(doc(db,'crystals','new'),{reserved_qty:12})
 await assert.rejects(()=>add(c),/existing add-to-reservation movement/)
 assert.deepEqual(await data('orders/fixture'),before);assert.equal((await data('crystals/new')).reserved_qty,12);assert.equal((await moves(c)).length,1)
})
test('staff with shipping and supply can add to a reservation',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users','reservation_admin'),{role:'staff',status:'approved',modules:['shipping','supply']}))
 await add(engine.crystalInventory)
 assert.equal((await data('orders/fixture')).crystal_lines.length,2)
 assert.equal((await data('crystals/new')).reserved_qty,12)
})
test('missing shipping or supply access refuses the complete addition',async()=>{
 for(const modules of [['shipping'],['supply']]){
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users','reservation_admin'),{role:'staff',status:'approved',modules}))
  await assert.rejects(()=>add(engine.crystalInventory),/permissions|permission|PERMISSION_DENIED/i)
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users','reservation_admin'),{role:'admin',status:'approved'}))
  assert.equal((await data('orders/fixture')).crystal_lines.length,1)
  assert.equal((await data('crystals/new')).reserved_qty,5);assert.equal((await moves(engine.crystalInventory)).length,0)
 }
})
test('release includes the addition without consuming stock or other reservations',async()=>{
 const c=engine.crystalInventory;await add(c);await engine.releaseForOrder(c,'fixture','UC-FIXTURE')
 assert.equal((await data('crystals/new')).stock_qty,100);assert.equal((await data('crystals/new')).reserved_qty,5)
 assert.equal((await data('crystals/old')).reserved_qty,0);assert.deepEqual((await data('orders/fixture')).crystal_lines,[])
})
test('production-in consumes the new item quantity and preserves other reservations',async()=>{
 const c=engine.crystalInventory;await add(c);await engine.produceForOrder(c,'fixture','UC-FIXTURE')
 assert.equal((await data('crystals/new')).stock_qty,93);assert.equal((await data('crystals/new')).reserved_qty,5)
 assert.equal((await data('crystals/old')).stock_qty,90);assert.equal((await data('orders/fixture')).crystals_committed,true)
})
