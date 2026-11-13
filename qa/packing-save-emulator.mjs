// Exercise the production persistence functions with the Web SDK and real rules.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, collection, getDocsFromServer, getDocFromServer, setDoc, writeBatch } from 'firebase/firestore'

const emulator = process.env.FIRESTORE_EMULATOR_HOST || ''
assert.match(emulator, /^(127\.0\.0\.1|localhost):\d+$/, 'Loopback emulator required')
const [host, port] = emulator.split(':')
const projectId = 'demo-sh07-manual'
const orderId = 'packing-qa-order'
const patch = { status: 'final', shipped_per: 'QA vessel', case_mark: 'QA mark',
  pallets: [{ pallet_no: 1, length_m: 1, width_m: 1, height_m: 1 }], totals: { carton_count: 2, cbm: 1, chargeable_weight_kg: 28 } }
const carton = (id, itemId) => ({
  _localId: id, carton_seq: 1, carton_count: 2, pallet_no: 1, pack_mode: 'single',
  length_cm: 40, width_cm: 30, height_cm: 20, gw_kg_actual: 10, is_estimate: false,
  contents: [{ _localId: itemId, item_code: 'QA-01', qty: 6, unit: 'pair', tier_remarks: 'Preserve this tier' }],
})
let env, scratch, admin, staff, customer, adminDb
let generation = 0

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', 'pack-admin'), { role: 'admin' })
    batch.set(doc(db, 'users', 'pack-staff'), { role: 'staff', modules: ['shipping'] })
    batch.set(doc(db, 'users', 'pack-customer'), { role: 'customer', status: 'approved' })
    await batch.commit()
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/packing-emulator-'))
  await build({
    entryPoints: ['src/packing.js'], outfile: join(scratch, 'packing.mjs'),
    bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'packing-emulator', setup(plugin) {
      plugin.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'packing-sdk'
        ? { path: args.path, external: true } : { path: 'sdk', namespace: 'packing-sdk' })
      plugin.onResolve({ filter: /^react$/ }, args => ({ path: args.path, external: true }))
      plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'packing-db' }))
      plugin.onLoad({ filter: /.*/, namespace: 'packing-db' }, () => ({
        contents: 'export const db = globalThis.__packingTestDb;', loader: 'js',
      }))
      plugin.onLoad({ filter: /.*/, namespace: 'packing-sdk' }, () => ({
        contents: `
          export * from 'firebase/firestore';
          import { runTransaction as execute, getDocsFromServer as read, doc as ref } from 'firebase/firestore';
          export async function runTransaction(db, task) {
            const result = await execute(db, async tx => {
              const value = await task(tx);
              if (globalThis.__packingBeforeCommit) tx.set(ref(db, 'invoice_followup_jobs/fictional-forbidden'), {});
              return value;
            });
            if (globalThis.__packingAfterCommit) throw Error('Fictional lost acknowledgement');
            return result;
          }
          export async function getDocsFromServer(ref) {
            const snapshot = await read(ref);
            await globalThis.__packingAfterRead?.();
            return snapshot;
          }
        `, loader: 'js',
      }))
    } }],
  })
  async function engine(user) {
    const db = env.authenticatedContext(user).firestore()
    globalThis.__packingTestDb = db
    return { db, engine: await import(pathToFileURL(join(scratch, 'packing.mjs')).href + '?' + ++generation) }
  }
  const a = await engine('pack-admin')
  admin = a.engine
  adminDb = a.db
  staff = (await engine('pack-staff')).engine
  customer = (await engine('pack-customer')).engine
}, { timeout: 20000 })

after(async () => {
  await env?.cleanup()
  if (scratch) await rm(scratch, { recursive: true, force: true })
  delete globalThis.__packingTestDb
})

async function legacy(id) {
  const scenario = { id, order_id: orderId, status: 'estimate', selected: true, label: 'Fictional plan', retain: 'legacy value' }
  const ref = doc(adminDb, 'packing_lists', id)
  const batch = writeBatch(adminDb)
  batch.set(ref, scenario)
  batch.set(doc(ref, 'cartons', 'old'), { carton_seq: 1, carton_count: 1, notes: 'Prior carton' })
  batch.set(doc(ref, 'cartons', 'old', 'contents', 'old-item'), { description: 'Prior content' })
  await batch.commit()
  return admin.loadPackingScenario(id, orderId)
}
function options(loaded, attemptId, changes = {}) {
  return { scenario: loaded.scenario, previous: loaded.cartons, cartons: [carton('next', 'next-item')],
    patch, orderLines: [], attemptId, isNew: false, ...changes }
}
const countScenarios = async () => (await getDocsFromServer(collection(adminDb, 'packing_lists'))).size

test('atomic replacement and Final preserve legacy fields, remove old children and retain stable IDs', async () => {
  const loaded = await legacy('pack-atomic')
  const first = await admin.savePackingScenario(options(loaded, 'atomic-1'))
  const saved = await admin.loadPackingScenario('pack-atomic', orderId)
  assert.equal(saved.scenario.retain, 'legacy value')
  assert.deepEqual(saved.scenario.totals, patch.totals)
  assert.equal(saved.scenario.shipped_per, patch.shipped_per)
  assert.deepEqual(saved.scenario.pallets, patch.pallets)
  assert.equal(saved.scenario.status, 'final')
  assert.equal(saved.scenario.selected, true)
  assert.equal(saved.cartons.length, 1)
  assert.equal(saved.cartons[0].id, first.cartons[0].id)
  assert.equal(saved.cartons[0].contents[0].tier_remarks, 'Preserve this tier')
  assert.equal(saved.cartons[0].contents[0].unit, 'pair')
  assert.equal((await getDocFromServer(doc(adminDb, 'packing_lists/pack-atomic/cartons/old/contents/old-item'))).exists(), false)
  const second = await admin.savePackingScenario(options(saved, 'atomic-2', { cartons: saved.cartons }))
  assert.equal(second.cartons[0].id, first.cartons[0].id)
  assert.equal(second.cartons[0].contents[0].id, first.cartons[0].contents[0].id)
})

test('failed write leaves old Final inputs intact and a retry commits once', async () => {
  const loaded = await legacy('pack-reject')
  const attempt = options(loaded, 'reject-1')
  globalThis.__packingBeforeCommit = true
  try { await assertFails(admin.savePackingScenario(attempt)) }
  finally { delete globalThis.__packingBeforeCommit }
  assert.deepEqual(await admin.loadPackingScenario('pack-reject', orderId), loaded)
  await admin.savePackingScenario(attempt)
  assert.equal((await admin.loadPackingScenario('pack-reject', orderId)).scenario.status, 'final')
})

test('an acknowledged server commit with a lost response is adopted by the same retry', async () => {
  const loaded = await legacy('pack-lost-ack')
  const attempt = options(loaded, 'lost-1')
  globalThis.__packingAfterCommit = true
  try { await assert.rejects(admin.savePackingScenario(attempt), /lost acknowledgement/) }
  finally { delete globalThis.__packingAfterCommit }
  const saved = await admin.loadPackingScenario('pack-lost-ack', orderId)
  const retry = await admin.savePackingScenario(attempt)
  assert.equal(retry.scenario.packing_save_id, 'lost-1')
  assert.deepEqual(await admin.loadPackingScenario('pack-lost-ack', orderId), saved)
})

test('parallel saves using the same baseline commit only one complete plan', async () => {
  const a = await legacy('pack-competition')
  const b = await staff.loadPackingScenario('pack-competition', orderId)
  const outcomes = await Promise.allSettled([
    admin.savePackingScenario(options(a, 'comp-a')),
    staff.savePackingScenario(options(b, 'comp-b', { cartons: [carton('staff-carton', 'staff-item')] })),
  ])
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /changed elsewhere/)
  const saved = await admin.loadPackingScenario('pack-competition', orderId)
  assert.deepEqual(saved.cartons.map(c => c.id), [saved.scenario.packing_save_id === 'comp-a' ? 'next' : 'staff-carton'])
  assert.equal(saved.cartons[0].contents.length, 1)
})

test('read retries when a write lands between the scenario header and child reads', async () => {
  const loaded = await legacy('pack-coherent')
  globalThis.__packingAfterRead = async () => {
    delete globalThis.__packingAfterRead
    await staff.savePackingScenario(options(loaded, 'coherent-save'))
  }
  const saved = await admin.loadPackingScenario('pack-coherent', orderId)
  assert.equal(saved.scenario.packing_save_id, 'coherent-save')
  assert.equal(saved.cartons[0].id, 'next')
  assert.equal(saved.cartons[0].contents[0].id, 'next-item')
})

test('new scenario and its contents first appear together and are reused on retry', async () => {
  const scenario = admin.newPackingScenario(orderId, 'Fictional new')
  const before = await countScenarios()
  assert.equal((await getDocFromServer(doc(adminDb, 'packing_lists', scenario.id))).exists(), false)
  const attempt = options({ scenario, cartons: [] }, 'new-1', { isNew: true })
  await admin.savePackingScenario(attempt)
  await admin.savePackingScenario(attempt)
  assert.equal(await countScenarios(), before + 1)
  const saved = await admin.loadPackingScenario(scenario.id, orderId)
  assert.equal(saved.scenario.status, 'final')
  assert.equal(saved.cartons[0].contents.length, 1)
})

test('oversized or customer writes leave the prior plan unchanged', async () => {
  const loaded = await legacy('pack-restricted')
  const attempt = options(loaded, 'restricted-1')
  await assert.rejects(admin.savePackingScenario({ ...attempt,
    cartons: Array.from({ length: 250 }, (_, i) => carton('c'+i, 'i'+i)),
  }), /too large/)
  await assertFails(customer.loadPackingScenario('pack-restricted', orderId))
  await assertFails(customer.savePackingScenario(attempt))
  assert.deepEqual(await admin.loadPackingScenario('pack-restricted', orderId), loaded)
})
