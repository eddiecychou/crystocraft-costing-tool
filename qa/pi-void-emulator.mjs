import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, updateDoc } from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createDocumentVoidHandler, createPiVoidRepository } from '../netlify/functions/lib/documentVoids.js'
import { deleteShippingDraft } from '../netlify/functions/lib/deleteShippingDraft.js'
import { orderEditBase } from '../src/orderEditModel.js'

const loopback = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '')
assert.ok(loopback, 'A loopback Firestore emulator is required')
const projectId = 'demo-document-void'

test('PI void keeps the exact revision and protected audit through stale requests, retries and deletion attempts', { timeout: 30000 }, async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: Number(loopback[1]), rules: await readFile('firestore.rules', 'utf8') },
  })
  const app = initializeApp({ projectId }, projectId)
  const db = getFirestore(app)
  try {
    const staffProfile = { role: 'staff', status: 'approved', modules: ['shipping'] }
    const profile = uid => db.doc('users/' + uid)
    await Promise.all([profile('writer').set(staffProfile), profile('editor').set(staffProfile)])
    const handler = createDocumentVoidHandler({
      verifyToken: async uid => ({ uid }),
      getProfile: async uid => (await profile(uid).get()).data(),
      pi: createPiVoidRepository(db, FieldValue.serverTimestamp),
    })
    const orderId = 'fictional-pi-order'
    const order = db.doc('orders/' + orderId)
    const initial = {
      erp_so_no: 'SO992001', erp_si_no: 'SI992007', uc_no: 'UC999', pi_revision: 0,
      customer_id: 'fictional-buyer', status: 'confirmed', stock_reserved: true,
    }
    const line = order.collection('lines').doc('fixture')
    await order.set(initial)
    await line.set({ item_code: 'CR-QA', qty_ordered: 8, unit_price: 15 })
    const call = async (uid, fields) => {
      const res = await handler(new Request('https://fictional.test/api/document-void', {
        method: 'POST', headers: { Authorization: 'Bearer ' + uid }, body: JSON.stringify({ ...fields, orderId }),
      }))
      return [res.status, await res.json()]
    }
    const read = async () => {
      const [status, data] = await call('writer', { action: 'pi_status' })
      assert.equal(status, 200, JSON.stringify(data))
      return data
    }
    const payload = data => ({ action: 'void_pi', target: data.current, version: data.version, reason: 'Fictional buyer requested correction' })
    const stale = await read()
    await order.update({ notes: 'Edited by another tab' })
    assert.equal((await call('writer', payload(stale)))[0], 409)
    assert.deepEqual((await read()).history, [])
    const ready = await read()
    assert.deepEqual(ready.current, { no: 'SO992001', revision: 0 })
    assert.equal((await call('writer', payload(ready)))[0], 200)
    const retry = await call('editor', { ...payload(ready), reason: 'Lost response retry' })
    assert.equal(retry[0], 200)
    assert.equal(retry[1].void.reason, payload(ready).reason)
    assert.deepEqual((await order.get()).data(), { ...initial, notes: 'Edited by another tab' })
    assert.deepEqual((await line.get()).data(), { item_code: 'CR-QA', qty_ordered: 8, unit_price: 15 })
    const audit = (await order.collection('closure_audit').get()).docs
    assert.equal(audit.length, 1)
    assert.equal(audit[0].data().by, 'writer')
    assert.equal(audit[0].data().uc_no, initial.uc_no)
    const client = env.authenticatedContext('writer').firestore()
    await assertFails(updateDoc(doc(client, audit[0].ref.path), { reason: 'Attempted rewrite' }))

    await order.update({ pi_revision: 1 })
    const revised = await read()
    assert.deepEqual(revised.current, { no: 'SO992001', revision: 1 })
    assert.deepEqual(revised.history.map(x => [x.no, x.revision]), [['SO992001', 0]])
    assert.ok(revised.history[0].voidedAt)
    assert.equal((await call('editor', payload(ready)))[0], 200)
    assert.equal((await read()).history.length, 1)

    // Even a draft with lost header references remains traceable by its audit entry.
    await order.set({ status: 'draft' })
    await assert.rejects(deleteShippingDraft(db, 'writer', orderId, orderEditBase({ status: 'draft' }), async () => false),
      /document or closure history/)
    assert.equal((await order.get()).exists, true)
  } finally {
    await db.terminate()
    await deleteApp(app)
    await env.cleanup()
  }
})
