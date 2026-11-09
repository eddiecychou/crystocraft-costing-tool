// Real Admin transactions + Web SDK/current rules + real handler. Fictional
// loopback project only; never use production records or number counters.
import { test, before, beforeEach, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection
} from 'firebase/firestore'
import { createQuoteConversionRepository } from '../netlify/functions/lib/quoteConversionRepository.js'
import { createQuoteConversionHandler } from '../netlify/functions/lib/quoteConversionHandler.js'
import { normalizeConversionDraft } from '../netlify/functions/lib/quoteConversionModel.js'
import {orderEditBase,orderEditPatch} from '../src/orderEditModel.js'
import { quoteItemToOrderLine } from '../src/rangeQuote.js'
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
  throw Error(
    'Explicit loopback Firestore emulator required; live conversion writes forbidden'
  )
const projectId = 'demo-quote-conversion-recovery',
  app = initializeApp({ projectId }, 'quote-recovery-qa'),
  app2 = initializeApp({ projectId }, 'quote-recovery-qa-2')
const db = getFirestore(app),
  db2 = getFirestore(app2),
  stamp = () => FieldValue.serverTimestamp(),
  clock = () => new Date('2026-11-08T04:00:00Z')
const qid = 'fictional-quote',
  qid2 = 'fictional-quote-two',
  identity = { uid: 'admin' }
const profiles = {
  admin: { role: 'admin', status: 'approved' },
  both: { role: 'staff', status: 'approved', modules: ['quotes', 'shipping'] },
  quotes: { role: 'staff', modules: ['quotes'] },
  shipping: { role: 'staff', modules: ['shipping'] },
  none: { role: 'staff', modules: [] },
  customer: { role: 'customer', status: 'approved', customer_id: 'fictional-customer' }
}
const original = {
  quote_no: 'FICTIONAL-QUOTE',
  quote_type: 'built',
  customer_id: 'fictional-customer',
  client_name: 'Fictional 中文 Buyer',
  quote_currency: 'USD',
  notes: 'Preserve quote notes',
  attachments: [
    { name: '原始 & source.pdf', url: 'https://example.invalid/original.pdf' }
  ]
}
const item = {
  product_collection: 'range_products',
  product_id: 'fictional-range',
  product_variant_sku: 'SKU-ROS',
  product_name: 'Fictional Rosaline',
  product_unit: 'pcs',
  hero_image: 'https://example.invalid/rose.jpg',
  tiers: [
    { quantity: 1000, price: 1.222, remarks: 'Original tier note' },
    { quantity: 2000, price: 1.111 }
  ],
  internal_cost_hkd: 5
}
const order = {
  customer_id: 'fictional-customer',
  customer_name: 'Fictional 中文 Buyer',
  currency: 'USD',
  customer_po: 'Fictional PO A',
  notes: 'Reviewed order notes',
  source_file: { name: 'PI 原始.pdf', url: 'https://example.invalid/PI.pdf' },
  deposit_paid: 155,
  accounting_total: 1222
}
const draft = (patch = {}, linePatch = {}) => ({
  order: { ...order, ...patch },
  lines: [{ ...quoteItemToOrderLine(item, 0), ...linePatch }]
})
let env,
  repo,
  handler,
  faults,
  clients = []
const count = async (path) => (await db.collection(path).get()).size
const read = async (path) => (await db.doc(path).get()).data()
const request = async (action = 'status', extra = {}, uid = 'admin') => {
  const r = await handler(
    new Request('http://127.0.0.1/api/quote-order-conversion', {
      method: 'POST',
      headers: uid ? { Authorization: 'Bearer ' + uid } : {},
      body: JSON.stringify({ action, quote_id: qid, ...extra })
    })
  )
  return { status: r.status, body: await r.json() }
}
const current = () => repo.state(qid)
const input = async (extra = {}) => {
  const state = await current()
  return {
    kind: 'initial',
    reason: '',
    expected_revision: state.revision,
    expected_source: state.source_token,
    draft: draft(),
    ...extra
  }
}
const prepare = async (extra = {}) => {
  const result = await request('prepare', await input(extra))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body.active
}
const commit = async (op) => {
  const result = await request('commit', { operation_id: op.id })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body.result
}
const client = (uid) => {
  const d = env.authenticatedContext(uid).firestore()
  clients.push(d)
  return d
}
before(
  async () => {
    env = await initializeTestEnvironment({
      projectId,
      firestore: { rules: await readFile('firestore.rules', 'utf8') }
    })
  },
  { timeout: 20000 }
)
beforeEach(
  async () => {
    await env.clearFirestore()
    await Promise.all(
      Object.entries(profiles).map(([uid, p]) => db.doc('users/' + uid).set(p))
    )
    for (const id of [qid, qid2]) {
      await db.doc('client_quotes/' + id).set({ ...original, createdAt: stamp() })
      await db
        .doc('client_quotes/' + id + '/items/item')
        .set({ ...item, createdAt: stamp() })
    }
    await db.doc('counters/so_26').set({ last: 100, year: '26', kind: 'so' })
    repo = createQuoteConversionRepository(db, stamp, clock)
    faults = {}
    const service = {
      ...repo,
      async prepare(...args) {
        if (faults.beforePrepare) throw Error('FICTIONAL before prepare')
        const r = await repo.prepare(...args)
        if (faults.lostPrepare) {
          faults.lostPrepare = false
          throw Error('FICTIONAL prepare response lost')
        }
        return r
      },
      async commit(...args) {
        if (faults.beforeCommit) throw Error('FICTIONAL before commit')
        const r = await repo.commit(...args)
        if (faults.lostCommit) {
          faults.lostCommit = false
          throw Error('FICTIONAL commit response lost')
        }
        return r
      }
    }
    handler = createQuoteConversionHandler({
      verifyToken: async (token) => {
        if (!(token in profiles)) throw Error('Invalid token')
        return { uid: token }
      },
      getProfile: async (uid) => read('users/' + uid),
      repo: service
    })
  },
  { timeout: 20000 }
)
afterEach(
  async () => {
    await Promise.all(clients.splice(0).map((d) => d.terminate()))
  },
  { timeout: 10000 }
)
after(
  async () => {
    await env?.cleanup()
    await Promise.all([db.terminate(), db2.terminate()])
    await Promise.all([deleteApp(app), deleteApp(app2)])
  },
  { timeout: 20000 }
)

test(
  'normal atomic conversion preserves precise reviewed lines, financial fields, images and original quote attachments',
  { timeout: 20000 },
  async () => {
    const before = await read('client_quotes/' + qid),
      op = await prepare(),
      result = await commit(op),
      saved = await read('orders/' + result.order_id)
    assert.equal(result.so, 'SO260101')
    assert.equal(saved.client_quote_id, qid)
    assert.equal(saved.quote_conversion_id, op.id)
    assert.equal(saved.source, 'in_app_quote')
    assert.equal(saved.deposit_paid, 155)
    assert.equal(saved.total_amount, 1222)
    assert.deepEqual(saved.source_file, order.source_file)
    const lines = (
      await db.collection('orders/' + result.order_id + '/lines').get()
    ).docs.map((d) => d.data())
    assert.equal(lines.length, 1)
    assert.equal(lines[0].unit_price, 1.222)
    assert.equal(lines[0].qty_ordered, 1000)
    assert.equal(lines[0].line_image, item.hero_image)
    assert.equal(lines[0].tier_remarks, 'Original tier note')
    assert.deepEqual(lines[0].matched_product_ref, {
      collection: 'range_products',
      id: item.product_id,
      name: item.product_name
    })
    const after = await read('client_quotes/' + qid)
    assert.deepEqual(after.attachments, before.attachments)
    assert.equal(after.notes, before.notes)
    assert.equal(after.converted_order_id, result.order_id)
    assert.equal((await current()).history.length, 1)
    assert.equal((await current()).active, null)
  }
)
test(
  'same intent prepared concurrently across independent Admin clients has one stable operation/order',
  { timeout: 20000 },
  async () => {
    const second = createQuoteConversionRepository(db2, stamp, clock),
      body = await input()
    const results = await Promise.all([
      repo.prepare(qid, body, identity),
      second.prepare(qid, body, { uid: 'both' })
    ])
    assert.equal(results[0].operation_id, results[1].operation_id)
    assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 1)
    const receipts = await Promise.all([
      repo.commit(qid, results[0].operation_id),
      second.commit(qid, results[1].operation_id)
    ])
    assert.deepEqual(receipts[0], receipts[1])
    assert.equal(await count('orders'), 1)
    assert.equal((await read('counters/so_26')).last, 101)
  }
)
test(
  'different quotes contend safely on the existing SO counter and both remain legitimate',
  { timeout: 20000 },
  async () => {
    const state2 = await repo.state(qid2),
      body1 = await input(),
      body2 = { ...body1, expected_source: state2.source_token }
    const [a, b] = await Promise.all([
      repo.prepare(qid, body1, identity),
      repo.prepare(qid2, body2, identity)
    ])
    const results = await Promise.all([
      repo.commit(qid, a.operation_id),
      repo.commit(qid2, b.operation_id)
    ])
    assert.deepEqual(results.map((r) => r.so).sort(), ['SO260101', 'SO260102'])
    assert.equal(await count('orders'), 2)
  }
)
test(
  'lost prepare acknowledgment is recovered from source pointer without another request',
  { timeout: 20000 },
  async () => {
    const body = await input()
    faults.lostPrepare = true
    assert.equal((await request('prepare', body)).status, 503)
    const existing = (await current()).active
    assert.ok(existing)
    assert.equal(await count('orders'), 0)
    const repeated = await request('prepare', body)
    assert.equal(repeated.body.active.id, existing.id)
    await commit(existing)
    assert.equal(await count('orders'), 1)
    assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 1)
  }
)
test(
  'lost commit acknowledgment recovers exact order/SO after status, reload and repeated commit',
  { timeout: 20000 },
  async () => {
    const op = await prepare()
    faults.lostCommit = true
    assert.equal((await request('commit', { operation_id: op.id })).status, 503)
    const recovered = await current()
    assert.equal(recovered.active, null)
    assert.equal(recovered.latest.id, op.id)
    const first = recovered.latest.result
    assert.deepEqual(await commit(op), first)
    assert.equal(await count('orders'), 1)
    assert.equal((await read('counters/so_26')).last, 101)
    const oldInitial = await request('prepare', await input())
    assert.equal(oldInitial.status, 200)
    assert.equal(oldInitial.body.active, null)
    assert.equal(await count('orders'), 1)
  }
)
test(
  'failure before prepare creates no intent/order; failure before commit retains one prepared request',
  { timeout: 20000 },
  async () => {
    faults.beforePrepare = true
    assert.equal((await request('prepare', await input())).status, 503)
    assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 0)
    faults.beforePrepare = false
    const op = await prepare()
    faults.beforeCommit = true
    assert.equal((await request('commit', { operation_id: op.id })).status, 503)
    assert.equal((await current()).active.id, op.id)
    assert.equal(await count('orders'), 0)
    assert.equal((await read('counters/so_26')).last, 100)
    faults.beforeCommit = false
    await commit(op)
    assert.equal(await count('orders'), 1)
  }
)
test(
  'transaction failure after staging counter/order/line rolls back every write and retries same request',
  { timeout: 20000 },
  async () => {
    const op = await prepare()
    let fail = true
    const wrapped = new Proxy(db, {
      get(target, key) {
        if (key === 'runTransaction')
          return (callback) =>
            target.runTransaction((tx) =>
              callback(
                new Proxy(tx, {
                  get(t, k) {
                    if (k === 'create')
                      return (ref, ...rest) => {
                        if (fail && ref.path.includes('/lines/'))
                          throw Error('FICTIONAL staged-write failure')
                        return t.create(ref, ...rest)
                      }
                    const v = t[k]
                    return typeof v === 'function' ? v.bind(t) : v
                  }
                })
              )
            )
        const v = target[key]
        return typeof v === 'function' ? v.bind(target) : v
      }
    })
    const failing = createQuoteConversionRepository(wrapped, stamp, clock)
    await assert.rejects(failing.commit(qid, op.id), /staged-write failure/)
    assert.equal(await count('orders'), 0)
    assert.equal((await read('counters/so_26')).last, 100)
    assert.equal((await current()).active.id, op.id)
    assert.equal((await read('client_quotes/' + qid)).converted_order_id, undefined)
    fail = false
    await failing.commit(qid, op.id)
    assert.equal(await count('orders'), 1)
    assert.equal((await read('counters/so_26')).last, 101)
  }
)
test(
  'intentional additional partial orders preserve the first order and exact separate customer POs',
  { timeout: 20000 },
  async () => {
    const a = await prepare({
        draft: draft(
          { customer_po: 'Fictional split A', accounting_total: 611 },
          { qty_ordered: 500 }
        )
      }),
      first = await commit(a)
    const snapshot = await read('orders/' + first.order_id)
    const b = await prepare({
        kind: 'additional',
        reason: 'Reviewed second 500 pieces',
        draft: draft(
          { customer_po: 'Fictional split B', accounting_total: 611 },
          { qty_ordered: 500 }
        )
      }),
      second = await commit(b)
    assert.notEqual(first.order_id, second.order_id)
    assert.equal(await count('orders'), 2)
    assert.deepEqual(await read('orders/' + first.order_id), snapshot)
    assert.equal((await read('orders/' + second.order_id)).total_amount, 611)
    assert.equal(
      (await read('orders/' + second.order_id)).customer_po,
      'Fictional split B'
    )
    assert.equal(
      (await current()).history.filter((o) => o.status === 'committed').length,
      2
    )
    assert.equal((await read('client_quotes/' + qid)).converted_order_id, second.order_id)
  }
)
test(
  'stale additional confirmation cannot create another intent after the reviewed one completes',
  { timeout: 20000 },
  async () => {
    await commit(await prepare())
    const body = await input({ kind: 'additional', reason: 'Reviewed additional order' }),
      op = await prepare(body)
    await commit(op)
    assert.equal((await request('prepare', body)).status, 409)
    assert.equal(await count('orders'), 2)
  }
)
test(
  'different pending drafts or reasons cannot replace a frozen request',
  { timeout: 20000 },
  async () => {
    const body = await input(),
      op = await prepare(body)
    const changed = await request('prepare', {
      ...body,
      draft: draft({ customer_po: 'Unreviewed different PO' })
    })
    assert.equal(changed.status, 409)
    assert.equal((await current()).active.id, op.id)
    assert.equal((await current()).active.summary.customer_po, order.customer_po)
  }
)
for (const target of ['header', 'item', 'new-item'])
  test(
    'source ' + target + ' edit after preparation blocks commit without consuming SO',
    { timeout: 20000 },
    async () => {
      const op = await prepare()
      if (target === 'header')
        await db.doc('client_quotes/' + qid).update({ client_name: 'Changed name' })
      else
        await db
          .doc(
            'client_quotes/' + qid + '/items/' + (target === 'item' ? 'item' : 'new-item')
          )
          .set({ ...item, tiers: [{ quantity: 1000, price: 9 }] })
      const result = await request('commit', { operation_id: op.id })
      assert.equal(result.status, 409)
      assert.match(result.body.error, /changed/)
      assert.equal(await count('orders'), 0)
      assert.equal((await read('counters/so_26')).last, 100)
      assert.equal((await current()).active.id, op.id)
    }
  )
test(
  'explicit cancellation keeps history; a fresh reviewed draft can then create one order',
  { timeout: 20000 },
  async () => {
    const op = await prepare()
    await db
      .doc('client_quotes/' + qid + '/items/item')
      .update({ product_name: 'Revised source' })
    assert.equal(
      (await request('cancel', { operation_id: op.id, reason: 'Review revised source' }))
        .status,
      200
    )
    assert.equal((await current()).active, null)
    assert.equal((await current()).history[0].status, 'cancelled')
    assert.equal((await request('commit', { operation_id: op.id })).status, 409)
    const next = await prepare()
    assert.notEqual(op.id, next.id)
    await commit(next)
    assert.equal(await count('orders'), 1)
    assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 2)
  }
)
test(
  'missing quote, missing stable order and conflicting stable order require review, never guessing',
  { timeout: 20000 },
  async () => {
    const op = await prepare()
    await db.doc('orders/' + op.order_id).set({ customer_id: 'other' })
    assert.equal((await request('commit', { operation_id: op.id })).status, 409)
    assert.equal((await read('counters/so_26')).last, 100)
    await db.doc('orders/' + op.order_id).delete()
    const result = await commit(op)
    await db.doc('orders/' + result.order_id).delete()
    assert.equal((await request('commit', { operation_id: op.id })).status, 409)
    assert.equal((await current()).latest.missing, true)
    assert.equal((await read('counters/so_26')).last, 101)
    await db.doc('client_quotes/' + qid).delete()
    assert.equal((await request('commit', { operation_id: op.id })).status, 404)
  }
)
for (const variant of ['valid', 'missing', 'foreign'])
  test(
    'legacy ' +
      variant +
      ' link requires explicit reviewed separate-order intent and is retained',
    { timeout: 20000 },
    async () => {
      const legacy = 'fictional-legacy'
      await db.doc('client_quotes/' + qid).update({ converted_order_id: legacy })
      if (variant !== 'missing')
        await db
          .doc('orders/' + legacy)
          .set({
            customer_id: variant === 'foreign' ? 'other' : 'fictional-customer',
            customer_name: 'Legacy owner',
            notes: 'Preserve historical notes'
          })
      const before = variant === 'missing' ? null : await read('orders/' + legacy)
      const state = await current()
      assert.equal(state.legacy.verified, false)
      assert.equal(state.legacy.missing, variant === 'missing')
      assert.equal((await request('prepare', await input())).body.active, null)
      const body = await input({
        kind: 'additional',
        reason: 'Reviewed legacy association; separate new order'
      })
      assert.equal((await request('prepare', body)).status, 409)
      body.legacy_review = { order_id: legacy, review_token: state.legacy.review_token }
      const op = await prepare(body)
      await commit(op)
      assert.equal((await current()).legacy.order_id, legacy)
      assert.equal((await current()).legacy.verified, false)
      assert.equal((await read('client_quotes/' + qid)).legacy_converted_order_id, legacy)
      if (before) assert.deepEqual(await read('orders/' + legacy), before)
    }
  )
test(
  'changed legacy target after review blocks preparation and commit',
  { timeout: 20000 },
  async () => {
    await db
      .doc('orders/legacy')
      .set({ customer_id: 'fictional-customer', notes: 'Before' })
    await db.doc('client_quotes/' + qid).update({ converted_order_id: 'legacy' })
    const state = await current(),
      body = await input({
        kind: 'additional',
        reason: 'Reviewed legacy',
        legacy_review: { order_id: 'legacy', review_token: state.legacy.review_token }
      })
    const op = await prepare(body)
    await db.doc('orders/legacy').update({ notes: 'Changed by another editor' })
    assert.equal((await request('commit', { operation_id: op.id })).status, 409)
    assert.equal((await read('counters/so_26')).last, 100)
  }
)
test(
  'normal customer access still reads its saved order but private request/quote/counter writes are denied',
  { timeout: 20000 },
  async () => {
    const op = await prepare(),
      result = await commit(op),
      customer = client('customer'),
      admin = client('admin'),
      both = client('both'),
      quoteOnly = client('quotes')
    await assertSucceeds(getDoc(doc(customer, 'orders', result.order_id)))
    await assertSucceeds(
      getDocs(collection(customer, 'orders', result.order_id, 'lines'))
    )
    const raw = (await getDoc(doc(customer, 'orders', result.order_id))).data()
    assert.equal(raw.payload, undefined)
    assert.equal(raw.source_token, undefined)
    assert.equal(raw.created_by_uid, undefined)
    for (const d of [customer, quoteOnly])
      await assertFails(getDoc(doc(d, 'client_quotes', qid, 'order_conversions', op.id)))
    await assertSucceeds(
      getDoc(doc(both, 'client_quotes', qid, 'order_conversions', op.id))
    )
    for (const d of [customer, admin, both]) {
      await assertFails(
        setDoc(doc(d, 'client_quotes', qid, 'order_conversions', 'forged'), {
          status: 'committed'
        })
      )
      await assertFails(
        updateDoc(doc(d, 'client_quotes', qid), { converted_order_id: 'other' })
      )
      await assertFails(
        updateDoc(doc(d, 'orders', result.order_id), { client_quote_id: 'other' })
      )
      await assertFails(
        updateDoc(doc(d, 'orders', result.order_id), { quote_conversion_id: 'forged' })
      )
      await assertFails(deleteDoc(doc(d, 'client_quotes', qid)))
      await assertFails(deleteDoc(doc(d, 'orders', result.order_id)))
    }
    await assertFails(getDoc(doc(customer, 'client_quotes', qid)))
    await assertFails(updateDoc(doc(customer, 'counters', 'so_26'), { last: 1 }))
    await assertSucceeds(
      updateDoc(doc(admin, 'client_quotes', qid), { notes: 'Allowed quote edit' })
    )
    await assertSucceeds(
      updateDoc(doc(admin, 'client_quotes', qid, 'items', 'item'), {
        product_name: 'Allowed item edit'
      })
    )
    // An old unversioned client is refused; a fresh editor retains its access.
    await assertFails(updateDoc(doc(admin,'orders',result.order_id),{notes:'Unversioned order edit'}))
    await assertSucceeds(
      updateDoc(doc(admin, 'orders', result.order_id), {
        ...orderEditPatch(orderEditBase(raw),crypto.randomUUID()),
        notes: 'Allowed order edit'
      })
    )
  }
)
test(
  'rules deny forged conversion creation, source mutation, private orphan access and old backlink saves',
  { timeout: 20000 },
  async () => {
    const d = client('admin'),
      anonymous = env.unauthenticatedContext().firestore()
    clients.push(anonymous)
    await assertFails(
      setDoc(doc(d, 'orders', 'forged'), { source: 'in_app_quote', client_quote_id: qid })
    )
    await assertFails(
      setDoc(doc(d, 'orders', 'forged-blank'), { quote_conversion_id: 'operation' })
    )
    await assertFails(
      setDoc(doc(d, 'client_quotes', 'forged-copy'), {
        ...original,
        converted_order_id: 'old'
      })
    )
    await assertFails(
      updateDoc(doc(d, 'client_quotes', qid), {
        order_conversion_version: 'unbounded'.repeat(1000)
      })
    )
    await assertFails(
      getDocs(collection(anonymous, 'client_quotes', qid, 'order_conversions'))
    )
    await assertFails(
      getDoc(doc(d, 'client_quotes', 'orphan', 'order_conversions', 'private'))
    )
    // Documented limit: the old source-less manual Create is still legitimate.
    // It cannot mutate the new receipt/pointer fields, even on an untracked quote.
    await assertSucceeds(
      setDoc(doc(d, 'orders', 'old-manual'), {
        source: 'manual',
        client_quote_id: null,
        customer_id: 'fictional-customer'
      })
    )
    await assertFails(
      updateDoc(doc(d, 'client_quotes', qid), { converted_order_id: 'old-manual' })
    )
    const result = await commit(await prepare())
    await assertFails(updateDoc(doc(d, 'orders', result.order_id), { source: 'manual' }))
  }
)
for (const uid of ['customer', 'quotes', 'shipping', 'none'])
  test(
    'endpoint denies ' + uid + ' before private conversion work',
    { timeout: 20000 },
    async () => {
      for (const action of ['ready', 'status', 'prepare', 'commit', 'cancel'])
        assert.equal((await request(action, {}, uid)).status, 403)
      assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 0)
      assert.equal(await count('orders'), 0)
    }
  )
test(
  'current profile revocation blocks a previously authorized pending conversion',
  { timeout: 20000 },
  async () => {
    const op = await prepare()
    await db.doc('users/both').update({ modules: ['shipping'] })
    assert.equal((await request('commit', { operation_id: op.id }, 'both')).status, 403)
    assert.equal(await count('orders'), 0)
    await commit(op)
    assert.equal(await count('orders'), 1)
  }
)
test(
  'source/currency/customer checks, malformed/oversize requests and invalid Range lines change nothing',
  { timeout: 20000 },
  async () => {
    assert.equal(
      (await request('prepare', await input({ draft: draft({ customer_id: 'other' }) })))
        .status,
      409
    )
    assert.equal(
      (await request('prepare', await input({ draft: draft({ currency: 'UNKNOWN' }) })))
        .status,
      400
    )
    assert.equal(
      (
        await request(
          'prepare',
          await input({
            draft: { order, lines: Array(201).fill(quoteItemToOrderLine(item, 0)) }
          })
        )
      ).status,
      400
    )
    assert.equal(
      (
        await request(
          'prepare',
          await input({ draft: draft({ notes: 'x'.repeat(513000) }) })
        )
      ).status,
      400
    )
    await db
      .doc('client_quotes/' + qid + '/items/item')
      .update({ tiers: [{ quantity: 100, price: 0 }] })
    assert.equal((await request('prepare', await input())).status, 409)
    assert.equal(await count('orders'), 0)
    assert.equal(await count('client_quotes/' + qid + '/order_conversions'), 0)
  }
)
test(
  'provided fictional SO remains exact without counter allocation; no SI/UC/stock follow-up occurs',
  { timeout: 20000 },
  async () => {
    const op = await prepare({ draft: draft({ erp_so_no: 'QA ONLY — FICTIONAL SO' }) }),
      result = await commit(op)
    assert.equal(result.so, 'QA ONLY — FICTIONAL SO')
    assert.equal((await read('counters/so_26')).last, 100)
    const saved = await read('orders/' + result.order_id)
    assert.equal(saved.erp_si_no, '')
    assert.equal(saved.uc_no, '')
    assert.equal(saved.invoice_allocation_id, undefined)
    assert.equal(await count('orders/' + result.order_id + '/invoice_allocations'), 0)
  }
)
test(
  'history pagination retains all receipts and latest order even with newer cancelled requests',
  { timeout: 20000 },
  async () => {
    const op = await prepare(),
      result = await commit(op),
      committed = await read('client_quotes/' + qid + '/order_conversions/' + op.id)
    const batch = db.batch()
    for (let i = 0; i < 23; i++)
      batch.set(
        db.doc(
          'client_quotes/' +
            qid +
            '/order_conversions/history-' +
            String(i).padStart(2, '0')
        ),
        {
          ...committed,
          id: 'history-' + String(i).padStart(2, '0'),
          status: 'cancelled',
          created_at: new Date('2026-11-09T00:00:' + String(i).padStart(2, '0') + 'Z')
        }
      )
    await batch.commit()
    const a = await current(),
      b = await repo.state(qid, a.next_cursor)
    assert.equal(a.history.length, 20)
    assert.equal(a.more_history, true)
    assert.equal(b.history.length, 4)
    assert.equal(b.more_history, false)
    assert.equal(new Set([...a.history, ...b.history].map((x) => x.id)).size, 24)
    assert.equal(a.latest.result.order_id, result.order_id)
  }
)
