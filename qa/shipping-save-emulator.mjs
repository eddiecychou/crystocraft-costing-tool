// Actual Shipping save, Firebase SDK and current rules. Fictional loopback only.
import { test, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, setDoc, getDocFromServer, getDocsFromServer, getDocFromCache, getDocs, disableNetwork, enableNetwork } from 'firebase/firestore'

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Explicit loopback Firestore emulator required; live writes forbidden.')
let env, db, engine, scratch, generation = 0
const clients = []
const withDisabled = callback => env.withSecurityRulesDisabled(async ctx => {
  const ownerDb = ctx.firestore()
  try { return await callback({ firestore: () => ownerDb }) }
  finally { await ownerDb.terminate() }
})
const seed = async () => withDisabled(async ctx => {
  const seedDb = ctx.firestore()
  await setDoc(doc(seedDb, 'users', 'shipping_admin'), { role: 'admin', status: 'approved' })
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
  db = env.authenticatedContext('shipping_admin').firestore(); clients.push(db); globalThis.__shippingSaveDb = db
  engine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?case=' + (++generation))
}, { timeout: 20000 })
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.terminate())) }, { timeout: 10000 })
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
  const customer = env.authenticatedContext('shipping_customer').firestore()
  clients.push(customer)
  // The real customer rules permit reading this assigned order and its lines,
  // but reject every write. Use a separately bundled handle to avoid replacing db.
  globalThis.__shippingSaveDb = customer
  const customerEngine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?customer')
  try { await assert.rejects(customerEngine.saveOrderWithLines('fictional-order', patch, lines), error => error.code === 'permission-denied') }
  finally { globalThis.__shippingSaveDb = db; await customer.terminate() }
  assert.equal((await getDocFromServer(orderRef())).data().notes, 'Original notes')
  assert.equal((await getDocFromServer(lineRef('keep'))).data().unit_price, 1)
  assert.equal((await getDocFromServer(lineRef('removed'))).exists(), true)
  assert.equal((await getDocsFromServer(collection(db, 'orders', 'fictional-order', 'lines'))).size, 2)
})

test('an offline cached save remains pending, applies locally as one batch, then acknowledges on reconnect', { timeout: 20000 }, async () => {
  // Populate both the document and line-query cache before disconnecting.
  await getDocFromServer(orderRef()); await getDocs(collection(db, 'orders', 'fictional-order', 'lines'))
  await disableNetwork(db)
  let result = 'pending'
  const save = engine.saveOrderWithLines('fictional-order', patch, lines).then(() => { result = 'committed' }, error => { result = error.code; throw error })
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
