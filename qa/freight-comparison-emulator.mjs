import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDocFromServer, getDocsFromServer, collection, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

const emulator = process.env.FIRESTORE_EMULATOR_HOST || ''
assert.match(emulator, /^(127\.0\.0\.1|localhost):\d+$/, 'Loopback emulator required')
const [host, port] = emulator.split(':')
const projectId = 'demo-sh07-manual'
let env, scratch, admin, staff, customer, unauthenticated
let generation = 0

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', 'freight-admin'), { role: 'admin' })
    batch.set(doc(db, 'users', 'freight-staff'), { role: 'staff', modules: ['shipping'] })
    batch.set(doc(db, 'users', 'freight-customer'), { role: 'customer', status: 'approved', customer_id: 'fictional-company' })
    await batch.commit()
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/freight-emulator-'))
  await build({
    entryPoints: ['src/logistics.js'], outfile: join(scratch, 'logistics.mjs'),
    bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'freight-emulator', setup(plugin) {
      plugin.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'freight-sdk'
        ? { path: args.path, external: true } : { path: 'sdk', namespace: 'freight-sdk' })
      plugin.onResolve({ filter: /^react$/ }, args => ({ path: args.path, external: true }))
      plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'freight-db' }))
      plugin.onLoad({ filter: /.*/, namespace: 'freight-db' }, () => ({
        contents: 'export const db = globalThis.__freightTestDb;', loader: 'js',
      }))
      plugin.onLoad({ filter: /.*/, namespace: 'freight-sdk' }, () => ({
        contents: `
          export * from 'firebase/firestore';
          import {runTransaction as execute, doc} from 'firebase/firestore';
          export async function runTransaction(db, task) {
            const result = await execute(db, async tx => {
              const value = await task(tx);
              if (globalThis.__freightReject) tx.set(doc(db,'invoice_followup_jobs/fictional-denied'), {});
              return value;
            });
            if (globalThis.__freightLoseAck) throw Error('Fictional lost acknowledgement');
            return result;
          }
        `, loader: 'js',
      }))
    } }],
  })
  async function engine(uid) {
    const db = (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore()
    globalThis.__freightTestDb = db
    return { db, model: await import(pathToFileURL(join(scratch, 'logistics.mjs')).href + '?' + ++generation) }
  }
  admin = await engine('freight-admin')
  staff = await engine('freight-staff')
  customer = await engine('freight-customer')
  unauthenticated = await engine()
}, { timeout: 20000 })

after(async () => {
  await env?.cleanup()
  if (scratch) await rm(scratch, { recursive: true, force: true })
  delete globalThis.__freightTestDb
})

function quoteData(orderId, chosen, amount) {
  return { order_id: orderId, vendor_name: 'Fictional vendor', is_chosen: chosen,
    scenario_id: orderId+'-packing', cargo_basis: { cartons: 2, cbm: 0.27 }, currency: 'USD',
    quoted_total: amount, quoted_total_hkd: amount * 7.7, breakdown: { freight: 101.23, duties_included: false },
    decision_notes: 'Keep this commercial snapshot' }
}
const quote = (db, id) => doc(db, 'freight_quotes', id)
const decision = (db, order) => doc(db, 'freight_decisions', order)
const read = async ref => (await getDocFromServer(ref)).data()
async function seed(order, multiple = false) {
  const batch = writeBatch(admin.db)
  batch.set(doc(admin.db, 'orders', order), { customer_id: 'fictional-company' })
  batch.set(quote(admin.db, order+'-a'), quoteData(order, true, 100))
  batch.set(quote(admin.db, order+'-b'), quoteData(order, multiple, 110))
  batch.set(doc(admin.db, 'packing_lists', order+'-packing'), { order_id: order, label: 'QA packing', totals: { cbm: 0.27, carton_count: 2 } })
  await batch.commit()
}

test('legacy choice, Choose and Unmark preserve every quote field and the saved currency amounts', async () => {
  const order = 'freight-preserve'
  await seed(order)
  const previous = await admin.model.loadOrderFreight(order)
  assert.deepEqual(previous.choice, { chosenId: order+'-a', ambiguous: false })
  await staff.model.setFreightChoice(order, order+'-b', true)
  const chosen = await admin.model.loadOrderFreight(order)
  assert.deepEqual(chosen.choice, { chosenId: order+'-b', ambiguous: false })
  assert.deepEqual(chosen.quotes, previous.quotes)
  await admin.model.setFreightChoice(order, order+'-b', false)
  assert.equal((await admin.model.loadOrderFreight(order)).choice.chosenId, null)
  assert.deepEqual((await admin.model.loadOrderFreight(order)).quotes, previous.quotes)
})

test('a rejected transaction leaves the previous confirmed decision intact', async () => {
  const order = 'freight-reject'
  await seed(order)
  await admin.model.setFreightChoice(order, order+'-a', true)
  const prior = await read(decision(admin.db, order))
  globalThis.__freightReject = true
  try { await assertFails(staff.model.setFreightChoice(order, order+'-b', true)) }
  finally { delete globalThis.__freightReject }
  assert.deepEqual(await read(decision(admin.db, order)), prior)
})

test('two concurrent clients converge on one choice and stale Unmark preserves the newer choice', async () => {
  const order = 'freight-concurrent'
  await seed(order)
  await Promise.all([
    admin.model.setFreightChoice(order, order+'-a', true),
    staff.model.setFreightChoice(order, order+'-b', true),
  ])
  const { choice } = await admin.model.loadOrderFreight(order)
  assert.ok([order+'-a', order+'-b'].includes(choice.chosenId))
  const other = choice.chosenId === order+'-a' ? order+'-b' : order+'-a'
  await staff.model.setFreightChoice(order, other, false)
  assert.deepEqual((await staff.model.loadOrderFreight(order)).choice, choice)
})

test('lost decision acknowledgement is visible on readback and repeating the same choice is a no-op', async () => {
  const order = 'freight-decision-ack'
  await seed(order)
  globalThis.__freightLoseAck = true
  try { await assert.rejects(admin.model.setFreightChoice(order, order+'-b', true), /lost acknowledgement/) }
  finally { delete globalThis.__freightLoseAck }
  const prior = await read(decision(admin.db, order))
  assert.equal(prior.quote_id, order+'-b')
  await staff.model.setFreightChoice(order, order+'-b', true)
  assert.deepEqual(await read(decision(admin.db, order)), prior)
})

test('deleting a chosen quote clears its decision in the same commit', async () => {
  const order = 'freight-delete'
  await seed(order)
  await admin.model.setFreightChoice(order, order+'-a', true)
  await assertFails(deleteDoc(quote(admin.db, order+'-a')))
  await staff.model.deleteOrderFreightQuote(order, order+'-a')
  const saved = await admin.model.loadOrderFreight(order)
  assert.equal(saved.choice.chosenId, null)
  assert.deepEqual(saved.quotes.map(row => row.id), [order+'-b'])
})

test('historical duplicate flags are surfaced and an explicit choice resolves them without rewriting quotes', async () => {
  const order = 'freight-legacy'
  await seed(order, true)
  const before = await admin.model.loadOrderFreight(order)
  assert.deepEqual(before.choice, { chosenId: null, ambiguous: true })
  await admin.model.setFreightChoice(order, order+'-b', true)
  const after = await admin.model.loadOrderFreight(order)
  assert.deepEqual(after.choice, { chosenId: order+'-b', ambiguous: false })
  assert.deepEqual(after.quotes, before.quotes)
})

test('fresh quote cargo preserves zero and manual overrides, and missing values are null', async () => {
  const order = 'freight-cargo'
  await seed(order)
  const scenarioId = order+'-packing'
  const scenario = { totals: { cbm: 0, carton_count: 2 } }
  await updateDoc(doc(admin.db, 'packing_lists', scenarioId), { totals: scenario.totals })
  const data = { ...quoteData(order, false, 120), scenario_id: scenarioId,
    cargo_basis: { ...admin.model.freightScenarioCargo(scenario), cartons: 4 } }
  const id = admin.model.newFreightQuoteId()
  const created = await admin.model.createOrderFreightQuote(id, data, { USD: 8 }, scenario)
  assert.deepEqual(created.cargo_basis, { cbm: 0, cartons: 4, chargeable_weight_kg: null })
  assert.equal(created.scenario_label, 'QA packing')
  assert.equal(created.quoted_total_hkd, 960)
  assert.equal((await read(quote(admin.db, id))).scenario_id, scenarioId)
})

test('changed, deleted or wrong-order packing scenarios cannot save stale cargo', async () => {
  const order = 'freight-scenario-a'
  const other = 'freight-scenario-b'
  await seed(order)
  await seed(other)
  const scenarioId = order+'-packing'
  const data = { ...quoteData(order, false, 120), scenario_id: scenarioId }
  const id = admin.model.newFreightQuoteId()
  for (const [target, snapshot] of [[scenarioId, { totals: { cbm: 99 } }], [other+'-packing', { totals: { cbm: 0.27, carton_count: 2 } }], ['missing', null]]) {
    await assert.rejects(admin.model.createOrderFreightQuote(id, { ...data, scenario_id: target }, { USD: 8 }, snapshot), /packing scenario changed/)
  }
  assert.equal(await read(quote(admin.db, id)), undefined)
})

test('retrying an unlinked quote after a lost response reuses the document and saved price', async () => {
  const order = 'freight-create-ack'
  await seed(order)
  const data = { ...quoteData(order, false, 120), scenario_id: '', cargo_basis: { cartons: 3 } }
  const id = admin.model.newFreightQuoteId()
  const before = (await getDocsFromServer(collection(admin.db, 'freight_quotes'))).size
  globalThis.__freightLoseAck = true
  try { await assert.rejects(admin.model.createOrderFreightQuote(id, data, { USD: 8 }), /lost acknowledgement/) }
  finally { delete globalThis.__freightLoseAck }
  const again = await admin.model.createOrderFreightQuote(id, data, { USD: 9 })
  assert.equal(again.quoted_total_hkd, 960)
  assert.equal(again.scenario_id, null)
  assert.equal(again.cargo_basis.cartons, 3)
  assert.equal((await getDocsFromServer(collection(admin.db, 'freight_quotes'))).size, before + 1)
})

test('rules restrict freight decisions and validate target ownership without exposing customer-linked order data', async () => {
  const order = 'freight-rules-a'
  const other = 'freight-rules-b'
  await seed(order)
  await seed(other)
  const valid = { quote_id: order+'-a', updated_at: serverTimestamp() }
  await admin.model.setFreightChoice(order, order+'-a', true)
  for (const client of [customer, unauthenticated]) {
    await assertFails(getDocFromServer(decision(client.db, order)))
    await assertFails(setDoc(decision(client.db, order), valid))
  }
  await assertFails(setDoc(decision(staff.db, order), { ...valid, quote_id: other+'-a' }))
  await assertFails(setDoc(decision(staff.db, order), { ...valid, quote_id: 'missing' }))
  await assertFails(setDoc(decision(staff.db, order), { ...valid, quote_id: 7 }))
  await assertFails(setDoc(decision(staff.db, order), { ...valid, quote_id: '../malformed' }))
  await assertFails(setDoc(decision(staff.db, order), { ...valid, private_notes: 'Unexpected' }))
  await assertFails(setDoc(decision(staff.db, 'missing'), { ...valid, quote_id: null }))
  await assertFails(deleteDoc(decision(staff.db, order)))
  await assertFails(updateDoc(quote(staff.db, order+'-a'), { order_id: other }))
  await assertFails(updateDoc(quote(staff.db, order+'-a'), { is_chosen: false }))
  await assert.rejects(admin.model.setFreightChoice(order, other+'-a', true), /no longer available for this order/)
  assert.equal((await read(decision(admin.db, order))).quote_id, order+'-a')
})
