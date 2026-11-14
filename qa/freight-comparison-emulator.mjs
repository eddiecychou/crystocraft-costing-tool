import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { doc, getDocFromServer, getDocsFromServer, collection, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { createPackingFreight } from '../netlify/functions/lib/packingFreight.js'
import { freightPackingBasis, freightPackingStatus } from '../src/freightQuoteModel.js'

const emulator = process.env.FIRESTORE_EMULATOR_HOST || ''
assert.match(emulator, /^(127\.0\.0\.1|localhost):\d+$/, 'Loopback emulator required')
const [host, port] = emulator.split(':')
const projectId = 'demo-sh07-manual'
let env, scratch, admin, staff, customer, unauthenticated, app, serverDb, handleRequest, missingPermission
let generation = 0

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', 'freight-admin'), { role: 'admin' })
    batch.set(doc(db, 'users', 'freight-staff'), { role: 'staff', modules: ['shipping'] })
    batch.set(doc(db, 'users', 'freight-other-staff'), { role: 'staff', modules: ['products'] })
    batch.set(doc(db, 'users', 'freight-customer'), { role: 'customer', status: 'approved', customer_id: 'fictional-company' })
    await batch.commit()
  })
  app = initializeApp({ projectId }, 'fictional-packing-freight')
  serverDb = getAdminFirestore(app)
  handleRequest = orderRequestHandler({
    verifyToken: async uid => ({ uid }),
    getProfile: async uid => (await serverDb.doc('users/' + uid).get()).data(),
    packingFreight: createPackingFreight(serverDb),
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/freight-emulator-'))
  await build({
    stdin: {
      contents: "export * from './src/logistics.js'; export { deleteScenario, savePackingScenario, loadPackingScenario } from './src/packing.js';",
      resolveDir: resolve('.'),
    },
    outfile: join(scratch, 'logistics.mjs'),
    bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'freight-emulator', setup(plugin) {
      plugin.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'freight-sdk'
        ? { path: args.path, external: true } : { path: 'sdk', namespace: 'freight-sdk' })
      plugin.onResolve({ filter: /^react$/ }, args => ({ path: args.path, external: true }))
      plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'freight-db' }))
      plugin.onLoad({ filter: /.*/, namespace: 'freight-db' }, () => ({
        contents: 'export const db = globalThis.__freightTestDb;', loader: 'js',
      }))
      plugin.onResolve({ filter: /^\.\/shippingOrderApi\.js$/ }, () => ({ path: 'api', namespace: 'freight-api' }))
      plugin.onLoad({ filter: /.*/, namespace: 'freight-api' }, () => ({
        contents: `
          const request = globalThis.__freightRequest;
          const uid = globalThis.__freightTestUid;
          export const orderRequestAction = (action, details) => request(uid, action, details);
        `, loader: 'js',
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
  globalThis.__freightRequest = async (uid, action, details) => {
    const response = await handleRequest(new Request('http://localhost/api/shipping-order-request', {
      method: 'POST', headers: uid ? { Authorization: 'Bearer ' + uid } : {},
      body: JSON.stringify({ action, ...details }),
    }))
    const result = await response.json()
    if (!response.ok) throw Object.assign(Error(result.error), { code: result.code, status: response.status })
    if (globalThis.__freightLoseAck) throw Error('Fictional lost acknowledgement')
    return result
  }
  async function engine(uid) {
    const db = (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore()
    globalThis.__freightTestDb = db
    globalThis.__freightTestUid = uid
    const call = (action, body) => globalThis.__freightRequest(uid, action, body)
    return { db, call, model: await import(pathToFileURL(join(scratch, 'logistics.mjs')).href + '?' + ++generation) }
  }
  admin = await engine('freight-admin')
  staff = await engine('freight-staff')
  customer = await engine('freight-customer')
  unauthenticated = await engine()
  missingPermission = await engine('freight-other-staff')
}, { timeout: 20000 })

after(async () => {
  await env?.cleanup()
  if (app) await deleteApp(app)
  if (scratch) await rm(scratch, { recursive: true, force: true })
  delete globalThis.__freightTestDb
  delete globalThis.__freightTestUid
  delete globalThis.__freightRequest
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
  const batch = serverDb.batch()
  batch.set(serverDb.doc('orders/' + order), { customer_id: 'fictional-company' })
  batch.set(serverDb.doc('freight_quotes/' + order + '-a'), quoteData(order, true, 100))
  batch.set(serverDb.doc('freight_quotes/' + order + '-b'), quoteData(order, multiple, 110))
  batch.set(serverDb.doc('packing_lists/' + order + '-packing'), { order_id: order, label: 'QA packing', totals: { cbm: 0.27, carton_count: 2 } })
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
  await serverDb.doc('packing_lists/' + scenarioId).update({ totals: scenario.totals })
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

async function packingFixture(order, revision = 'initial-revision') {
  const id = order + '-packing'
  const carton = 'packing_lists/' + id + '/cartons/first'
  await serverDb.doc('orders/' + order).set({ status: 'draft', customer_id: 'fictional-company' })
  const scenario = {
    order_id: order, label: 'Fictional mixed cargo', packing_save_id: revision,
    totals: { cbm: 0.27, carton_count: 2, chargeable_weight_kg: 28 },
  }
  await serverDb.doc('packing_lists/' + id).set(scenario)
  await serverDb.doc(carton).set({ carton_seq: 1, carton_count: 2 })
  await serverDb.doc(carton + '/contents/item').set({ item_code: 'QA-01', qty: 6, unit: 'pair' })
  return { ...scenario, id }
}

const packingDoc = (db, scenario) => doc(db, 'packing_lists', scenario.id)
const fixtureQuote = scenario => ({
  ...quoteData(scenario.order_id, false, 145.25),
  cargo_basis: { ...freightPackingBasis(scenario).cargo, chargeable_weight_kg: 31 },
  source_file: { name: 'fictional-rate.pdf', url: 'https://example.invalid/fictional-rate.pdf' },
})

async function revisePacking(client, scenario, attemptId, qty = 7) {
  const { cartons } = await client.model.loadPackingScenario(scenario.id, scenario.order_id)
  return client.model.savePackingScenario({
    scenario, previous: cartons,
    cartons: cartons.map(carton => ({
      ...carton, contents: carton.contents.map(item => ({ ...item, qty })),
    })),
    patch: { totals: scenario.totals }, orderLines: [], attemptId, isNew: false,
  })
}

test('same-totals edits reject a stale quote and a stale delete; the latest revision saves', async () => {
  const scenario = await packingFixture('packing-same-totals')
  const latest = (await revisePacking(admin, scenario, 'contents-only-edit')).scenario
  assert.deepEqual(latest.totals, scenario.totals)
  const id = staff.model.newFreightQuoteId()
  const data = fixtureQuote(scenario)
  await assert.rejects(staff.model.createOrderFreightQuote(id, data, { USD: 8 }, scenario),
    { code: 'freight/scenario-changed' })
  assert.equal(await read(quote(admin.db, id)), undefined)
  await assert.rejects(staff.model.deleteScenario(scenario), /changed elsewhere/)
  assert.equal((await staff.model.loadPackingScenario(scenario.id, scenario.order_id)).cartons[0].contents[0].qty, 7)
  const saved = await staff.model.createOrderFreightQuote(id, data, { USD: 8 }, latest)
  assert.equal(saved.scenario_revision, 'contents-only-edit')
  assert.equal(saved.quoted_total, 145.25)
  assert.equal(saved.quoted_total_hkd, 1162)
  assert.equal(saved.cargo_basis.chargeable_weight_kg, 31)
})

test('quote-first deletion is blocked, and later edits preserve the full chosen quote and decision', async () => {
  const scenario = await packingFixture('packing-quote-first')
  const order = scenario.order_id
  const id = staff.model.newFreightQuoteId()
  await staff.model.createOrderFreightQuote(id, fixtureQuote(scenario), { USD: 8 }, scenario)
  await assert.rejects(admin.model.deleteScenario(scenario), { code: 'packing/freight-linked' })
  await staff.model.setFreightChoice(order, id, true)
  const beforeQuote = await read(quote(admin.db, id))
  const beforeDecision = await read(decision(admin.db, order))
  const { scenario: latest } = await revisePacking(admin, scenario, 'new-packing-edit')
  assert.equal(freightPackingStatus(beforeQuote, scenario), 'current')
  assert.equal(freightPackingStatus(beforeQuote, latest), 'changed')
  assert.deepEqual(await read(quote(admin.db, id)), beforeQuote)
  assert.deepEqual(await read(decision(admin.db, order)), beforeDecision)
  assert.equal((await admin.model.loadOrderFreight(order)).choice.chosenId, id)
  assert.equal(beforeQuote.breakdown.freight, 101.23)
  assert.equal(beforeQuote.source_file.name, 'fictional-rate.pdf')
  await assert.rejects(admin.model.deleteScenario(latest), { code: 'packing/freight-linked' })
})

test('deletion-first removes all descendants and an older quote cannot recreate them', async () => {
  const scenario = await packingFixture('packing-delete-first')
  const id = staff.model.newFreightQuoteId()
  assert.deepEqual(await admin.model.deleteScenario(scenario), { deleted: true })
  assert.deepEqual(await admin.model.deleteScenario(scenario), { deleted: false })
  await assert.rejects(staff.model.createOrderFreightQuote(id, fixtureQuote(scenario), { USD: 8 }, scenario),
    { code: 'freight/scenario-changed' })
  for (const path of ['', '/cartons/first', '/cartons/first/contents/item']) {
    assert.equal((await serverDb.doc('packing_lists/' + scenario.id + path).get()).exists, false)
  }
  assert.equal(await read(quote(admin.db, id)), undefined)
})

test('simultaneous fresh quote and delete cannot both commit', async () => {
  const scenario = await packingFixture('packing-racing')
  const id = staff.model.newFreightQuoteId()
  const outcomes = await Promise.allSettled([
    staff.model.createOrderFreightQuote(id, fixtureQuote(scenario), { USD: 8 }, scenario),
    admin.model.deleteScenario(scenario),
  ])
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  const saved = await read(quote(admin.db, id))
  assert.equal(Boolean(await read(packingDoc(admin.db, scenario))), Boolean(saved))
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code,
    saved ? 'packing/freight-linked' : 'freight/scenario-changed')
})

test('legacy and multiple saved references block deletion until the final quote is removed', async () => {
  const order = 'packing-legacy-links'
  await seed(order)
  const scenario = { ...(await read(doc(admin.db, 'packing_lists', order + '-packing'))), id: order + '-packing' }
  const legacyQuote = await read(quote(admin.db, order + '-a'))
  assert.equal(freightPackingStatus(legacyQuote, scenario), 'unknown')
  assert.equal(freightPackingStatus(legacyQuote, null), 'unavailable')
  await assert.rejects(staff.model.deleteScenario(scenario), { code: 'packing/freight-linked' })
  await staff.model.deleteOrderFreightQuote(order, order + '-a')
  await assert.rejects(staff.model.deleteScenario(scenario), { code: 'packing/freight-linked' })
  await staff.model.deleteOrderFreightQuote(order, order + '-b')
  assert.deepEqual(await staff.model.deleteScenario(scenario), { deleted: true })
})

test('after a lost linked-create response, retrying preserves the same price, cargo and saved revision', async () => {
  const scenario = await packingFixture('packing-lost-ack')
  const id = staff.model.newFreightQuoteId()
  const data = fixtureQuote(scenario)
  globalThis.__freightLoseAck = true
  try { await assert.rejects(staff.model.createOrderFreightQuote(id, data, { USD: 8 }, scenario), /lost acknowledgement/) }
  finally { delete globalThis.__freightLoseAck }
  const prior = await read(quote(admin.db, id))
  await revisePacking(admin, scenario, 'after-lost-ack')
  const saved = await staff.model.createOrderFreightQuote(id, { ...data, quoted_total: 150 }, { USD: 9 }, scenario)
  assert.equal(saved.id, id)
  assert.equal(saved.quoted_total, 145.25)
  assert.equal(saved.quoted_total_hkd, 1162)
  assert.equal(saved.scenario_revision, scenario.packing_save_id)
  assert.deepEqual(saved.cargo_basis, prior.cargo_basis)
  assert.deepEqual(await read(quote(admin.db, id)), prior)
  assert.equal((await read(packingDoc(admin.db, scenario))).freight_link_revision, 1)
})

test('legacy snapshot stamps detect changed headers for both APIs', async () => {
  const order = 'packing-legacy-stamp'
  const scenario = await packingFixture(order, null)
  const ref = packingDoc(admin.db, scenario)
  await updateDoc(ref, { updatedAt: serverTimestamp() })
  const old = { ...(await read(ref)), id: scenario.id }
  const id = staff.model.newFreightQuoteId()
  const data = fixtureQuote(old)
  const saved = await staff.model.createOrderFreightQuote(id, data, { USD: 8 }, old)
  assert.ok(saved.scenario_legacy_stamp)
  assert.equal(freightPackingStatus(saved, old), 'current')
  await updateDoc(ref, { label: 'Revised legacy label', updatedAt: serverTimestamp() })
  assert.equal(freightPackingStatus(saved, await read(ref)), 'changed')
  await assert.rejects(staff.model.createOrderFreightQuote(staff.model.newFreightQuoteId(), data, { USD: 8 }, old),
    { code: 'freight/scenario-changed' })
  await assert.rejects(staff.model.deleteScenario(old), /changed elsewhere/)
})

test('Shipping roles and direct legacy writes cannot bypass the guarded operations or close an order race', async () => {
  const scenario = await packingFixture('packing-guarded-rules')
  const order = scenario.order_id
  const data = fixtureQuote(scenario)
  for (const [client, status] of [[customer, 403], [missingPermission, 403], [unauthenticated, 401]]) {
    await assert.rejects(client.model.deleteScenario(scenario), { status })
    await assert.rejects(client.model.createOrderFreightQuote('denied-quote', data, { USD: 8 }, scenario), { status })
    await assertFails(getDocFromServer(packingDoc(client.db, scenario)))
  }
  await assertFails(deleteDoc(packingDoc(staff.db, scenario)))
  await assertFails(updateDoc(packingDoc(staff.db, scenario), { freight_link_revision: 99 }))
  await assertFails(updateDoc(packingDoc(staff.db, scenario), { totals: { cbm: 99 } }))
  await assertFails(updateDoc(doc(packingDoc(staff.db, scenario), 'cartons', 'first'), { carton_count: 99 }))
  await assertFails(setDoc(quote(staff.db, 'old-tab-linked-create'), data))
  await setDoc(quote(staff.db, 'old-tab-unlinked-create'), { ...data, scenario_id: null })
  await assertFails(updateDoc(quote(staff.db, 'old-tab-unlinked-create'), { scenario_id: scenario.id }))
  await assertFails(updateDoc(quote(staff.db, 'old-tab-unlinked-create'), { scenario_legacy_stamp: [0, 0] }))
  await serverDb.doc('orders/' + order).update({ shipping_closed: true })
  await assert.rejects(staff.model.deleteScenario(scenario), /closed/)
  await assert.rejects(staff.model.createOrderFreightQuote('closed-quote', data, { USD: 8 }, scenario), /closed/)
})
