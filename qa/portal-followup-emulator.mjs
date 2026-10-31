// Actual Admin SDK transactions + existing endpoint. Auth/provider are isolated;
// loopback-only Firestore is mandatory. Never writes live applications or mail.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { accountFollowupAction, sendFollowupEmail } from '../netlify/functions/lib/portalAccountFollowup.js'

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Firestore emulator required. Live writes forbidden.')
const projectId = 'portal-followup-test'
let app, db, env, handler, oldVerify, clock, sends, oldFetch
const mail = { from: 'QA <sender@example.test>', replyTo: 'reply@example.test', apiKey: 'fixture-only' }
const uid = 'applicant', root = `portal_account_followups/${uid}`
const id1 = '00000000-0000-4000-8000-000000000001', id2 = '00000000-0000-4000-8000-000000000002'
const account = { role: 'customer', status: 'pending', email: 'applicant@example.test', company_name: 'Fictional company', contact_name: 'Test Contact', ws_discount_pct: 100, pricing_group: 'Keep', customer_id: null }
const state = async () => (await db.doc(root).get()).data()
const message = async (id = id1) => (await db.doc(`${root}/messages/${id}`).get()).data()
const act = (action, body = {}, opts = {}) => accountFollowupAction({ db, actorUid: 'admin', action, body: { uid, ...body }, mail,
  now: () => clock, send: async (payload, key) => { sends.push({ payload, key }); return { status: 'sent', provider_id: 'fixture-provider-id' } }, ...opts })
const send = (body = {}, opts = {}) => act('send_account_followup', { revision: 0, messageId: id1, expectedEmail: account.email, subject: 'Edited subject 中文', message: 'Exact reviewed message\n\nBest regards,\nEddie', ...body }, opts)
const request = (body, token = 'admin') => new Request('https://example.test/api/portal-invite', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })

before(async () => {
  app = initializeApp({ projectId }); db = getFirestore(app)
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
  oldVerify = getAuth().verifyIdToken
  getAuth().verifyIdToken = async token => { if (token === 'invalid') throw Error('Invalid fixture token'); return { uid: token, email: `${token}@example.test` } }
  handler = (await import('../netlify/functions/portal-invite.js')).default
  oldFetch = globalThis.fetch
})
beforeEach(async () => {
  globalThis.fetch = oldFetch
  await env.clearFirestore(); clock = 1800000000000; sends = []
  await Promise.all([db.doc('users/admin').set({ role: 'admin' }), db.doc('users/staff').set({ role: 'staff', modules: ['portal', 'customers'] }), db.doc(`users/${uid}`).set(account)])
})
after(async () => { globalThis.fetch = oldFetch; getAuth().verifyIdToken = oldVerify; await env?.cleanup(); await deleteApp(app) })

test('draft save/reopen and exact edited send keep account/pricing/customer records unchanged', async () => {
  const initial = await act('get_account_followup'); assert.equal(initial.revision, 0)
  const draft = { subject: 'Edited subject 中文', message: 'Exact reviewed message\n\nBest regards,\nEddie' }
  await act('save_account_followup_draft', { ...draft, revision: 0 })
  assert.deepEqual((await act('get_account_followup')).draft, draft); assert.equal(sends.length, 0)
  const sent = await send({ revision: 1 }); assert.equal(sent.state, 'waiting'); assert.equal(sent.draft, null)
  assert.equal(sent.messages[0].message, draft.message); assert.equal(sent.messages[0].status, 'sent')
  assert.deepEqual(sends[0].payload, { from: mail.from, to: account.email, subject: draft.subject, text: draft.message, reply_to: mail.replyTo })
  assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), account)
  assert.equal((await db.collection('customers').get()).size, 0); assert.equal((await db.collection('portal_invitations').get()).size, 0)
})
test('stale drafts and concurrent edits cannot overwrite another session', async () => {
  await act('save_account_followup_draft', { subject: 'Keep', message: 'Other session', revision: 0 })
  await assert.rejects(() => act('save_account_followup_draft', { subject: 'Lost', message: 'Stale', revision: 0 }), /another session/)
  const result = await Promise.allSettled([send({ revision: 1 }), send({ revision: 1, messageId: id2 })])
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends.length, 1)
  assert.equal((await db.collection(root + '/messages').get()).size, 1)
})
test('same-request replay and different-request duplicate do not send twice', async () => {
  await send(); await send(); assert.equal(sends.length, 1)
  await assert.rejects(() => send({ messageId: id2, revision: 0 }), /another session/)
  const revision = (await state()).revision
  await assert.rejects(() => send({ messageId: id2, revision }), /just sent/)
})
test('concurrent same-reference clicks result in one provider request', async () => {
  await Promise.allSettled([send(), send()])
  assert.equal(sends.length, 1); assert.equal((await message()).status, 'sent')
  assert.equal((await db.collection(root + '/messages').get()).size, 1)
})
test('provider rejection keeps the draft, records not-sent and never marks waiting', async () => {
  const result = await send({}, { send: async () => ({ status: 'failed' }) })
  assert.equal(result.state, 'new'); assert.equal(result.messages[0].status, 'failed')
  assert.ok(result.draft); assert.equal(result.last_sent_at, null); assert.equal(result.active_message_id, null)
})
test('lost final database write recovers the original accepted payload/key without a second delivery', async () => {
  let writes = 0, deliveries = 0
  const accepted = new Map(), requests = []
  const sender = async (payload, key) => { requests.push({ payload, key }); if (!accepted.has(key)) { deliveries++; accepted.set(key, { status: 'sent', provider_id: 'once' }) }; return accepted.get(key) }
  const dbWithFailure = { collection: db.collection.bind(db), runTransaction: fn => { if (++writes === 2) throw Error('Lost completion write'); return db.runTransaction(fn) } }
  await assert.rejects(() => send({}, { db: dbWithFailure, send: sender }), /Lost completion/)
  assert.equal((await state()).active_message_id, id1); clock += 31000
  await send({}, { send: sender })
  assert.equal(deliveries, 1); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1])
  assert.equal((await message()).status, 'sent'); assert.equal((await state()).state, 'waiting')
})
test('unknown result blocks a fresh send; retry freezes original recipient/payload/key and recovers', async () => {
  const unknown = async (payload, key) => { sends.push({ payload, key }); return { status: 'unknown' } }
  await send({}, { send: unknown }); assert.equal((await state()).active_message_id, id1)
  const revision = (await state()).revision
  await assert.rejects(() => send({ messageId: id2, revision }), /unconfirmed/)
  await assert.rejects(() => send(), /still being sent/)
  clock += 31000
  await send({ subject: 'Ignore changed retry subject', message: 'Do not replace original' }, { mail: { ...mail, from: 'Changed sender' }, now: () => clock++ })
  assert.equal(sends.length, 2); assert.deepEqual(sends[0], sends[1]); assert.equal((await state()).active_message_id, null)
  assert.equal((await message()).status, 'sent')
})
test('unknown sends are never retried after the provider key safety window', async () => {
  await send({}, { send: async () => ({ status: 'unknown' }) }); clock += 23 * 3600000
  await assert.rejects(() => send(), /safe retry period/); assert.equal(sends.length, 0)
  const before = await state()
  await act('resolve_account_followup', { messageId: id1, revision: before.revision, outcome: 'not_sent' })
  assert.equal((await message()).manual_resolution, 'not_sent'); assert.equal((await state()).active_message_id, null)
})
test('manual checked sent result records history without another send', async () => {
  await send({}, { send: async () => ({ status: 'unknown' }) }); clock += 31000
  await act('resolve_account_followup', { messageId: id1, revision: (await state()).revision, outcome: 'sent' })
  assert.equal((await state()).state, 'waiting'); assert.equal((await state()).draft, null)
  assert.equal((await message()).resolved_by, 'admin'); assert.equal(sends.length, 0)
})
test('information received is manual, revision-checked and never approves or links the account', async () => {
  await assert.rejects(() => act('mark_account_information_received', { revision: 0 }), /no outstanding/)
  await send(); const result = await act('mark_account_information_received', { revision: (await state()).revision })
  assert.equal(result.state, 'received'); assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), account)
  await db.doc(`users/${uid}`).update({ status: 'approved', customer_id: 'linked-later' })
  assert.equal((await act('get_account_followup')).messages[0].to, account.email)
  await assert.rejects(() => send({ messageId: id2 }), /no longer a pending/)
})
for (const patch of [{ role: 'admin' }, { role: 'staff' }, { status: 'approved' }, { status: 'suspended' }, { account_type: 'internal' }]) test('non-applicant cannot be contacted: ' + JSON.stringify(patch), async () => {
  await db.doc(`users/${uid}`).update(patch)
  await assert.rejects(() => send(), /no longer a pending/); assert.equal(sends.length, 0); assert.equal(await state(), undefined)
})
test('recipient comes from server record; changed address, missing account and invalid content fail without sending', async () => {
  for (const patch of [{ expectedEmail: 'other@example.test' }, { subject: 'Header\ninjection' }, { subject: '' }, { message: 'x'.repeat(6001) }, { messageId: '../../path' }]) await assert.rejects(() => send(patch))
  await db.doc(`users/${uid}`).delete(); await assert.rejects(() => send(), /not found/)
  assert.equal(sends.length, 0); assert.equal(await state(), undefined)
})
test('missing sender/reply configuration still permits drafts but cannot reserve or send', async () => {
  await act('save_account_followup_draft', { subject: 'Keep', message: 'Save', revision: 0 }, { mail: {} })
  assert.equal((await act('get_account_followup', {}, { mail: {} })).mail_configured, false)
  await assert.rejects(() => send({ revision: 1 }, { mail: { ...mail, replyTo: '' } }), /not configured/)
  assert.equal(sends.length, 0); assert.equal((await db.collection(root + '/messages').get()).size, 0)
})
test('leased send completion cannot overwrite a later attempt or checked resolution', async () => {
  let release
  const first = send({}, { send: () => new Promise(r => { release = r }) })
  while (!release) await new Promise(r => setTimeout(r, 5))
  clock += 31000
  await act('resolve_account_followup', { messageId: id1, revision: (await state()).revision, outcome: 'not_sent' })
  release({ status: 'sent', provider_id: 'late' }); await first
  assert.equal((await message()).status, 'failed'); assert.equal((await state()).active_message_id, null)
})
test('existing endpoint authenticates all five actions and ignores spoofed actor fields', async () => {
  for (const action of ['get_account_followup', 'save_account_followup_draft', 'send_account_followup', 'mark_account_information_received', 'resolve_account_followup']) {
    assert.equal((await handler(request({ action, uid, actorUid: 'admin' }, ''))).status, 401)
    assert.equal((await handler(request({ action, uid, actorUid: 'admin' }, 'invalid'))).status, 401)
    assert.equal((await handler(request({ action, uid, actorUid: 'admin' }, 'staff'))).status, 403)
    assert.equal((await handler(request({ action, uid, actorUid: 'admin' }, uid))).status, 403)
    assert.ok([200, 400, 409, 503].includes((await handler(request({ action, uid }, 'admin'))).status))
  }
  assert.equal(sends.length, 0)
})
test('real endpoint draft/send/history roundtrip uses provider acceptance and leaves the account pending', async () => {
  const keys = ['RESEND_API_KEY', 'MAIL_PERSONAL_FROM', 'MAIL_REPLY_TO']
  const old = keys.map(k => process.env[k])
  try {
    process.env.RESEND_API_KEY = mail.apiKey; process.env.MAIL_PERSONAL_FROM = mail.from; process.env.MAIL_REPLY_TO = mail.replyTo
    const requests = []
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails'); requests.push({ payload: JSON.parse(init.body), key: init.headers['Idempotency-Key'] })
      return Response.json({ id: 'fixture-accepted' })
    }
    const call = async body => { const r = await handler(request({ uid, ...body })); assert.equal(r.status, 200); return r.json() }
    const saved = await call({ action: 'save_account_followup_draft', subject: 'Actual endpoint', message: 'Reviewed body', revision: 0 })
    const sent = await call({ action: 'send_account_followup', ...saved.draft, messageId: id1, expectedEmail: account.email, revision: saved.revision, to: 'ignored@example.test' })
    assert.equal(sent.state, 'waiting'); assert.equal(requests.length, 1); assert.equal(requests[0].payload.to, account.email)
    assert.equal(requests[0].payload.text, 'Reviewed body'); assert.equal(requests[0].payload.reply_to, mail.replyTo)
    const reopened = await call({ action: 'get_account_followup' }); assert.equal(reopened.messages[0].status, 'sent')
    assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), account)
    assert.equal((await db.collection('customers').get()).size, 0)
  } finally { globalThis.fetch = oldFetch; keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i] }) }
})
test('private follow-up and message documents deny direct browser reads/writes, even to the applicant', async () => {
  await send()
  for (const who of [uid, 'staff', 'admin', null]) {
    const browser = (who ? env.authenticatedContext(who) : env.unauthenticatedContext()).firestore()
    for (const path of [root, root + '/messages/' + id1]) {
      await assertFails(getDoc(doc(browser, path))); await assertFails(setDoc(doc(browser, path), { status: 'sent' }))
    }
  }
})
test('provider call uses exact text/recipient/reply inbox, bounded timeout and idempotency header', async () => {
  const payload = { from: mail.from, to: account.email, subject: 'Subject', text: 'Exact text', reply_to: mail.replyTo }
  let seen
  const result = await sendFollowupEmail(payload, 'same-key', { apiKey: mail.apiKey, fetchImpl: async (url, init) => { seen = { url, init }; return Response.json({ id: 'provider-id' }) } })
  assert.equal(result.status, 'sent'); assert.equal(seen.init.headers['Idempotency-Key'], 'same-key')
  assert.deepEqual(JSON.parse(seen.init.body), payload); assert.ok(seen.init.signal)
  for (const [status, expected] of [[400, 'failed'], [422, 'failed'], [409, 'unknown'], [429, 'unknown'], [500, 'unknown']])
    assert.equal((await sendFollowupEmail(payload, 'same-key', { apiKey: '', fetchImpl: async () => new Response('', { status }) })).status, expected)
  assert.equal((await sendFollowupEmail(payload, 'same-key', { apiKey: '', fetchImpl: async () => { throw Error('timeout') } })).status, 'unknown')
})
