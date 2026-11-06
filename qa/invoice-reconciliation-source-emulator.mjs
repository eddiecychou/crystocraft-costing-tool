// Actual strict financial-source reader, Firebase SDK and current rules.
// Fictional demo project on an explicit loopback emulator only; no live access.
// Run: node qa/invoice-reconciliation-source-emulator.mjs
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDocFromCache, disableNetwork, enableNetwork } from 'firebase/firestore'
import { runNodeTest } from './test-process.mjs'

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('Explicit loopback Firestore emulator required; live source reads/writes forbidden.')
}

if (process.env.OC_INVOICE_SOURCE_EMULATOR_CHILD !== '1') {
  // This parent deadline also kills a stalled SDK worker/cleanup, not just a
  // Promise in a still-running test process. Never force a successful exit.
  runNodeTest(['--test', fileURLToPath(import.meta.url)], {
    label: 'Invoice reconciliation strict-source emulator tests', timeoutMs: 75000,
    env: { ...process.env, OC_INVOICE_SOURCE_EMULATOR_CHILD: '1' },
  })
} else {
  const { test, before, beforeEach, afterEach, after } = await import('node:test')
  const projectId = 'demo-invoice-reconciliation-source'
  const orderId = 'fictional-financial-order'
  const source = {
    id: 'untrusted-embedded-id', source: 'manual',
    customer_id: 'fictional-customer', customer_name: ' Fictional Company  ',
    erp_si_no: 'SI269999', uc_no: 'UC9999/26', currency: 'USD',
    total_amount: 1222.123456, accounting_total: 0,
    adjustment_reason: 'Approved fictional adjustment',
    notes: ' 原始備註 / exact raw notes  ', customer_po: ' PO 中文 & special  ',
    invoice_date: '2026-11-06', invoiced_at: '2026-11-05', order_date: '',
    deposit_paid: null, pi_total: null, channel: null, woo_order_no: '',
    unrelated_preserved: { flag: false, sequence: 0 },
  }
  let environment, db, reader, scratch, generation = 0
  const clients = new Set()
  const withDisabled = callback => environment.withSecurityRulesDisabled(async context => {
    const ownerDb = context.firestore()
    try { return await callback(ownerDb) }
    finally { await ownerDb.terminate() }
  })

  before(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    const rules = await readFile('firestore.rules', 'utf8')
    environment = await initializeTestEnvironment({
      projectId, firestore: { host, port: Number(port), rules },
    })
    await mkdir('qa/out', { recursive: true })
    scratch = await mkdtemp(resolve('qa/out/invoice-reconciliation-source-engine-'))
    await build({
      entryPoints: ['src/invoiceReconciliation.js'], outfile: join(scratch, 'reader.mjs'),
      bundle: true, platform: 'node', format: 'esm', plugins: [{
        name: 'invoice-source-loopback-db', setup(builder) {
          builder.onResolve({ filter: /^(firebase\/.*|react)$/ }, args => ({ path: args.path, external: true }))
          builder.onResolve({ filter: /\/(firebase|criticalComponents|soNumber)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
            firebase: 'export const db=globalThis.__invoiceReconciliationSourceDb;',
            criticalComponents: 'export const buildProductIndex=()=>{},matchProductCode=()=>{};',
            soNumber: 'export const JES_SEED_BY_YEAR={},soYear=()=>{},formatSoNo=()=>{};',
          }[args.path] }))
        },
      }],
    })
    const hash = value => createHash('sha256').update(value).digest('hex')
    console.log('[invoice-source] source SHA256', hash(await readFile('src/invoiceReconciliation.js')))
    console.log('[invoice-source] rules SHA256', hash(rules))
  }, { timeout: 20000 })

  beforeEach(async () => {
    await environment.clearFirestore()
    await withDisabled(async ownerDb => {
      await setDoc(doc(ownerDb, 'users', 'fictional_finance_admin'), { role: 'admin', status: 'approved' })
      await setDoc(doc(ownerDb, 'orders', orderId), source)
    })
    // clearFirestore does not clear an existing SDK cache. Each case imports
    // the actual reader against a fresh authenticated client before any read.
    db = environment.authenticatedContext('fictional_finance_admin').firestore()
    clients.add(db)
    globalThis.__invoiceReconciliationSourceDb = db
    reader = await import(pathToFileURL(join(scratch, 'reader.mjs')).href + '?case=' + (++generation))
  }, { timeout: 20000 })

  afterEach(async () => {
    try { await Promise.all([...clients].map(client => client.terminate())) }
    finally { clients.clear(); delete globalThis.__invoiceReconciliationSourceDb }
  }, { timeout: 10000 })

  after(async () => {
    try { await environment?.cleanup() }
    finally {
      delete globalThis.__invoiceReconciliationSourceDb
      if (scratch) await rm(scratch, { recursive: true, force: true })
    }
  }, { timeout: 10000 })

  test('strict server read preserves exact raw fields and trusts the document ID over an embedded id', { timeout: 15000 }, async () => {
    const saved = await reader.getOrderForInvoiceSync(orderId)
    assert.deepEqual(saved, { ...source, id: orderId })
    assert.equal(saved.accounting_total, 0)
    assert.equal(saved.total_amount, 1222.123456)
    assert.equal(saved.notes, source.notes)
    assert.equal(saved.deposit_paid, null)
    assert.equal(saved.order_date, '')
    assert.equal('_raw' in saved, false)
    assert.equal(await reader.getOrderForInvoiceSync('fictional-missing-order'), null)
  })

  test('offline cached source cannot authorize a strict read; reconnect returns the newer server source', { timeout: 20000 }, async () => {
    assert.deepEqual(await reader.getOrderForInvoiceSync(orderId), { ...source, id: orderId })
    await disableNetwork(db)
    const revised = { ...source, notes: ' Updated on fictional server 中文  ', accounting_total: 1200.75 }
    await withDisabled(ownerDb => setDoc(doc(ownerDb, 'orders', orderId), revised))

    const cached = await getDocFromCache(doc(db, 'orders', orderId))
    assert.equal(cached.exists(), true)
    assert.equal(cached.metadata.fromCache, true)
    assert.equal(cached.data().notes, source.notes)
    assert.equal(cached.data().accounting_total, 0)
    await assert.rejects(reader.getOrderForInvoiceSync(orderId), error => error.code === 'unavailable')

    await enableNetwork(db)
    const fresh = await reader.getOrderForInvoiceSync(orderId)
    assert.deepEqual(fresh, { ...revised, id: orderId })
    assert.equal(fresh.accounting_total, 1200.75)
  })
}
