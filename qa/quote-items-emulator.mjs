import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocFromServer, getDocsFromServer, setDoc, updateDoc } from 'firebase/firestore'
import { rangeQuoteChoices } from '../src/rangeQuote.js'

const emulator = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '')
assert.ok(emulator, 'A loopback Firestore emulator is required')
const quotePath = 'client_quotes/fixture-quote'
const itemPath = `${quotePath}/items`
const ratePath = 'settings/exchange_rates'
const header = { quote_currency: 'EUR', usd_to_hkd: '8.25', eur_to_hkd: 9.45, item_count: 99, notes: 'Keep these terms' }
const original = { is_custom: true, product_id: null, tiers: [{ quantity: 20, price: 12.34, currency: 'EUR' }] }
const corporate = { id: 'fixture-gift', key: 'products:fixture-gift', name: 'Fictional gift', category: 'Gifts', status: 'active', source: 'products' }
const [red, blue, manual] = rangeQuoteChoices({ id: 'fixture-range', design_name: 'Fictional Range', moq: 100,
  variants: [{ sku: 'SAME', ws_price_usd: 10 }, { sku: 'SAME', ws_price_usd: 12 }, { sku: 'MANUAL' }],
})
let env, scratch, writerA, writerB, restricted, dbA, dbB

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-quote-item-saves',
    firestore: { host: emulator[1], port: Number(emulator[2]), rules: await readFile('firestore.rules', 'utf8') },
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/quote-items-tx-'))
  const bundle = join(scratch, 'writer.mjs')
  await build({ entryPoints: ['src/quoteItems.js'], outfile: bundle, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'quote-item-test-boundary', setup(builder) {
      builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'fixture' }))
      builder.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'fixture'
        ? { path: args.path, external: true } : { path: 'firestore', namespace: 'fixture' })
      builder.onLoad({ filter: /^db$/, namespace: 'fixture' }, () => ({ contents: 'export const db = globalThis.quoteItemsTestDb' }))
      builder.onLoad({ filter: /^firestore$/, namespace: 'fixture' }, () => ({ contents: `
        import { runTransaction as run, getDocFromServer as read } from 'firebase/firestore'
        export * from 'firebase/firestore'
        export async function getDocFromServer(ref) {
          await globalThis.quoteItemsTestRead?.(ref.path)
          return read(ref)
        }
        export async function runTransaction(db, work) {
          const result = await run(db, async tx => {
            const count = await work(tx)
            await globalThis.quoteItemsTestStaged?.(db)
            return count
          })
          await globalThis.quoteItemsTestCommitted?.(db)
          return result
        }`,
      }))
    } }],
  })
  dbA = env.authenticatedContext('quote-editor-a').firestore()
  dbB = env.authenticatedContext('quote-editor-b').firestore()
  globalThis.quoteItemsTestDb = dbA
  writerA = await import(pathToFileURL(bundle).href + '?a')
  globalThis.quoteItemsTestDb = dbB
  writerB = await import(pathToFileURL(bundle).href + '?b')
  globalThis.quoteItemsTestDb = env.authenticatedContext('quote-editor-restricted').firestore()
  restricted = await import(pathToFileURL(bundle).href + '?restricted')
}, { timeout: 30000 })

const faultHooks = ['quoteItemsTestRead', 'quoteItemsTestStaged', 'quoteItemsTestCommitted']
const asAdmin = work => env.withSecurityRulesDisabled(context => work(context.firestore()))
beforeEach(async () => {
  for (const key of faultHooks) delete globalThis[key]
  await env.clearFirestore()
  await asAdmin(async db => {
    await Promise.all([
      setDoc(doc(db, 'users/quote-editor-a'), { role: 'staff', modules: ['quotes', 'supply'] }),
      setDoc(doc(db, 'users/quote-editor-b'), { role: 'staff', modules: ['quotes', 'supply'] }),
      setDoc(doc(db, 'users/quote-editor-restricted'), { role: 'staff', modules: ['quotes'] }),
      setDoc(doc(db, quotePath), header), setDoc(doc(db, itemPath, 'original'), original),
      setDoc(doc(db, ratePath), { USD: 9.1, EUR: 12 }),
      setDoc(doc(db, 'products/fixture-gift/pricing_tiers/tier'), { quantity: 100, price_hkd: 94.5 }),
      setDoc(doc(db, 'products/fixture-gift/components/part'), { qty_per_product: 2 }),
      setDoc(doc(db, 'products/fixture-gift/components/part/supplier_quotes/vendor'), {
        is_preferred: true, unit_cost: 10, unit_cost_currency: 'USD', tooling_sample_cost: 5, tooling_sample_cost_currency: 'USD',
      }),
    ])
  })
})

after(async () => {
  for (const key of [...faultHooks, 'quoteItemsTestDb']) delete globalThis[key]
  await env?.cleanup()
  if (scratch) await rm(scratch, { force: true, recursive: true })
})

async function loadQuote() {
  const [savedHeader, savedLines] = await Promise.all([
    getDocFromServer(doc(dbB, quotePath)), getDocsFromServer(collection(dbB, itemPath)),
  ])
  return { saved: savedHeader.data(), lines: Object.fromEntries(savedLines.docs.map(line => [line.id, line.data()])) }
}
const save = (writer, choices, quote = header) => writer.addQuoteProducts('fixture-quote', quote, choices)

test('mixed add uses agreed sale prices, current supplier rates and one truthful count', { timeout: 20000 }, async () => {
  let rateReads = 0
  globalThis.quoteItemsTestRead = path => { if (path === ratePath) rateReads++ }
  assert.equal(await save(writerA, [corporate, red, blue]), 4)
  const { saved, lines } = await loadQuote()
  assert.deepEqual({ ...saved, updatedAt: undefined }, { ...header, item_count: 4, updatedAt: undefined })
  assert.deepEqual(lines.original, original)
  const gift = Object.values(lines).find(line => line.product_collection === 'products')
  assert.deepEqual([gift.tiers[0].price, gift.unit_cost_hkd, gift.tooling_cost_hkd], [10, 182, 45.5])
  const variants = Object.values(lines).filter(line => line.product_collection === 'range_products')
    .sort((a, b) => a.product_variant_index - b.product_variant_index)
  assert.deepEqual(variants.map(line => [line.product_variant_sku, line.product_variant_index, line.tiers[0].price]),
    [['SAME', 0, 8.73], ['SAME', 1, 10.48]])
  assert.equal(rateReads, 1)
})

test('missing agreed or supplier rates prevent all mixed writes', { timeout: 20000 }, async () => {
  const legacy = { ...header, eur_to_hkd: null }
  await setDoc(doc(dbA, quotePath), legacy)
  await assert.rejects(save(writerA, [corporate, red], legacy), /agreed EUR/)
  assert.deepEqual(await loadQuote(), { saved: legacy, lines: { original } })
  await setDoc(doc(dbA, quotePath), header)
  await asAdmin(db => setDoc(doc(db, ratePath), { USD: '9.10' }))
  await assert.rejects(save(writerA, [corporate, red]), /supplier cost and HKD rate for USD/)
  assert.deepEqual(await loadQuote(), { saved: header, lines: { original } })
})

test('a change to agreed rates during preparation leaves all existing lines intact', { timeout: 20000 }, async () => {
  globalThis.quoteItemsTestRead = async path => {
    if (path === ratePath) await updateDoc(doc(dbB, quotePath), { eur_to_hkd: 9.75 })
  }
  await assert.rejects(save(writerA, [corporate, red]), /currency or agreed rates changed/)
  assert.deepEqual(await loadQuote(), { saved: { ...header, eur_to_hkd: 9.75 }, lines: { original } })
})

test('a server rejection after staging commits neither lines nor the header', { timeout: 20000 }, async () => {
  globalThis.quoteItemsTestStaged = async () => {
    await asAdmin(db => updateDoc(doc(db, 'users/quote-editor-a'), { modules: [] }))
  }
  await assert.rejects(save(writerA, [corporate, red]), { code: 'permission-denied' })
  assert.deepEqual(await loadQuote(), { saved: header, lines: { original } })
})

test('lost confirmation retries recognize saved choices even when Settings becomes unavailable', { timeout: 20000 }, async () => {
  globalThis.quoteItemsTestCommitted = () => { throw Error('Fictional response lost after commit') }
  await assert.rejects(save(writerA, [corporate, red]), /response lost/)
  const beforeRetry = await loadQuote()
  assert.equal(beforeRetry.saved.item_count, 3)
  assert.equal(Object.keys(beforeRetry.lines).length, 3)
  delete globalThis.quoteItemsTestCommitted
  globalThis.quoteItemsTestRead = () => { throw Error('Unexpected Settings read on committed retry') }
  assert.equal(await save(writerA, [corporate, red]), 3)
  assert.deepEqual(await loadQuote(), beforeRetry)
})

test('two editors adding overlapping selections contend on the same header', { timeout: 20000 }, async () => {
  const staged = new Set()
  const barrier = Promise.withResolvers()
  globalThis.quoteItemsTestStaged = async db => {
    staged.add(db)
    if (staged.size === 2) barrier.resolve()
    await barrier.promise
  }
  await Promise.all([save(writerA, [corporate, red]), save(writerB, [corporate, blue])])
  const { saved, lines } = await loadQuote()
  assert.equal(saved.item_count, 4)
  assert.equal(Object.keys(lines).length, 4)
  assert.equal(Object.values(lines).filter(line => line.product_collection === 'products').length, 1)
  assert.deepEqual(lines.original, original)
})

test('custom line and removal saves use the same count and permit intentional re-add', { timeout: 20000 }, async () => {
  await Promise.all([save(writerA, [red]), writerB.addCustomQuoteItem('fixture-quote')])
  let state = await loadQuote()
  assert.equal(state.saved.item_count, 3)
  const catalogueId = Object.keys(state.lines).find(id => state.lines[id].product_collection === 'range_products')
  await Promise.all([writerA.removeQuoteItem('fixture-quote', catalogueId), save(writerB, [blue])])
  state = await loadQuote()
  assert.equal(state.saved.item_count, 3)
  assert.equal(state.lines[catalogueId], undefined)
  await save(writerA, [red])
  assert.equal((await loadQuote()).saved.item_count, 4)
})

test('legacy SKU-only lines keep their price and conservatively cover matching choices', { timeout: 20000 }, async () => {
  const legacy = { product_id: red.productId, product_collection: 'range_products', product_variant_sku: red.sku,
    tiers: [{ quantity: 200, price: 71, currency: 'EUR' }] }
  await setDoc(doc(dbA, itemPath, 'legacy-random-id'), legacy)
  assert.equal(await save(writerA, [red, blue, manual]), 3)
  const { saved, lines } = await loadQuote()
  assert.equal(saved.item_count, 3)
  assert.deepEqual(lines['legacy-random-id'], legacy)
  assert.equal(Object.values(lines).find(line => line.product_variant_index === manual.variantIndex).tiers[0].price, '')
})

test('quotes-only staff retain Range access and get a safe error for a mixed supplier-cost read', { timeout: 20000 }, async () => {
  await assert.rejects(save(restricted, [corporate, red]), /pricing tiers or supplier costs could not be loaded/)
  assert.deepEqual(await loadQuote(), { saved: header, lines: { original } })
  assert.equal(await save(restricted, [red]), 2)
  assert.equal((await loadQuote()).saved.item_count, 2)
})
