// All writes use fictional local emulator projects.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { getDoc, doc, setDoc } from 'firebase/firestore'
import { uploadBytes, ref, deleteObject, getMetadata } from 'firebase/storage'
import { createOrderRequests } from '../netlify/functions/lib/orderCreateRequests.js'
import {
  verifyPiOriginal,
  orderRequestHandler
} from '../netlify/functions/shipping-order-request.js'
import { piObjectPath } from '../src/orderCreateRequestModel.js'
import { soYear } from '../src/soNumberModel.js'
import { normOrder, normLine } from '../src/shippingModel.js'
import { PI_MAX_FILE_BYTES } from '../src/piUploadPolicy.js'

const projectId = process.env.GCLOUD_PROJECT
assert.equal(projectId, 'demo-sh07-manual')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
assert.match(
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '',
  /^127\.0\.0\.1:\d+$/
)
const app = initializeApp({
  projectId,
  storageBucket: projectId + '.appspot.com'
})
const db = getFirestore(app),
  bucket = getStorage(app).bucket()
const repo = createOrderRequests(db, (...args) =>
  verifyPiOriginal(bucket, ...args)
)
const handler = orderRequestHandler({
  verifyToken: async (token) => ({ uid: token }),
  getProfile: async (uid) => (await db.doc('users/' + uid).get()).data(),
  repo
})
let env
const orders = () => db.collection('orders').get()
const counter = db.doc('counters/so_' + soYear())
const draft = {
  order: {
    customer_id: 'fictional',
    customer_name: 'Fictional buyer',
    currency: 'USD',
    discount_amount: 0,
    deposit_paid: 100
  },
  lines: [
    {
      item_code: 'QA',
      description: 'Fictional pieces',
      qty_ordered: 1000,
      unit_price: 1.222,
      unit: 'pcs'
    }
  ]
}
const call = async (uid, id, action, extra = {}) => {
  const res = await handler(
    new Request('http://localhost/api/shipping-order-request', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + uid },
      body: JSON.stringify({ operator: uid, id, action, ...extra })
    })
  )
  return { code: res.status, body: await res.json() }
}
const prep = (id, extra = {}) =>
  call('staff', id, 'prepare', { ...draft, ...extra })
const storage = (uid) =>
  env.authenticatedContext(uid).storage('gs://' + bucket.name)
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') }
  })
})
beforeEach(async () => {
  await env.clearFirestore()
  await Promise.all(
    Object.entries({
      staff: ['shipping', 'quotes'],
      limited: ['shipping'],
      other: ['shipping', 'quotes'],
      customer: []
    }).map(([id, modules]) =>
      db
        .doc('users/' + id)
        .set({
          role: id === 'customer' ? 'customer' : 'staff',
          status: 'approved',
          modules,
          customer_id: 'fictional'
        })
    )
  )
  await counter.set({ last: 100 })
})
after(async () => {
  await env?.cleanup()
  await db.terminate()
  await deleteApp(app)
})
test('PI size boundary: API and direct Storage deny oversized uploads; exact limit and existing downloads work', async () => {
  const id = randomUUID()
  const bytes = Buffer.alloc(PI_MAX_FILE_BYTES, 32)
  Buffer.from('%PDF-1.4 fictional boundary fixture').copy(bytes)
  const file = { name: 'Fictional boundary.pdf', type: 'application/pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  const rejectedId = randomUUID()
  const rejected = await prep(rejectedId, { file: { ...file, size: PI_MAX_FILE_BYTES + 1 } })
  assert.equal(rejected.code, 413)
  assert.equal((await db.doc('shipping_create_operators/staff/requests/' + rejectedId).get()).exists, false)
  assert.equal((await prep(id, { file })).code, 200)
  await uploadBytes(ref(storage('staff'), piObjectPath('staff', id, file.sha256)), bytes, { contentType: file.type })
  const committed = await call('staff', id, 'commit')
  assert.equal(committed.code, 200, JSON.stringify(committed))
  const savedOrder = (await db.doc('orders/' + committed.body.order_id).get()).data()
  const downloaded = await fetch(savedOrder.source_file.url)
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes)
  // Seed a legacy oversized descriptor to prove rules enforce their own ceiling.
  assert.equal((await prep(rejectedId, { file })).code, 200)
  await db.doc('shipping_create_operators/staff/requests/' + rejectedId).update({ file: { ...file, size: PI_MAX_FILE_BYTES + 1 } })
  const oversizedPath = piObjectPath('staff', rejectedId, file.sha256)
  await assert.rejects(uploadBytes(ref(storage('staff'), oversizedPath), Buffer.alloc(PI_MAX_FILE_BYTES + 1), { contentType: file.type }), { code: 'storage/unauthorized' })
  // A pre-existing original remains readable; the new rule restricts creates only.
  await bucket.file(oversizedPath).save(Buffer.alloc(PI_MAX_FILE_BYTES + 1), { contentType: file.type })
  assert.equal((await getMetadata(ref(storage('staff'), oversizedPath))).size, PI_MAX_FILE_BYTES + 1)
  assert.equal((await call('staff', rejectedId, 'commit')).code, 413)
  assert.equal((await orders()).size, 1)
})
test('concurrent prepare and commit, then Replay after discarded confirmation, keep one order, one set of lines and one SO', async () => {
  const id = randomUUID()
  const prepared = await Promise.all([prep(id), prep(id)])
  assert.ok(
    prepared.every((x) => x.code === 200),
    JSON.stringify(prepared)
  )
  const results = await Promise.all([
    call('staff', id, 'commit'),
    call('staff', id, 'commit')
  ])
  assert.ok(
    results.every((x) => x.code === 200),
    JSON.stringify(results)
  )
  const replay = await call('staff', id, 'commit')
  assert.equal(replay.code, 200, JSON.stringify(replay))
  assert.equal(
    new Set([...results, replay].map((x) => x.body.order_id)).size,
    1
  )
  assert.equal((await orders()).size, 1)
  assert.equal((await counter.get()).data().last, 101)
  const o = (await orders()).docs[0]
  assert.equal(o.data().deposit_paid, 100)
  assert.equal(o.data().total_amount, 1222)
  const lines = await o.ref.collection('lines').get()
  assert.equal(lines.size, 1)
  assert.equal(lines.docs[0].data().unit_price, 1.222)
  const conflict = await prep(id, {
    order: { ...draft.order, notes: 'other tab edit' }
  })
  assert.equal(conflict.code, 409)
  const repeat = randomUUID()
  await prep(repeat)
  assert.equal((await call('staff', repeat, 'commit')).code, 200)
  assert.equal((await orders()).size, 2)
})
test('validate before prepare, preserve explicit SO and recheck current permissions before allocation', async () => {
  const id = randomUUID()
  assert.equal(
    (await prep(id, { order: { ...draft.order, deposit_paid: 5000 } })).code,
    400
  )
  assert.equal((await call('staff', id, 'status')).body.status, 'empty')
  assert.equal((await call('limited', id, 'prepare', draft)).code, 403)
  assert.equal(
    (
      await call('limited', id, 'prepare', {
        ...draft,
        order: { ...draft.order, erp_so_no: 'SO-FICTIONAL' }
      })
    ).code,
    200
  )
  assert.equal((await call('limited', id, 'commit')).body.so, 'SO-FICTIONAL')
  await prep(id)
  await db.doc('users/staff').update({ modules: ['shipping'] })
  assert.equal((await call('staff', id, 'commit')).code, 403)
  assert.equal((await counter.get()).data().last, 100)
})
test('customer and other operator cannot inspect the receipt or stage originals; own saved order remains readable', async () => {
  const id = randomUUID()
  await prep(id)
  assert.equal((await call('customer', id, 'list')).code, 403)
  assert.equal(
    (await call('other', id, 'status', { operator: 'staff' })).code,
    403
  )
  const pointer = 'shipping_create_operators/staff/requests/' + id
  for (const uid of ['staff', 'other', 'customer']) {
    const client = env.authenticatedContext(uid).firestore()
    try {
      await assert.rejects(
        getDoc(doc(client, pointer)),
        (e) => e.code === 'permission-denied'
      )
      await assert.rejects(
        setDoc(doc(client, pointer), { status: 'committed' }),
        (e) => e.code === 'permission-denied'
      )
    } finally {
      await client.terminate()
    }
  }
  assert.equal((await call('staff', id, 'list')).body.requests[0].id, id)
  assert.equal((await call('other', id, 'list')).body.requests.length, 0)
  const created = await call('staff', id, 'commit')
  const client = env.authenticatedContext('customer').firestore()
  try {
    assert.ok(
      (await getDoc(doc(client, 'orders', created.body.order_id))).exists()
    )
  } finally {
    await client.terminate()
  }
})
test('original upload survives lost response, reload and concurrent resume; only one immutable file is linked', async () => {
  const id = randomUUID()
  const bytes = Buffer.from('%PDF-1.7 · Fictional PI 甲')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const file = {
    name: 'PI 甲 & 乙.pdf',
    sha256,
    size: bytes.length,
    type: 'application/pdf'
  }
  assert.equal((await prep(id, { file })).code, 200)
  assert.equal((await call('staff', id, 'commit')).body.needs_file, true)
  const path = piObjectPath('staff', id, sha256),
    r = ref(storage('staff'), path)
  await assert.rejects(
    uploadBytes(ref(storage('other'), path), bytes, { contentType: file.type })
  )
  await assert.rejects(
    uploadBytes(ref(storage('customer'), path), bytes, {
      contentType: file.type
    })
  )
  await uploadBytes(r, bytes, { contentType: file.type })
  await assert.rejects(uploadBytes(r, bytes, { contentType: file.type }))
  await assert.rejects(deleteObject(r))
  await assert.rejects(getMetadata(ref(storage('customer'), path)))
  const result = await call('staff', id, 'commit')
  assert.equal(result.code, 200, JSON.stringify(result))
  assert.equal(
    (await call('staff', id, 'commit')).body.order_id,
    result.body.order_id
  )
  const order = (await db.doc('orders/' + result.body.order_id).get()).data()
  assert.equal(order.source, 'imported_pi')
  assert.equal(order.source_file.name, file.name)
  const download = await fetch(order.source_file.url)
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  const [objects] = await bucket.getFiles({
    prefix: 'shipping_pi_originals/staff/' + id + '/'
  })
  assert.equal(objects.length, 1)
  const receipt = (
    await db.doc('shipping_create_operators/staff/requests/' + id).get()
  ).data()
  assert.equal(
    receipt.file_generation,
    String((await bucket.file(path).getMetadata())[0].generation)
  )
})
test('wrong bytes of the same size cannot create an order or consume its SO', async () => {
  const id = randomUUID(),
    file = {
      name: 'Sample.pdf',
      size: 3,
      type: 'application/pdf',
      sha256: createHash('sha256').update('abc').digest('hex')
    }
  await prep(id, { file })
  await uploadBytes(
    ref(storage('staff'), piObjectPath('staff', id, file.sha256)),
    Buffer.from('def'),
    { contentType: file.type }
  )
  assert.equal((await call('staff', id, 'commit')).code, 409)
  assert.equal((await orders()).size, 0)
  assert.equal((await counter.get()).data().last, 100)
})
test('previously supported large orders keep original header, precision and all lines beyond a single receipt document', async () => {
  const id = randomUUID()
  const lines = Array.from({ length: 360 }, (_, i) => ({
    ...draft.lines[0],
    item_code: 'L' + i,
    description: 'x'.repeat(3100),
    line_no: i + 1
  }))
  const p = await prep(id, { lines })
  assert.equal(p.code, 200, JSON.stringify(p))
  const saved = await call('staff', id, 'commit')
  assert.equal(saved.code, 200, JSON.stringify(saved))
  const o = db.doc('orders/' + saved.body.order_id)
  const records = await o.collection('lines').get()
  assert.equal(records.size, 360)
  assert.deepEqual(
    records.docs.map((d) => d.data()).sort((a, b) => a.line_no - b.line_no)[7],
    normLine(lines[7])
  )
  assert.equal(
    (await o.get()).data().customer_id,
    normOrder(draft.order).customer_id
  )
})
test('a missing or replaced completed order requires review and is never recreated', async () => {
  const id = randomUUID()
  await prep(id)
  const saved = await call('staff', id, 'commit')
  const ref = db.doc('orders/' + saved.body.order_id)
  await ref.delete()
  assert.equal((await call('staff', id, 'commit')).code, 409)
  await ref.set({ source: 'manual' })
  assert.equal((await call('staff', id, 'status')).code, 409)
  assert.equal((await counter.get()).data().last, 101)
})

test('simultaneous uploads and completion from two clients keep the original readable', async () => {
  const id = randomUUID(),
    bytes = Buffer.from('Fictional two-tab original'),
    file = {
      name: 'Two tabs.pdf',
      type: 'application/pdf',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  const path = piObjectPath('staff', id, file.sha256)
  await prep(id, { file })
  const uploads = await Promise.allSettled(
    [storage('staff'), storage('staff')].map((s) =>
      uploadBytes(ref(s, path), bytes, { contentType: file.type })
    )
  )
  assert.ok(uploads.some((x) => x.status === 'fulfilled'))
  const results = await Promise.all([
    call('staff', id, 'commit'),
    call('staff', id, 'commit')
  ])
  assert.ok(
    results.every((x) => x.code === 200),
    JSON.stringify(results)
  )
  assert.equal(results[0].body.order_id, results[1].body.order_id)
  const order = (await orders()).docs[0].data()
  const download = await fetch(order.source_file.url)
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  assert.equal((await counter.get()).data().last, 101)
  assert.equal((await orders()).size, 1)
})
