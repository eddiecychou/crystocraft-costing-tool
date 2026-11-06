// Real shipping save code; fictional Firestore boundaries. No live access.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let engine, scratch, fixture
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipping-save-'))
  await build({ entryPoints: ['src/shipping.js'], outfile: join(scratch, 'engine.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'fictional-save-boundary', setup(b) {
    b.onResolve({ filter: /^react$/ }, a => ({ path: a.path, namespace: 'fixture' }))
    b.onResolve({ filter: /^(firebase\/firestore)$|\/(firebase|criticalComponents|soNumber)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: {
      firebase: 'export const db={};',
      react: 'export const useState=()=>{throw Error("Unexpected hook")},useEffect=useState;',
      criticalComponents: 'export const buildProductIndex=()=>{},matchProductCode=()=>{};',
      soNumber: 'export const JES_SEED_BY_YEAR={},soYear=()=>{},formatSoNo=()=>{};',
      firestore: `const f=()=>globalThis.__shippingSave;
        export const collection=(...p)=>p,doc=(...p)=>{const flat=p.flat().filter(v=>typeof v==='string');if(flat.length%2)flat.push('generated-'+(++f().ids));return{id:flat.at(-1),path:flat.join('/')}};
        export const serverTimestamp=()=> 'FICTIONAL timestamp';
        export const getDocs=async path=>{f().reads.push(path);if(f().readError)throw f().readError;if(f().readWait)await f().readWait.promise;return{docs:f().existing.map(id=>({id,ref:{id,path:'orders/order/lines/'+id}}))}};
        export const writeBatch=()=>{const operations=[];f().batches.push(operations);return{
          update:(ref,data)=>operations.push({kind:'update',ref,data}),
          set:(ref,data,options)=>{if(f().stageError)throw f().stageError;operations.push({kind:'set',ref,data,options})},
          delete:ref=>operations.push({kind:'delete',ref}),
          commit:async()=>{f().commits++;if(f().commitWait)await f().commitWait.promise;if(f().commitError)throw f().commitError;f().acknowledged.push(operations)}
        }};
        const fail=()=>{throw Error('Unexpected independent mutation')};export{fail as addDoc,fail as updateDoc,fail as deleteDoc,fail as getDoc,fail as onSnapshot,fail as query,fail as orderBy,fail as runTransaction};`,
    }[a.path] }))
  } }] })
  engine = await import(pathToFileURL(join(scratch, 'engine.mjs')))
})
beforeEach(() => { fixture = globalThis.__shippingSave = { reads: [], batches: [], commits: 0, acknowledged: [], existing: ['keep', 'removed'], ids: 0 } })
after(async () => { delete globalThis.__shippingSave; if (scratch) await rm(scratch, { recursive: true, force: true }) })
const lines = () => [{ id: 'keep', item_code: '中文 & item', qty_ordered: 1000, unit_price: 1.222, notes: 'preserved' }, { item_code: 'NEW', qty_ordered: 2, unit_price: 3.125 }]

test('one acknowledged batch updates header, normalizes all lines and deletes only removed lines', async () => {
  await engine.saveOrderWithLines('order', { customer_po: 'PO 中文', deposit_paid: 155 }, lines())
  assert.equal(fixture.commits, 1); assert.equal(fixture.batches.length, 1); assert.equal(fixture.acknowledged.length, 1)
  const ops = fixture.acknowledged[0]
  assert.deepEqual(ops[0], { kind: 'update', ref: { id: 'order', path: 'orders/order' }, data: { customer_po: 'PO 中文', deposit_paid: 155, updatedAt: 'FICTIONAL timestamp' } })
  assert.deepEqual(ops.map(o => o.kind), ['update', 'set', 'set', 'delete'])
  assert.equal(ops[1].ref.path, 'orders/order/lines/keep'); assert.equal(ops[1].data.unit_price, 1.222); assert.equal(ops[1].data.qty_ordered, 1000); assert.equal(ops[1].data.item_code, '中文 & item'); assert.deepEqual(ops[1].options, { merge: true })
  assert.equal(ops[2].ref.path, 'orders/order/lines/generated-1'); assert.equal(ops[2].data.unit_price, 3.125)
  assert.equal(ops[3].ref.path, 'orders/order/lines/removed')
})
test('a failed existing-line query stages no header or line mutation', async () => {
  fixture.readError = Error('Fictional read failure')
  await assert.rejects(engine.saveOrderWithLines('order', { notes: 'new' }, lines()), /Fictional read failure/)
  assert.deepEqual(fixture.batches, []); assert.equal(fixture.commits, 0)
})
test('a pending existing-line query stages nothing until it succeeds', async () => {
  fixture.readWait = deferred(); let settled = false
  const save = engine.saveOrderWithLines('order', {}, lines()).then(() => { settled = true })
  await Promise.resolve(); assert.equal(settled, false); assert.equal(fixture.batches.length, 0)
  fixture.readWait.resolve(); await save; assert.equal(fixture.commits, 1)
})
test('a staging failure never submits even the header already added to the batch', async () => {
  fixture.stageError = Error('Fictional invalid line')
  await assert.rejects(engine.saveOrderWithLines('order', {}, lines()), /Fictional invalid line/)
  assert.equal(fixture.commits, 0); assert.deepEqual(fixture.acknowledged, [])
})
test('commit stays pending until acknowledgement and surfaces a late rejection', async () => {
  fixture.commitWait = deferred(); let settled = false
  const save = engine.saveOrderWithLines('order', {}, lines()).finally(() => { settled = true })
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false); assert.equal(fixture.commits, 1)
  fixture.commitWait.reject(Error('Fictional late permissions failure'))
  await assert.rejects(save, /Fictional late permissions failure/); assert.equal(settled, true); assert.deepEqual(fixture.acknowledged, [])
})
test('an empty replacement deletes all existing lines in the same header batch', async () => {
  await engine.saveOrderWithLines('order', { notes: 'empty' }, [])
  assert.deepEqual(fixture.acknowledged[0].map(o => o.kind), ['update', 'delete', 'delete'])
})
test('the existing lines-only API retains its one-batch behavior without a header update', async () => {
  await engine.saveOrderLines('order', lines())
  assert.deepEqual(fixture.acknowledged[0].map(o => o.kind), ['set', 'set', 'delete'])
})
