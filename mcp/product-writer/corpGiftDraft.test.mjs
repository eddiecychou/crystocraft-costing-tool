import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDraft, draftIdentity, commitBody, handleCreateCorpGiftProduct } from '../../netlify/edge-functions/lib/corpGiftDraft.js'

const base = {
  name: '  Example Gift  ', category: 'Fitness & Wellness',
  marketing_description: 'A useful gift.',
  request_id: '123e4567-e89b-42d3-a456-426614174000',
}
const request = (body = base) => new Request('https://portal.crystocraft.com/api/create-corp-gift-product', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
  body: JSON.stringify(body),
})
const allowed = async () => ({ ok: true, uid: 'user-1' })
const run = (req, options = {}) => handleCreateCorpGiftProduct(req, {
  authorize: allowed, projectId: 'test-project', ...options,
})
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('normalizes allowed fields and rejects arbitrary write fields', () => {
  const draft = validateDraft(base)
  assert.equal(draft.name, 'Example Gift')
  assert.equal(draft.product_code, '')
  for (const field of ['active', 'status', 'price', 'heroImage', 'supplier_id']) {
    assert.throws(() => validateDraft({ ...base, [field]: 'injected' }), /Unsupported field/)
  }
})

test('rejects missing name, invalid category and overlong marketing copy', () => {
  assert.throws(() => validateDraft({ ...base, name: ' ' }), /required/)
  assert.throws(() => validateDraft({ ...base, category: 'Other' }), /category/)
  assert.throws(() => validateDraft({ ...base, marketing_description: 'x'.repeat(301) }), /300/)
  assert.throws(() => validateDraft({ ...base, request_id: 'not-a-uuid' }), /UUID/)
})

test('deterministic ID is scoped to user and request, not product title', async () => {
  const draft = validateDraft(base)
  const one = await draftIdentity('user-1', draft)
  assert.deepEqual(one, await draftIdentity('user-1', draft))
  assert.notEqual(one.productId, (await draftIdentity('user-2', draft)).productId)
  assert.notEqual(one.fingerprint, (await draftIdentity('user-1', { ...draft, name: 'Changed' })).fingerprint)
})

test('atomic create has fixed hidden flags, server timestamps and a create precondition', async () => {
  let write
  const res = await run(request(), { fetchImpl: async (_url, init) => {
    write = JSON.parse(init.body)
    return response({}, 200)
  } })
  assert.equal(res.status, 201)
  const data = await res.json()
  assert.equal(data.created, true)
  assert.equal(data.active, false)
  assert.equal(data.status, 'concept')
  assert.equal(write.writes[0].currentDocument.exists, false)
  assert.equal(write.writes[0].update.fields.active.booleanValue, false)
  assert.equal(write.writes[0].update.fields.status.stringValue, 'concept')
  assert.equal(write.writes[0].updateTransforms[0].setToServerValue, 'REQUEST_TIME')
  assert.deepEqual(write, commitBody(write.writes[0].update.name, validateDraft(base), 'user-1', (await draftIdentity('user-1', validateDraft(base))).fingerprint))
})

test('retry returns original product and does not write twice', async () => {
  const draft = validateDraft(base)
  const identity = await draftIdentity('user-1', draft)
  let calls = 0
  const res = await run(request(), { fetchImpl: async () => {
    calls++
    return calls === 1
      ? response({ error: { status: 'ALREADY_EXISTS' } }, 409)
      : response({ fields: {
        mcp_creator_uid: { stringValue: 'user-1' }, mcp_request_hash: { stringValue: identity.fingerprint },
        name: { stringValue: 'Example Gift' }, status: { stringValue: 'sampled' }, active: { booleanValue: true },
      } })
  } })
  assert.equal(calls, 2)
  assert.deepEqual(await res.json(), {
    product_id: identity.productId, name: 'Example Gift', status: 'sampled', active: true,
    edit_url: `https://portal.crystocraft.com/products/${identity.productId}/edit`, created: false,
  })
})

test('reused request ID with changed content conflicts', async () => {
  const res = await run(request(), { fetchImpl: async (_url, init) => init.method === 'POST'
    ? response({ error: { status: 'ALREADY_EXISTS' } }, 409)
    : response({ fields: { mcp_creator_uid: { stringValue: 'user-1' }, mcp_request_hash: { stringValue: 'different' } } }) })
  assert.equal(res.status, 409)
})

test('unauthorized caller and invalid JSON never reach Firestore', async () => {
  let calls = 0
  const denied = await run(request(), {
    authorize: async () => ({ ok: false, response: response({ error: 'Access denied' }, 403) }),
    fetchImpl: async () => { calls++; throw new Error('Must not run') },
  })
  assert.equal(denied.status, 403)
  const bad = await run(new Request('https://portal.crystocraft.com/api/create-corp-gift-product', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  }), { fetchImpl: async () => { calls++; throw new Error('Must not run') } })
  assert.equal(bad.status, 400)
  assert.equal(calls, 0)
})

test('body size and content type are enforced', async () => {
  const tooBig = await run(request({ ...base, description: 'x'.repeat(17000) }))
  assert.equal(tooBig.status, 400)
  const wrongType = await run(new Request('https://portal.crystocraft.com/api/create-corp-gift-product', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello',
  }))
  assert.equal(wrongType.status, 415)
})
