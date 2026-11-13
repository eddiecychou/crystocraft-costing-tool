// Actual Shipping save, Firebase SDK and current rules. Fictional loopback only.
import { test, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { initializeApp,deleteApp } from 'firebase/app'
import { collection, doc, setDoc, getDocFromServer, getDocsFromServer, getDocFromCache, getDocs, disableNetwork, enableNetwork, updateDoc, writeBatch, deleteDoc,Timestamp,getFirestore,connectFirestoreEmulator,terminate } from 'firebase/firestore'

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Explicit loopback Firestore emulator required; live writes forbidden.')
let env, db, otherDb, engine, otherEngine, scratch, generation = 0
const clients = []
const makeClient=uid=>{
  const app=initializeApp({projectId:'demo-shipping-save-regression',apiKey:'fictional-key',appId:'fictional-app'},uid+'-'+crypto.randomUUID())
  const db=getFirestore(app)
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':')
  connectFirestoreEmulator(db,host,Number(port),{mockUserToken:{sub:uid}})
  clients.push({db,app})
  return db
}
const withDisabled = callback => env.withSecurityRulesDisabled(async ctx => {
  const ownerDb = ctx.firestore()
  try { return await callback({ firestore: () => ownerDb }) }
  finally { await ownerDb.terminate() }
})
const seed = async () => withDisabled(async ctx => {
  const seedDb = ctx.firestore()
  await setDoc(doc(seedDb, 'users', 'shipping_admin'), { role: 'admin', status: 'approved' })
  await setDoc(doc(seedDb, 'users', 'shipping_editor_b'), { role: 'staff', status: 'approved', modules: ['shipping'] })
  await setDoc(doc(seedDb, 'users', 'shipping_customer'), { role: 'customer', status: 'approved', customer_id: 'fictional-customer' })
  await setDoc(doc(seedDb, 'orders', 'fictional-order'), { customer_id: 'fictional-customer', customer_name: 'Fictional Company', notes: 'Original notes', stock_reserved: true })
  await setDoc(doc(seedDb, 'orders', 'fictional-order', 'lines', 'keep'), { item_code: 'ORIGINAL', qty_ordered: 1, unit_price: 1, line_no: 1, retained_unknown: 'preserved' })
  await setDoc(doc(seedDb, 'orders', 'fictional-order', 'lines', 'removed'), { item_code: 'REMOVE', qty_ordered: 2, unit_price: 2, line_no: 2 })
})
before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-shipping-save-regression', firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
  await mkdir('qa/out', { recursive: true }); scratch = await mkdtemp(resolve('qa/out/shipping-save-engine-'))
  await build({ entryPoints: ['src/shipping.js'], outfile: join(scratch, 'engine.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'shipping-emulator-db', setup(b) {
    b.onResolve({filter:/^firebase\/firestore$/},a=>a.namespace==='guard-sdk'?{path:a.path,external:true}:{path:'sdk',namespace:'guard-sdk'})
    b.onLoad({filter:/.*/,namespace:'guard-sdk'},()=>({loader:'js',contents:`
      export * from 'firebase/firestore';
      import {getDocs as read,getDocsFromServer as readServer,writeBatch as batch} from 'firebase/firestore';
      const owner=globalThis.__shippingSaveDb;
      export const getDocs=async(...args)=>{const value=await read(...args);await globalThis.__editAfterRead?.(owner);return value};
      export const getDocsFromServer=async(...args)=>{const value=await readServer(...args);await globalThis.__editAfterServerLines?.(owner);return value};
      export const writeBatch=(...args)=>{
        const value=batch(...args);
        return new Proxy(value,{get(target,key){if(key==='commit')return async()=>{await target.commit();await globalThis.__editAfterCommit?.(owner)};const item=target[key];return typeof item==='function'?item.bind(target):item}});
      };
    `}))
    b.onResolve({ filter: /^(firebase\/.*|react)$/ }, a => ({ path: a.path, external: true }))
    b.onResolve({ filter: /\/(firebase|criticalComponents|soNumber)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: {
      firebase: 'export const db=globalThis.__shippingSaveDb;',
      criticalComponents: 'export const buildProductIndex=()=>{},matchProductCode=()=>{};',
      soNumber: 'export const JES_SEED_BY_YEAR={},soYear=()=>{},formatSoNo=()=>{};',
    }[a.path] }))
  } }] })
}, { timeout: 20000 })
beforeEach(async () => {
  await env.clearFirestore(); await seed()
  db = makeClient('shipping_admin'); globalThis.__shippingSaveDb = db
  engine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?case=' + (++generation))
  otherDb = makeClient('shipping_editor_b'); globalThis.__shippingSaveDb = otherDb
  otherEngine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?other=' + generation)
}, { timeout: 20000 })
afterEach(async () => { delete globalThis.__editAfterRead; delete globalThis.__editAfterServerLines; delete globalThis.__editAfterCommit; await Promise.all(clients.splice(0).map(async client => {await terminate(client.db);await deleteApp(client.app)})) }, { timeout: 10000 })
after(async () => {
  await env?.cleanup()
  if (scratch) await rm(scratch, { recursive: true, force: true }); delete globalThis.__shippingSaveDb
}, { timeout: 10000 })
const patch = { notes: 'Saved notes 中文', deposit_paid: 155, total_amount: 1222, accounting_total: 1222 }
const lines = [{ id: 'keep', item_code: 'UPDATED 中文', qty_ordered: 1000, unit_price: 1.222, line_no: 1 }, { item_code: 'NEW', qty_ordered: 5, unit_price: 3.125, line_no: 2 }]
const orderRef = () => doc(db, 'orders', 'fictional-order')
const lineRef = id => doc(db, 'orders', 'fictional-order', 'lines', id)

test('an acknowledged atomic save preserves unrelated header/line fields and exact decimals', { timeout: 20000 }, async () => {
  await engine.saveOrderWithLines('fictional-order', patch, lines)
  const saved = (await getDocFromServer(orderRef())).data()
  assert.equal(saved.notes, patch.notes); assert.equal(saved.stock_reserved, true); assert.equal(saved.deposit_paid, 155)
  const kept = (await getDocFromServer(lineRef('keep'))).data()
  assert.equal(kept.unit_price, 1.222); assert.equal(kept.qty_ordered, 1000); assert.equal(kept.retained_unknown, 'preserved')
  assert.equal((await getDocFromServer(lineRef('removed'))).exists(), false)
  const all = await getDocsFromServer(collection(db, 'orders', 'fictional-order', 'lines'))
  assert.equal(all.size, 2); assert.equal(all.docs.find(d => d.id !== 'keep').data().unit_price, 3.125)
})

test('a missing order rejects the entire batch instead of creating orphan replacement lines', { timeout: 20000 }, async () => {
  // Invoice root guards deny a missing resource before the write precondition
  // can return NOT_FOUND. Either refusal must preserve all header/line facts.
  await assert.rejects(engine.saveOrderWithLines('missing-order', patch, lines), error => ['not-found','permission-denied'].includes(error.code))
  await withDisabled(async ctx => {
    assert.equal((await getDocFromServer(doc(ctx.firestore(), 'orders', 'missing-order'))).exists(), false)
    assert.equal((await getDocsFromServer(collection(ctx.firestore(), 'orders', 'missing-order', 'lines'))).size, 0)
  })
})

test('a permission rejection leaves the header, updated/new lines and deleted lines unchanged', { timeout: 20000 }, async () => {
  const customer = makeClient('shipping_customer')
  // The real customer rules permit reading this assigned order and its lines,
  // but reject every write. Use a separately bundled handle to avoid replacing db.
  globalThis.__shippingSaveDb = customer
  const customerEngine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?customer')
  try { await assert.rejects(customerEngine.saveOrderWithLines('fictional-order', patch, lines), error => error.code === 'permission-denied') }
  finally { globalThis.__shippingSaveDb = db; await terminate(customer) }
  assert.equal((await getDocFromServer(orderRef())).data().notes, 'Original notes')
  assert.equal((await getDocFromServer(lineRef('keep'))).data().unit_price, 1)
  assert.equal((await getDocFromServer(lineRef('removed'))).exists(), true)
  assert.equal((await getDocsFromServer(collection(db, 'orders', 'fictional-order', 'lines'))).size, 2)
})

test('an offline cached save remains pending, applies locally as one batch, then acknowledges on reconnect', { timeout: 20000 }, async () => {
  // Populate both the document and line-query cache before disconnecting.
  const base=(await engine.getOrderEditSnapshot('fictional-order')).base
  await getDocFromServer(orderRef()); await getDocs(collection(db, 'orders', 'fictional-order', 'lines'))
  await disableNetwork(db)
  let result = 'pending'
  const save = engine.saveOrderWithLines('fictional-order', patch, lines, {base,attemptId:'offline-original'}).then(() => { result = 'committed' }, error => { result = error.code; throw error })
  // Cache polling establishes local batch visibility without claiming durability.
  const deadline = Date.now() + 3000
  let cached
  do { cached = await getDocFromCache(orderRef()); if (cached.data().notes === patch.notes) break; await new Promise(resolve => setTimeout(resolve, 10)) } while (Date.now() < deadline)
  assert.equal(cached.data().notes, patch.notes); assert.equal(cached.metadata.hasPendingWrites, true); assert.equal(result, 'pending')
  assert.equal((await getDocFromCache(lineRef('keep'))).data().unit_price, 1.222)
  assert.equal((await getDocFromCache(lineRef('removed'))).exists(), false)
  await enableNetwork(db); await save
  assert.equal(result, 'committed'); assert.equal((await getDocFromServer(orderRef())).metadata.hasPendingWrites, false)
  assert.equal((await getDocFromServer(lineRef('keep'))).data().unit_price, 1.222)
})


const id='fictional-order'
const snapshot=api=>api.getOrderEditSnapshot(id)
const edit=async(api,base,patch={},items=base.lines,attemptId=crypto.randomUUID())=>
  api.saveOrderWithLines(id,patch,items,{base:base.base,attemptId})
const conflict=error=>error.code==='order-edit-conflict'

test('two operators cannot erase a newer deposit, terms, added line or exact price', {timeout:20000}, async()=>{
  const a=await snapshot(engine),b=await snapshot(otherEngine)
  const items=a.lines.map(l=>({...l,unit_price:l.id==='keep'?1.333:l.unit_price}))
  items.push({id:'added',item_code:'NEW',qty_ordered:2,unit_price:3.125,line_no:3})
  await edit(engine,a,{deposit_paid:155,payment_terms:'Agreed terms',notes:'A'},items)
  const draft=structuredClone(b)
  await assert.rejects(edit(otherEngine,b,{notes:'B unsaved'}),conflict)
  assert.deepEqual(b,draft)
  const actual=await snapshot(engine)
  assert.equal(actual.order.deposit_paid,155);assert.equal(actual.order.notes,'A')
  assert.equal(actual.order.payment_terms,'Agreed terms');assert.equal(actual.lines.length,3)
  assert.equal(actual.lines.find(l=>l.id==='keep').unit_price,1.333)
  assert.equal(actual.lines.find(l=>l.id==='added').unit_price,3.125)
  assert.equal(actual.base.revision,1)
})

test('a stale editor cannot recreate a deleted line; explicit fresh reload saves normally', {timeout:20000},async()=>{
  const a=await snapshot(engine),b=await snapshot(otherEngine)
  await edit(engine,a,{notes:'A'},a.lines.filter(l=>l.id!=='removed'))
  await assert.rejects(edit(otherEngine,b,{notes:'B'}),conflict)
  const fresh=await snapshot(otherEngine)
  await edit(otherEngine,fresh,{notes:'B reviewed latest'})
  const actual=await snapshot(engine)
  assert.equal(actual.lines.length,1);assert.equal(actual.order.notes,'B reviewed latest')
  assert.equal(actual.base.revision,2)
})

test('simultaneous first edits of a legacy order accept exactly one entire batch', {timeout:20000},async()=>{
  const a=await snapshot(engine),b=await snapshot(otherEngine)
  const results=await Promise.allSettled([edit(engine,a,{notes:'A'}),edit(otherEngine,b,{notes:'B'})])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.filter(r=>r.status==='rejected'&&conflict(r.reason)).length,1)
  assert.equal((await snapshot(engine)).base.revision,1)
})

test('a save after the line query still rejects a competing commit in the gap', {timeout:20000},async()=>{
  const a=await snapshot(engine),b=await snapshot(otherEngine)
  let intercepted=false
  globalThis.__editAfterRead=async owner=>{
    if(owner!==db||intercepted)return
    intercepted=true
    await edit(otherEngine,b,{notes:'B won'},[...b.lines,{id:'new',item_code:'NEW',qty_ordered:2,unit_price:3.125}])
  }
  await assert.rejects(edit(engine,a,{notes:'A stale'}),conflict)
  const actual=await snapshot(engine)
  assert.equal(actual.order.notes,'B won');assert.equal(actual.lines.length,3)
})

test('coherent loading retries if the header changes around its line read', {timeout:20000},async()=>{
  const b=await snapshot(otherEngine)
  let intercepted=false
  globalThis.__editAfterServerLines=async owner=>{
    if(owner!==db||intercepted)return
    intercepted=true
    await edit(otherEngine,b,{deposit_paid:155},[...b.lines,{id:'new',item_code:'NEW',qty_ordered:1,unit_price:2}])
  }
  const actual=await snapshot(engine)
  assert.equal(actual.base.revision,1);assert.equal(actual.order.deposit_paid,155)
  assert.equal(actual.lines.length,3)
})

test('a stale offline batch stays pending then rejects atomically on reconnect', {timeout:20000},async()=>{
  const a=await snapshot(engine),b=await snapshot(otherEngine)
  await getDocs(collection(otherDb,'orders',id,'lines'))
  await disableNetwork(otherDb)
  let pending,reconnected=false
  try{
    await edit(engine,a,{deposit_paid:155,notes:'Online A'},[...a.lines,{id:'online-new',item_code:'NEW',qty_ordered:2,unit_price:3.125}])
    let settled=false
    pending=edit(otherEngine,b,{notes:'Offline B'}).then(()=>{settled=true;return null},error=>{settled=true;return error})
    const deadline=Date.now()+3000
    while(Date.now()<deadline){
      const cached=await getDocFromCache(doc(otherDb,'orders',id))
      if(cached.data().notes==='Offline B'){assert.equal(cached.metadata.hasPendingWrites,true);break}
      await new Promise(r=>setTimeout(r,10))
    }
    const cached=await getDocFromCache(doc(otherDb,'orders',id))
    assert.equal(cached.data().notes,'Offline B');assert.equal(cached.metadata.hasPendingWrites,true)
    assert.equal(settled,false)
    await enableNetwork(otherDb);reconnected=true
    assert.ok(conflict(await pending))
    const actual=await snapshot(engine)
    assert.equal(actual.order.notes,'Online A');assert.equal(actual.order.deposit_paid,155)
    assert.equal(actual.lines.length,3)
  }finally{if(!reconnected)await enableNetwork(otherDb);await pending}
})

test('a lost acknowledgement confirms the same attempt without another line or revision', {timeout:20000},async()=>{
  const a=await snapshot(engine)
  globalThis.__editAfterCommit=async()=>{throw Error('Fictional lost acknowledgement')}
  await edit(engine,a,{notes:'Accepted once'},[...a.lines,{id:'stable-new-id',item_code:'NEW',qty_ordered:2,unit_price:3.125}],'same-attempt')
  const actual=await snapshot(engine)
  assert.equal(actual.base.revision,1);assert.equal(actual.lastEditId,'same-attempt')
  assert.equal(actual.lines.length,3)
})

test('legacy lines without line_no remain visible and retain their document IDs and unknown fields', {timeout:20000},async()=>{
  await withDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'orders',id),{createdAt:new Timestamp(1794216000,123456000)})
    await setDoc(doc(ctx.firestore(),'orders',id,'lines','legacy'),{item_code:'LEGACY',qty_ordered:1,unit_price:1.222,unrelated:'keep'})
  })
  const a=await snapshot(engine)
  assert.equal(a.lines.length,3);assert.ok(a.lines.find(l=>l.id==='legacy'))
  await edit(engine,a,{notes:'Legacy retained'})
  assert.equal((await getDocFromServer(lineRef('legacy'))).data().unrelated,'keep')
})

test('old clients and standalone line writes are denied; stock and narrow review updates remain usable', {timeout:20000},async()=>{
  await assert.rejects(updateDoc(orderRef(),{notes:'Old client'}),error=>error.code==='permission-denied')
  await assert.rejects(setDoc(lineRef('injected'),{item_code:'Old client'}),error=>error.code==='permission-denied')
  await assert.rejects(deleteDoc(lineRef('keep')),error=>error.code==='permission-denied')
  await updateDoc(orderRef(),{metal_reserved:true,no_invoice_reason:'Awaiting paperwork'})
  const a=await snapshot(engine)
  await edit(engine,a,{notes:'Commercial save'})
  const actual=(await getDocFromServer(orderRef())).data()
  assert.equal(actual.metal_reserved,true);assert.equal(actual.no_invoice_reason,'Awaiting paperwork')
})

test('new root plus lines creation remains atomic and direct client deletion is denied', {timeout:20000},async()=>{
  const batch=writeBatch(db)
  batch.set(doc(db,'orders','new-fictional'),{customer_id:'fictional-customer',source:'manual'})
  batch.set(doc(db,'orders','new-fictional','lines','new-line'),{qty_ordered:1,unit_price:1.222})
  await batch.commit()
  const deletion = writeBatch(db)
  deletion.delete(doc(db,'orders','new-fictional'))
  deletion.delete(doc(db,'orders','new-fictional','lines','new-line'))
  await assert.rejects(deletion.commit(), {code:'permission-denied'})
  assert.equal((await getDocFromServer(doc(db,'orders','new-fictional'))).exists(),true)
  assert.equal((await getDocFromServer(doc(db,'orders','new-fictional','lines','new-line'))).exists(),true)
})

test('atomic batch limit accepts 499 lines and rejects an oversized edit before any write', {timeout:30000},async()=>{
  const a=await snapshot(engine)
  const items=[...a.lines,...Array.from({length:497},(_,i)=>({id:'many-'+i,item_code:'ITEM-'+i,qty_ordered:1,unit_price:1.222,line_no:i+3}))]
  await edit(engine,a,{notes:'499 lines'},items)
  const fresh=await snapshot(engine)
  await assert.rejects(edit(engine,fresh,{notes:'Too many'},[...items,{id:'over',qty_ordered:1,unit_price:1}]),/atomic save limit/)
  assert.equal((await snapshot(engine)).order.notes,'499 lines')
})


test('a deleted and recreated legacy order cannot accept the prior record draft', {timeout:20000},async()=>{
  await withDisabled(async ctx=>updateDoc(doc(ctx.firestore(),'orders',id),{createdAt:Timestamp.fromMillis(1000)}))
  const original=await snapshot(engine)
  await withDisabled(async ctx => {
    const seedDb = ctx.firestore(), deletion = writeBatch(seedDb)
    for (const line of (await getDocs(collection(seedDb, 'orders', id, 'lines'))).docs) deletion.delete(line.ref)
    deletion.delete(doc(seedDb, 'orders', id))
    await deletion.commit()
  })
  const batch=writeBatch(otherDb)
  batch.set(doc(otherDb,'orders',id),{customer_name:'Replacement company',createdAt:Timestamp.fromMillis(2000)})
  batch.set(doc(otherDb,'orders',id,'lines','replacement'),{item_code:'REPLACEMENT',qty_ordered:1,unit_price:1})
  await batch.commit()
  await assert.rejects(edit(engine,original,{notes:'Old record draft'}),conflict)
  const actual=await snapshot(engine)
  assert.equal(actual.order.customer_name,'Replacement company');assert.equal(actual.lines.length,1)
  assert.equal(actual.lines[0].id,'replacement')
})
