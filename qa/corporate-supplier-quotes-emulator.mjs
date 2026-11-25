import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocsFromServer, setDoc } from 'firebase/firestore'

const emulator = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '')
assert.ok(emulator, 'A loopback Firestore emulator is required')
const projectId = 'demo-corporate-quote-transaction'
const component = 'products/fictional-product/components/fictional-component'
const quotePath = component + '/supplier_quotes'
const staff = { role: 'staff', modules: ['supply'] }
const approvedQuote = {
  unit_cost: 1.222,
  volume_tiers: [{ min_qty: 1000, unit_cost: 1.111 }],
  attachments: [{ file_name: 'fictional-original.pdf', file_url: '/original.pdf' }],
  is_preferred: true,
  notes: 'Fictional approved terms',
}
let environment, scratch, saveA, saveB, dbA, dbB

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: emulator[1], port: Number(emulator[2]), rules: await readFile('firestore.rules', 'utf8') },
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/corporate-quote-tx-'))
  const bundle = join(scratch, 'writer.mjs')
  await build({
    entryPoints: ['src/corporateSupplierQuotes.js'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'emulator-clients',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'fixture' }))
        builder.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'fixture'
          ? { path: args.path, external: true }
          : { path: 'firestore', namespace: 'fixture' })
        builder.onLoad({ filter: /^db$/, namespace: 'fixture' }, () => ({
          contents: 'export const db = globalThis.corporateQuoteTestDb',
        }))
        builder.onLoad({ filter: /^firestore$/, namespace: 'fixture' }, () => ({
          contents: `
            import { getDocsFromServer as list, runTransaction as run } from 'firebase/firestore'
            export { collection, doc, serverTimestamp } from 'firebase/firestore'
            export async function getDocsFromServer(ref) {
              const result = await list(ref)
              await globalThis.corporateQuoteAfterList?.()
              return result
            }
            export function runTransaction(db, work) {
              return run(db, async tx => {
                const result = await work(tx)
                await globalThis.corporateQuoteAfterStaging?.()
                return result
              })
            }
          `,
        }))
      },
    }],
  })
  dbA = environment.authenticatedContext('fixture-editor-a').firestore()
  dbB = environment.authenticatedContext('fixture-editor-b').firestore()
  globalThis.corporateQuoteTestDb = dbA
  saveA = (await import(pathToFileURL(bundle).href + '?a')).saveCorporateSupplierQuote
  globalThis.corporateQuoteTestDb = dbB
  saveB = (await import(pathToFileURL(bundle).href + '?b')).saveCorporateSupplierQuote
}, { timeout: 30000 })

beforeEach(async () => {
  delete globalThis.corporateQuoteAfterList
  delete globalThis.corporateQuoteAfterStaging
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users/fixture-editor-a'), staff),
      setDoc(doc(db, 'users/fixture-editor-b'), staff),
      setDoc(doc(db, component), { name: 'Fictional component', qty_per_product: 2 }),
      setDoc(doc(db, quotePath, 'approved'), approvedQuote),
      setDoc(doc(db, quotePath, 'candidate'), { unit_cost: 1.333, is_preferred: false }),
    ])
  })
})

after(async () => {
  for (const key of ['corporateQuoteTestDb', 'corporateQuoteAfterList', 'corporateQuoteAfterStaging']) delete globalThis[key]
  await environment?.cleanup()
  if (scratch) await rm(scratch, { force: true, recursive: true })
})

const saveInput = {
  productId: 'fictional-product', componentId: 'fictional-component', isOpen: () => true,
}
async function quotes() {
  const result = await getDocsFromServer(collection(dbB, quotePath))
  return Object.fromEntries(result.docs.map(quote => [quote.id, quote.data()]))
}

test('a server-rejected commit preserves the old preference, pricing and attachment', { timeout: 20000 }, async () => {
  globalThis.corporateQuoteAfterStaging = async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/fixture-editor-a'), { role: 'staff', modules: [] })
    })
  }
  await assert.rejects(saveA({ ...saveInput, data: { unit_cost: 1.555, is_preferred: true } }),
    { code: 'permission-denied' })
  assert.deepEqual(await quotes(), {
    approved: approvedQuote, candidate: { unit_cost: 1.333, is_preferred: false },
  })
})

test('simultaneous creation and selection retry the shared component and leave one preferred quote', { timeout: 20000 }, async () => {
  let lists = 0
  let release
  const bothListed = new Promise(resolve => { release = resolve })
  globalThis.corporateQuoteAfterList = async () => {
    lists += 1
    if (lists === 2) release()
    await bothListed
  }
  const [newId] = await Promise.all([
    saveA({ ...saveInput, data: { unit_cost: 1.444, is_preferred: true } }),
    saveB({ ...saveInput, quoteId: 'candidate', data: { is_preferred: true } }),
  ])
  assert.ok(lists >= 3, 'one transaction needed to list again after the competing commit')
  const saved = await quotes()
  assert.equal(Object.keys(saved).length, 3)
  assert.deepEqual(saved.approved, { ...approvedQuote, is_preferred: false })
  assert.equal(saved.candidate.unit_cost, 1.333)
  assert.equal(saved[newId].unit_cost, 1.444)
  assert.ok(saved[newId].createdAt)
  assert.equal([saved.candidate, saved[newId]].filter(quote => quote.is_preferred).length, 1)
})
