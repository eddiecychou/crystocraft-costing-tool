import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, collection, deleteDoc, setDoc, updateDoc, getDocFromServer, getDocsFromServer, writeBatch } from 'firebase/firestore'
import { orderRequestHandler } from '../netlify/functions/shipping-order-request.js'
import { deleteShippingDraft, shippingDraftHasFinancialHistory } from '../netlify/functions/lib/deleteShippingDraft.js'
import { orderEditBase } from '../src/orderEditModel.js'

const projectId = 'demo-shipping-delete'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'Loopback only')
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
let app, admin, env, shipping, inventory, engine, tmp, handler
const financial = new Map()
const root = id => admin.doc(`orders/${id}`)
const order = async (id, patch = {}) => {
  const saved = { status: 'draft', source: 'manual', customer_id: 'qa-customer', ...patch }
  const batch = admin.batch()
  batch.set(root(id), saved)
  batch.set(root(id).collection('lines').doc('line'), { line_no: 1, qty_ordered: 8, unit_price: 1.222 })
  await batch.commit()
  return orderEditBase(saved)
}
const request = (id, base, token = 'ship') => handler(new Request('http://localhost/api/shipping-order-request', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: 'delete_unused_draft', order_id: id, base }),
}))
const intact = async id => {
  assert.equal((await root(id).get()).exists, true)
  assert.equal((await root(id).collection('lines').doc('line').get()).get('unit_price'), 1.222)
}

before(async () => {
  app = initializeApp({ projectId }, projectId)
  admin = getFirestore(app)
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules','utf8') } })
  await env.clearFirestore()
  await Promise.all(Object.entries({
    ship: { role: 'staff', modules: ['shipping'] },
    inventory: { role: 'staff', modules: ['shipping', 'supply'] },
    supply: { role: 'staff', modules: ['supply'] },
    customer: { role: 'customer', status: 'approved', customer_id: 'qa-customer' },
  }).map(([uid, data]) => admin.doc(`users/${uid}`).set(data)))
  shipping = env.authenticatedContext('ship').firestore()
  inventory = env.authenticatedContext('inventory').firestore()
  globalThis.__shippingDeleteDb = inventory
  await mkdir('qa/out', { recursive: true })
  tmp = await mkdtemp(resolve('qa/out/shipping-delete-'))
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    export * from './src/orderStock.js';
    export { crystalInventory } from './src/crystals.js';
    export { packagingInventory } from './src/packaging.js';
  ` }, outfile: `${tmp}/stock.mjs`, bundle: true, format: 'esm', platform: 'node', external: ['react', 'firebase/*'],
  plugins: [{ name: 'local-emulator', setup(plugin) {
    plugin.onResolve({ filter: /\/firebase$/ }, args => args.path.startsWith('.') ? { path: 'db', namespace: 'fixture' } : null)
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const db = globalThis.__shippingDeleteDb;', loader: 'js' }))
  } }] })
  engine = await import(pathToFileURL(`${tmp}/stock.mjs`))
  handler = orderRequestHandler({
    verifyToken: async token => ({ uid: token }),
    getProfile: async uid => (await admin.doc(`users/${uid}`).get()).data(),
    deleteDraft: (uid, id, base) => deleteShippingDraft(admin, uid, id, base, async orderId => {
      const value = financial.get(orderId)
      if (value instanceof Error) throw value
      return value === true
    }),
  })
})

after(async () => {
  await env?.cleanup()
  await admin?.terminate()
  if (app) await deleteApp(app)
  if (tmp) await rm(tmp, { recursive: true, force: true })
  delete globalThis.__shippingDeleteDb
})

test('only Shipping can delete an unused draft with its lines, using a safe replay', async () => {
  const id = 'plain-draft', base = await order(id)
  for (const actor of ['supply', 'customer']) assert.equal((await request(id, base, actor)).status, 403)
  await assertFails(deleteDoc(doc(shipping, 'orders', id)))
  await intact(id)
  assert.deepEqual(await (await request(id, base)).json(), { deleted: true })
  assert.deepEqual(await (await request(id, base)).json(), { deleted: false })
  assert.equal((await root(id).get()).exists, false)
  assert.equal((await root(id).collection('lines').get()).empty, true)
})

test('current revision and order identity are checked before deleting', async () => {
  const id = 'stale-draft', base = await order(id)
  await root(id).update({ edit_revision: 1, last_edit_id: 'other-tab' })
  const response = await request(id, base)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'order-delete-changed')
  await intact(id)
})

test('production, external sources and issued references stay intact', async () => {
  for (const [key, value] of Object.entries({
    status: 'confirmed', source: 'imported_pi', quote_conversion_id: 'qa-quote', erp_so_no: 'QA-SO',
    erp_si_no: 'QA-SI', uc_no: 'QA-UC', invoice_allocation_id: 'qa-operation', deposit_paid: 8,
    source_file: { name: 'Fictional PI.pdf' }, components_issued: true,
  })) {
    const id = `saved-${key}`, response = await request(id, await order(id, { [key]: value }))
    assert.equal(response.status, 409, key)
    assert.equal((await response.json()).code, 'order-delete-blocked')
    await intact(id)
  }
})

test('linked records block deletion even when the draft header lacks references', async () => {
  const entries = [
    ['packing_lists/qa-linked-packing', 'packing'], ['freight_quotes/qa-linked-freight', 'freight'],
    ['freight_decisions/decision', 'decision'], ['freight_rfqs/qa-rfq', 'rfq'],
    ['orders/invoice/invoice_allocations/qa-linked', 'invoice'], ['invoice_followup_jobs/qa-followup', 'followup'],
    ['uc_invoices/qa-registry', 'registry'], ['credit_notes/qa-credit', 'credit'],
    ['crystals/qa-legacy/movements/qa-old-reserve', 'legacy-stock'],
  ]
  for (const [path, id] of entries) {
    const base = await order(id)
    await admin.doc(path).set({ order_id: id, fictional: true })
    const response = await request(id, base)
    assert.equal(response.status, 409, id)
    assert.equal((await response.json()).code, 'order-delete-blocked')
    assert.equal((await admin.doc(path).get()).get('fictional'), true)
    await intact(id)
  }
})

test('checks both financial tables by order ID and fails closed if readback fails', async () => {
  const id = 'financial-draft', base = await order(id)
  financial.set(id, true)
  assert.equal((await request(id, base)).status, 409)
  financial.set(id, Error('fictional unavailable'))
  assert.equal((await request(id, base)).status, 503)
  await intact(id)
  const calls = []
  const fake = async url => {
    calls.push(url.pathname)
    assert.equal(url.searchParams.get('order_id'), `eq.${id}`)
    return Response.json(url.pathname.endsWith('app_sales_invoice') ? [{ id: 1 }] : [])
  }
  assert.equal(await shippingDraftHasFinancialHistory(id, { url: 'https://fictional.supabase.co', key: 'fictional', fetchImpl: fake }), true)
  assert.deepEqual(calls.sort(), ['/rest/v1/app_credit_note', '/rest/v1/app_sales_invoice'])
})

test('reserved, consumed, and subsequently released stock retain their order and exact ledger balances', async () => {
  const classes = [engine.metalOrderConfig, engine.crystalInventory, engine.packagingInventory]
  for (const stage of ['reserved', 'consumed', 'released']) {
    const id = `stock-${stage}`, base = await order(id)
    for (const cfg of classes) {
      await admin.doc(`${cfg.collectionPath}/${id}`).set({ code: id, stock_qty: 100, reserved_qty: 0, ledger_seeded: true })
      await engine.reserveForOrder(cfg, id, id, [{ [cfg.order.lineIdField]: id, qty: 7, code: id }])
      if (stage === 'consumed') await engine.produceForOrder(cfg, id, id)
      if (stage === 'released') await engine.releaseForOrder(cfg, id, id)
    }
    assert.equal((await request(id, base)).status, 409)
    await intact(id)
    for (const cfg of classes) {
      const ref = doc(inventory, cfg.collectionPath, id)
      const current = (await getDocFromServer(ref)).data()
      assert.deepEqual([current.stock_qty, current.reserved_qty], stage === 'reserved' ? [100, 7] : stage === 'consumed' ? [93, 0] : [100, 0])
      assert.equal((await getDocsFromServer(collection(ref, 'movements'))).size, stage === 'reserved' ? 1 : 2)
    }
  }
})

test('deletion wins first and a stale stock action or old client writes no movement or balance', async () => {
  const id = 'delete-wins', base = await order(id)
  const ref = doc(inventory, 'crystals', id)
  await setDoc(ref, { code: id, stock_qty: 100, reserved_qty: 0 })
  assert.equal((await request(id, base)).status, 200)
  await assert.rejects(engine.reserveForOrder(engine.crystalInventory, id, id, [{ crystal_id: id, qty: 7 }]), /Order no longer exists/)
  const oldClient = writeBatch(inventory)
  oldClient.update(ref, { reserved_qty: 7 })
  oldClient.set(doc(ref, 'movements', 'old-client'), { type: 'reserve', order_id: id, reserved_qty: 7 })
  await assertFails(oldClient.commit())
  assert.equal((await getDocFromServer(ref)).get('reserved_qty'), 0)
  assert.equal((await getDocsFromServer(collection(ref, 'movements'))).empty, true)
  await assertFails(setDoc(doc(shipping, 'packing_lists/stale-packing'), { order_id: id }))
  await assertFails(setDoc(doc(shipping, 'freight_quotes/stale-freight'), { order_id: id }))
})

test('an interrupted reservation still retains the order for review', async () => {
  const id = 'interrupted-reserve', base = await order(id)
  await assert.rejects(engine.reserveForOrder(engine.crystalInventory, id, id, [{ crystal_id: 'missing-stock', qty: 7 }]), /Item not found/)
  assert.equal((await root(id).get()).get('stock_activity'), true)
  await assertFails(updateDoc(doc(inventory, 'orders', id), { stock_activity: false }))
  assert.equal((await request(id, base)).status, 409)
  await intact(id)
})

test('concurrent reserve and delete settle with one winner and a consistent stock balance', async () => {
  const id = 'two-tabs', base = await order(id)
  const ref = doc(inventory, 'crystals', id)
  await setDoc(ref, { code: id, stock_qty: 100, reserved_qty: 0, ledger_seeded: true })
  const [deletion, reserve] = await Promise.all([
    request(id, base),
    engine.reserveForOrder(engine.crystalInventory, id, id, [{ crystal_id: id, qty: 5 }]).then(() => true, error => {
      assert.match(error.message, /Order no longer exists/)
      return false
    }),
  ])
  assert.equal(deletion.status, reserve ? 409 : 200)
  assert.equal((await root(id).get()).exists, reserve)
  assert.equal((await getDocFromServer(ref)).get('reserved_qty'), reserve ? 5 : 0)
  assert.equal((await getDocsFromServer(collection(ref, 'movements'))).size, reserve ? 1 : 0)
})

test('new Packing and Freight links cannot race deletion and survive without their order', async () => {
  for (const path of ['packing_lists', 'freight_quotes']) {
    const id = `race-${path}`, base = await order(id)
    const link = doc(shipping, path, id)
    const [deletion, linked] = await Promise.all([
      request(id, base),
      setDoc(link, { order_id: id }).then(() => true, error => {
        assert.equal(error.code, 'permission-denied')
        return false
      }),
    ])
    assert.equal(deletion.status, linked ? 409 : 200)
    assert.equal((await root(id).get()).exists, linked)
    assert.equal((await getDocFromServer(link)).exists(), linked)
  }
})
