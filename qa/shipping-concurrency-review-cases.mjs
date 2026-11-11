// REVIEW ONLY. Passing reproductions describe current behavior, including unsafe saves.
// Real Shipping save, Web SDK and access rules; two fictional loopback clients.
import { test, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeApp, deleteApp } from 'firebase/app'
import { invoiceReferenceSavePatch } from '../src/invoiceRecoveryModel.js'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  setDoc,
  getDocFromServer,
  getDocsFromServer,
  getDocFromCache,
  getDocs,
  disableNetwork,
  enableNetwork,
  getFirestore,
  connectFirestoreEmulator,
  terminate
} from 'firebase/firestore'

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
  throw Error('Explicit loopback Firestore emulator required; live writes forbidden.')
assert.match(process.env.QA_SHIPPING_REVIEW_CASE || '', /^case-\d+$/)
let env,
  db,
  otherDb,
  engine,
  otherEngine,
  scratch,
  generation = 0
const report = []
const clients = []
const makeClient = (actor) => {
  const app = initializeApp(
    {
      projectId: 'demo-shipping-concurrency-review',
      apiKey: 'fictional-review-key',
      appId: 'fictional-review'
    },
    actor + '-' + generation
  )
  const client = getFirestore(app)
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  connectFirestoreEmulator(client, host, Number(port), { mockUserToken: { sub: actor } })
  clients.push({ db: client, app })
  return client
}
const withDisabled = (callback) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    const ownerDb = ctx.firestore()
    try {
      return await callback({ firestore: () => ownerDb })
    } finally {
      await ownerDb.terminate()
    }
  })
const seed = async () =>
  withDisabled(async (ctx) => {
    const seedDb = ctx.firestore()
    await setDoc(doc(seedDb, 'users', 'shipping_admin'), {
      role: 'staff',
      status: 'approved',
      modules: ['shipping']
    })
    await setDoc(doc(seedDb, 'users', 'shipping_editor_b'), {
      role: 'staff',
      status: 'approved',
      modules: ['shipping']
    })
    await setDoc(doc(seedDb, 'users', 'shipping_customer'), {
      role: 'customer',
      status: 'approved',
      customer_id: 'fictional-customer'
    })
    await setDoc(doc(seedDb, 'orders', 'fictional-order'), {
      customer_id: 'fictional-customer',
      customer_name: 'Fictional Company',
      source: 'manual',
      currency: 'USD',
      notes: 'Original notes',
      stock_reserved: true,
      source_file: { name: 'Fictional original.pdf', path: 'fictional/source' }
    })
    await setDoc(doc(seedDb, 'orders', 'fictional-order', 'lines', 'keep'), {
      item_code: 'ORIGINAL',
      qty_ordered: 1000,
      unit_price: 1.222,
      line_no: 1,
      retained_unknown: 'preserved'
    })
    await setDoc(doc(seedDb, 'orders', 'fictional-order', 'lines', 'removed'), {
      item_code: 'REMOVE',
      qty_ordered: 2,
      unit_price: 2,
      line_no: 2
    })
  })
before(
  async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    env = await initializeTestEnvironment({
      projectId: 'demo-shipping-concurrency-review',
      firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') }
    })
    await mkdir('qa/out', { recursive: true })
    scratch = await mkdtemp(resolve('qa/out/shipping-concurrency-review/engine-'))
    await build({
      entryPoints: ['src/shipping.js'],
      outfile: join(scratch, 'engine.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [
        {
          name: 'shipping-emulator-db',
          setup(b) {
            b.onResolve({ filter: /^firebase\/firestore$/ }, (a) =>
              a.namespace === 'review-sdk'
                ? { path: a.path, external: true }
                : { path: 'sdk', namespace: 'review-sdk' }
            )
            b.onResolve({ filter: /^(firebase\/.*|react)$/ }, (a) => ({ path: a.path, external: true }))
            b.onLoad({ filter: /.*/, namespace: 'review-sdk' }, () => ({
              loader: 'js',
              contents: `
      export * from 'firebase/firestore';
      import {getDocs as read} from 'firebase/firestore';
      const owner=globalThis.__shippingSaveDb;
      export const getDocs=async(...args)=>{const snap=await read(...args);await globalThis.__shippingConcurrencyAfterRead?.(owner,snap);return snap};
    `
            }))
            b.onResolve({ filter: /\/(firebase|criticalComponents|soNumber)$/ }, (a) => ({
              path: a.path.split('/').at(-1),
              namespace: 'fixture'
            }))
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
              loader: 'js',
              contents: {
                firebase: 'export const db=globalThis.__shippingSaveDb;',
                criticalComponents: 'export const buildProductIndex=()=>{},matchProductCode=()=>{};',
                soNumber: 'export const JES_SEED_BY_YEAR={},soYear=()=>{},formatSoNo=()=>{};'
              }[a.path]
            }))
          }
        }
      ]
    })
  },
  { timeout: 20000 }
)
beforeEach(
  async () => {
    await env.clearFirestore()
    await seed()
    db = makeClient('shipping_admin')
    globalThis.__shippingSaveDb = db
    engine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?case=' + ++generation)
    otherDb = makeClient('shipping_editor_b')
    globalThis.__shippingSaveDb = otherDb
    otherEngine = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?other=' + generation)
    globalThis.__shippingSaveDb = db
  },
  { timeout: 20000 }
)
afterEach(
  async () => {
    delete globalThis.__shippingConcurrencyAfterRead
    await Promise.all(
      clients.splice(0).map(async (client) => {
        await terminate(client.db)
        await deleteApp(client.app)
      })
    )
  },
  { timeout: 10000 }
)
after(
  async () => {
    await writeFile(
      'qa/out/shipping-concurrency-review/' + process.env.QA_SHIPPING_REVIEW_CASE + '.json',
      JSON.stringify(report, null, 2) + '\n'
    )
    await env?.cleanup()
    if (scratch) await rm(scratch, { recursive: true, force: true })
    delete globalThis.__shippingSaveDb
  },
  { timeout: 10000 }
)

const orderId = 'fictional-order'
const load = async (api) => ({
  header: api.orderEditFields(await api.getOrder(orderId), {}),
  lines: await api.getOrderLines(orderId)
})
const save = async (api, draft) => {
  const totals = api.computeOrderTotals(draft.header, draft.lines)
  const accounting =
    draft.header.accounting_total === '' ? totals.total : Number(draft.header.accounting_total)
  return api.saveOrderWithLines(
    orderId,
    {
      ...api.orderSaveFields(draft.header, totals, accounting, accounting - totals.total),
      ...invoiceReferenceSavePatch(draft.header, draft.base || draft.header)
    },
    draft.lines
  )
}
const server = async () => ({
  header: (await getDocFromServer(doc(db, 'orders', orderId))).data(),
  lines: (await getDocsFromServer(collection(db, 'orders', orderId, 'lines'))).docs.map((d) => ({
    id: d.id,
    ...d.data()
  }))
})
const addedLine = () => ({
  item_code: 'ADDED-BY-A',
  qty_ordered: 2,
  unit_price: 3.125,
  line_no: 3
})
const linkedInvoice = async () =>
  withDisabled(async (ctx) => {
    const owner = ctx.firestore()
    await setDoc(doc(owner, 'orders', orderId, 'invoice_allocations', 'fictional-allocation'), {
      status: 'linked'
    })
    await setDoc(
      doc(owner, 'orders', orderId),
      {
        invoice_allocation_id: 'fictional-allocation',
        invoice_reference_revision: 0,
        erp_si_no: 'SI269001',
        uc_no: 'FICTIONAL-UC/26'
      },
      { merge: true }
    )
  })

test(
  'REPRODUCTION — a stale notes-only edit restores the older deposit and commercial header',
  { timeout: 20000 },
  async () => {
    const a = await load(engine),
      b = await load(otherEngine)
    a.header.deposit_paid = 155
    a.header.payment_terms = '30% Deposit, 70% Before Shipment'
    a.header.notes = 'Saved by editor A'
    await save(engine, a)
    b.header.notes = 'Editor B only changed these notes'
    await save(otherEngine, b)
    const actual = await server()
    assert.equal(actual.header.notes, b.header.notes)
    assert.equal(actual.header.deposit_paid, null)
    assert.equal(actual.header.payment_terms, '')
    assert.equal(actual.header.stock_reserved, true)
    assert.deepEqual(actual.header.source_file, {
      name: 'Fictional original.pdf',
      path: 'fictional/source'
    })
    report.push({ case: 'stale-header', newerDeposit: 155, afterStaleSave: actual.header.deposit_paid })
  }
)

test(
  'REPRODUCTION — an online stale save deletes the other editor’s added line and restores the old price',
  { timeout: 20000 },
  async () => {
    const a = await load(engine),
      b = await load(otherEngine)
    a.lines[0].unit_price = 1.333
    a.lines.push(addedLine())
    await save(engine, a)
    assert.equal((await server()).lines.length, 3)
    b.header.notes = 'Unrelated notes from B'
    await save(otherEngine, b)
    const actual = await server()
    assert.equal(actual.lines.length, 2)
    assert.equal(actual.lines.find((l) => l.id === 'keep').unit_price, 1.222)
    assert.equal(
      actual.lines.some((l) => l.item_code === 'ADDED-BY-A'),
      false
    )
    report.push({ case: 'added-line-lost', priceAfterA: 1.333, priceAfterB: 1.222, remainingLines: 2 })
  }
)

test(
  'REPRODUCTION — a stale save recreates a line already removed by the other editor',
  { timeout: 20000 },
  async () => {
    const a = await load(engine),
      b = await load(otherEngine)
    a.lines = a.lines.filter((l) => l.id !== 'removed')
    await save(engine, a)
    assert.equal(
      (await server()).lines.some((l) => l.id === 'removed'),
      false
    )
    b.header.notes = 'B kept the old line set'
    await save(otherEngine, b)
    const actual = await server()
    assert.equal(actual.lines.find((l) => l.id === 'removed').item_code, 'REMOVE')
    report.push({ case: 'deleted-line-restored', restoredId: 'removed' })
  }
)

test(
  'REPRODUCTION — a queued offline save can leave a header total that excludes an unseen new line',
  { timeout: 20000 },
  async () => {
    const a = await load(engine),
      b = await load(otherEngine)
    await disableNetwork(otherDb)
    let queued,
      reconnected = false
    try {
      a.lines.push(addedLine())
      await save(engine, a)
      b.header.notes = 'Saved offline by B'
      let acknowledged = false
      queued = save(otherEngine, b).then(() => {
        acknowledged = true
      })
      const deadline = Date.now() + 3000
      let cached
      do {
        cached = await getDocFromCache(doc(otherDb, 'orders', orderId))
        if (cached.data().notes === b.header.notes) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      } while (Date.now() < deadline)
      assert.equal(cached.data().notes, b.header.notes)
      assert.equal(cached.metadata.hasPendingWrites, true)
      assert.equal(acknowledged, false)
      await enableNetwork(otherDb)
      reconnected = true
      await queued
      const actual = await server()
      const recomputed = engine.computeOrderTotals(actual.header, actual.lines).total
      assert.equal(actual.lines.length, 3)
      assert.equal(actual.header.total_amount, 1226)
      assert.equal(recomputed, 1232.25)
      report.push({
        case: 'offline-hybrid',
        storedTotal: actual.header.total_amount,
        actualLineTotal: recomputed
      })
    } finally {
      if (!reconnected) await enableNetwork(otherDb)
      await queued
    }
  }
)

test(
  'REPRODUCTION — another save between line query and commit produces a mixed header and line set',
  { timeout: 20000 },
  async () => {
    const a = await load(engine),
      b = await load(otherEngine)
    let resume, ready
    const gate = new Promise((resolve) => {
      resume = resolve
    })
    const held = new Promise((resolve) => {
      ready = resolve
    })
    globalThis.__shippingConcurrencyAfterRead = async (owner) => {
      if (owner !== db) return
      ready()
      await gate
    }
    a.header.notes = 'A paused after reading lines'
    const pending = save(engine, a)
    try {
      await held
      b.lines.push(addedLine())
      await save(otherEngine, b)
    } finally {
      resume()
    }
    await pending
    const actual = await server()
    const recomputed = engine.computeOrderTotals(actual.header, actual.lines).total
    assert.equal(actual.header.notes, a.header.notes)
    assert.equal(actual.lines.length, 3)
    assert.equal(actual.header.total_amount, 1226)
    assert.equal(recomputed, 1232.25)
    report.push({
      case: 'read-commit-gap',
      storedTotal: actual.header.total_amount,
      actualLineTotal: recomputed
    })
  }
)

test(
  'CONTROL — existing invoice-reference protection rejects an old reference revision atomically',
  { timeout: 20000 },
  async () => {
    await linkedInvoice()
    const a = await load(engine),
      b = await load(otherEngine)
    a.base = { ...a.header }
    a.header.erp_si_no = 'SI269002'
    a.header.notes = 'A reviewed the new reference'
    await save(engine, a)
    b.header.notes = 'B still has the old reference'
    await assert.rejects(save(otherEngine, b), (error) => error.code === 'permission-denied')
    const actual = await server()
    assert.equal(actual.header.erp_si_no, 'SI269002')
    assert.equal(actual.header.invoice_reference_revision, 1)
    assert.equal(actual.header.notes, a.header.notes)
    report.push({ case: 'invoice-ref-control', staleSaveRejected: true, currentReference: 'SI269002' })
  }
)

test(
  'REPRODUCTION — the same linked invoice revision permits stale commercial edits',
  { timeout: 20000 },
  async () => {
    await linkedInvoice()
    const a = await load(engine),
      b = await load(otherEngine)
    a.lines[0].unit_price = 1.333
    a.header.deposit_paid = 155
    await save(engine, a)
    b.header.notes = 'B edited notes with unchanged invoice references'
    await save(otherEngine, b)
    const actual = await server()
    assert.equal(actual.header.erp_si_no, 'SI269001')
    assert.equal(actual.header.invoice_reference_revision, 0)
    assert.equal(actual.header.deposit_paid, null)
    assert.equal(actual.lines.find((l) => l.id === 'keep').unit_price, 1.222)
    report.push({
      case: 'invoice-commercial-gap',
      referencesProtected: true,
      commercialEditProtected: false
    })
  }
)

test(
  'CONTROL — a fresh second load preserves the first editor’s changes and exact decimals',
  { timeout: 20000 },
  async () => {
    const a = await load(engine)
    a.lines.push(addedLine())
    a.header.deposit_paid = 155
    await save(engine, a)
    const b = await load(otherEngine)
    b.header.notes = 'B edited after reloading'
    await save(otherEngine, b)
    const actual = await server()
    assert.equal(actual.lines.length, 3)
    assert.equal(actual.lines.find((l) => l.item_code === 'ADDED-BY-A').unit_price, 3.125)
    assert.equal(actual.header.deposit_paid, 155)
    assert.equal(actual.header.total_amount, 1232.25)
    assert.equal(actual.lines.find((l) => l.id === 'keep').retained_unknown, 'preserved')
    assert.ok(actual.header.updatedAt)
    assert.equal((await otherEngine.getOrder(orderId)).updatedAt, undefined)
    report.push({ case: 'fresh-load-control', changesPreserved: true, loadExposesUpdatedAt: false })
  }
)

test(
  'CONTROL — the assigned customer can read but cannot save the order or its lines',
  { timeout: 20000 },
  async () => {
    const customerDb = makeClient('shipping_customer')
    globalThis.__shippingSaveDb = customerDb
    const api = await import(pathToFileURL(join(scratch, 'engine.mjs')).href + '?customer=' + generation)
    const draft = await load(api)
    draft.header.notes = 'Forbidden customer edit'
    await assert.rejects(save(api, draft), (error) => error.code === 'permission-denied')
    assert.equal((await server()).header.notes, 'Original notes')
    report.push({ case: 'customer-control', writeDenied: true })
  }
)

test(
  'REPRODUCTION — sequential header and line reads can initialize a mixed-version editor',
  { timeout: 20000 },
  async () => {
    const olderHeader = otherEngine.orderEditFields(await otherEngine.getOrder(orderId), {})
    const a = await load(engine)
    a.header.deposit_paid = 155
    a.lines.push(addedLine())
    await save(engine, a)
    const laterLines = await otherEngine.getOrderLines(orderId)
    assert.equal(olderHeader.deposit_paid, '')
    assert.equal(laterLines.length, 3)
    assert.equal((await server()).header.deposit_paid, 155)
    report.push({
      case: 'mixed-load',
      loadedDeposit: olderHeader.deposit_paid,
      currentDeposit: 155,
      loadedLines: 3
    })
  }
)
