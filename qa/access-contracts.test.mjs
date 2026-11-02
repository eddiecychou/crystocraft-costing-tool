// Execute the actual client/shared/endpoint gates with real JOSE verification.
// Only JWKS transport, Firestore transport, env and AI transport are fixtures.
// No live credentials, network calls, profile writes or messages are possible.
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { accessCases } from './access-contract-cases.mjs'

const project = 'access-contract-test', uid = 'contract-human'
const issuer = `https://securetoken.google.com/${project}`
const profileUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/${uid}`
const googleJwks = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const keys = await generateKeyPair('RS256'), wrongKeys = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(keys.publicKey), kid: 'fictional-qa-key' }
const original = { fetch: globalThis.fetch, Deno: globalThis.Deno, fixture: globalThis.__accessContractFixture }
const f = globalThis.__accessContractFixture = {}
function reset(profile = { role: 'admin' }) {
  Object.assign(f, {
    env: { VITE_FIREBASE_PROJECT_ID: project, DEEPSEEK_API_KEY: 'fictional-key' },
    profile, profileStatus: profile === null ? 404 : 200, profileError: null,
    invalidProfileJson: false, publicJwks: [jwk], profileCalls: [], aiCalls: [],
    unexpected: [], verifications: [], keyLookups: 0,
  })
}
reset()
f.createdUrls = []
globalThis.Deno = { env: { get: name => f.env[name] } }
function restValue(value) {
  if (typeof value === 'string') return { stringValue: value }
  if (value === null) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } }
  throw Error('Unsupported synthetic profile value')
}
globalThis.fetch = async (url, options = {}) => {
  if (String(url) === profileUrl) {
    f.profileCalls.push({ url: String(url), options })
    if (f.profileError) throw f.profileError
    if (f.invalidProfileJson) return new Response('{bad', { status: 200 })
    const fields = Object.fromEntries(Object.entries(f.profile || {}).map(([k, v]) => [k, restValue(v)]))
    return Response.json({ fields }, { status: f.profileStatus })
  }
  if (String(url) === 'https://api.deepseek.com/chat/completions') {
    f.aiCalls.push({ url: String(url), options })
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      subject: 'Fictional subject', body: 'Fictional body', reply: 'Fictional reply',
    }) } }] })
  }
  f.unexpected.push(String(url))
  throw Error(`Unexpected network attempt: ${url}`)
}

const root = fileURLToPath(new URL('..', import.meta.url))
await mkdir(new URL('./out/', import.meta.url), { recursive: true })
const scratch = await mkdtemp(fileURLToPath(new URL('./out/access-source-', import.meta.url)))
const bundle = await build({
  stdin: { contents: `
    export * as auth from './netlify/edge-functions/lib/auth.js';
    export {default as draftTopic, config as draftConfig} from './netlify/edge-functions/draft-outreach-topic.js';
    export {default as discussDraft, config as discussConfig} from './netlify/edge-functions/discuss-outreach-draft.js';
    export {canAccess, resolveModules} from './src/access.js';
  `, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', external: ['jose', 'react'],
  plugins: [{ name: 'offline-jwks-transport', setup(b) {
    b.onResolve({ filter: /^https:\/\/esm\.sh\/jose@5\.9\.6$/ }, args => ({ path: args.path, namespace: 'offline-jwks' }))
    b.onLoad({ filter: /.*/, namespace: 'offline-jwks' }, () => ({ contents: `
      import {jwtVerify as verify, createLocalJWKSet} from 'jose';
      export function createRemoteJWKSet(url) {
        globalThis.__accessContractFixture.createdUrls.push(String(url));
        return async (...args) => {
          const f = globalThis.__accessContractFixture;
          f.keyLookups++;
          return createLocalJWKSet({keys:f.publicJwks})(...args);
        };
      }
      export function jwtVerify(token, jwks, options) {
        globalThis.__accessContractFixture.verifications.push(options);
        return verify(token, jwks, options);
      }
    ` }))
  } }],
})
await writeFile(`${scratch}/source.mjs`, bundle.outputFiles[0].text)
const { auth, draftTopic, discussDraft, draftConfig, discussConfig, canAccess, resolveModules } = await import(pathToFileURL(`${scratch}/source.mjs`))
const endpoints = [
  { name: 'topic', handler: draftTopic, config: draftConfig, path: '/api/draft-outreach-topic', payload: { topic: 'Fictional topic' }, expected: { subject: 'Fictional subject', body: 'Fictional body' } },
  { name: 'refinement', handler: discussDraft, config: discussConfig, path: '/api/discuss-outreach-draft', payload: { productContext: 'Fictional topic', draftSubject: 'Draft', draftBody: 'Body', message: 'Fictional instruction', history: [] }, expected: { reply: 'Fictional reply', subject: 'Fictional subject', body: 'Fictional body' } },
]
async function token(options = {}) {
  return new SignJWT(options.claims || { email: 'qa@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid || jwk.kid })
    .setSubject(uid).setIssuer(options.issuer || issuer).setAudience(options.audience || project)
    .setNotBefore(options.notBefore || Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime(options.expiration || '5m').sign((options.wrongKey ? wrongKeys : keys).privateKey)
}
function request(t, endpoint, { method = 'POST', body, authorization = `Bearer ${t}` } = {}) {
  return new Request(`https://app.example.test${endpoint?.path || '/api/qa'}`, {
    method, headers: authorization === null ? {} : { authorization },
    ...(method === 'POST' ? { body: body ?? JSON.stringify(endpoint?.payload || {}) } : {}),
  })
}
async function deny(response, status, error) {
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), { error })
}
beforeEach(() => reset())
afterEach(() => assert.deepEqual(f.unexpected, [], 'all network boundaries must be explicitly stubbed'))
after(async () => {
  globalThis.fetch = original.fetch
  if (original.Deno === undefined) delete globalThis.Deno
  else globalThis.Deno = original.Deno
  if (original.fixture === undefined) delete globalThis.__accessContractFixture
  else globalThis.__accessContractFixture = original.fixture
  await rm(scratch, { recursive: true, force: true })
})

test('actual source binds both routes and the expected Google JWKS URL', () => {
  assert.deepEqual(f.createdUrls, [googleJwks, googleJwks, googleJwks])
  for (const e of endpoints) assert.equal(e.config.path, e.path)
})

for (const c of accessCases) test(`human role/module matrix: ${c.name}`, async () => {
  assert.equal(canAccess(c.profile?.role, 'marketing', resolveModules(c.profile)), c.marketing)
  assert.equal(canAccess(c.profile?.role, 'customers', resolveModules(c.profile)), c.customers)
  const t = await token()
  for (const key of ['marketing', 'customers']) {
    reset(c.profile)
    const r = await auth.requireModule(request(t), key)
    assert.equal(r.ok, c[key])
    if (!c[key]) await deny(r.response, 403, 'Access denied')
  }
  for (const e of endpoints) {
    reset(c.profile)
    const r = await e.handler(request(t, e))
    if (c.marketing) {
      assert.equal(r.status, 200)
      assert.deepEqual(await r.json(), e.expected)
      assert.equal(f.aiCalls.length, 1)
    } else {
      await deny(r, 403, 'Access denied')
      assert.equal(f.aiCalls.length, 0)
    }
    assert.equal(f.profileCalls.length, 1)
    assert.equal(f.profileCalls[0].options.headers.Authorization, `Bearer ${t}`)
    assert.deepEqual(f.verifications, [{ issuer, audience: project }])
  }
})

const invalidSessions = [
  ['expired', { expiration: Math.floor(Date.now() / 1000) - 120 }],
  ['wrong issuer', { issuer: 'https://issuer.example.test' }],
  ['wrong audience', { audience: 'another-project' }],
  ['future not-before', { notBefore: Math.floor(Date.now() / 1000) + 3600 }],
  ['wrong signature', { wrongKey: true }],
  ['unknown key', { kid: 'unknown-key' }],
  ['malformed token', null],
]
for (const [name, opts] of invalidSessions) test(`real JWT rejection: ${name}`, async () => {
  const t = opts ? await token(opts) : 'not.a.jwt'
  const gates = [req => auth.requireModule(req, 'marketing'), req => auth.requireAdmin(req), ...endpoints.map(e => req => e.handler(req))]
  for (const gate of gates) {
    reset()
    const r = await gate(request(t))
    await deny(r.response || r, 401, 'Invalid or expired session')
    assert.equal(f.profileCalls.length, 0)
    assert.equal(f.aiCalls.length, 0)
  }
})

for (const header of [null, '', 'Basic abc', 'Bearer']) test(`missing Bearer credential: ${JSON.stringify(header)}`, async () => {
  for (const gate of [req => auth.requireModule(req, 'marketing'), req => auth.requireAdmin(req), ...endpoints.map(e => e.handler)]) {
    reset()
    const r = await gate(request('', null, { authorization: header }))
    await deny(r.response || r, 401, 'Not signed in')
    assert.equal(f.verifications.length, 0)
    assert.equal(f.profileCalls.length, 0)
    assert.equal(f.aiCalls.length, 0)
  }
})

test('case-insensitive Bearer, authoritative profile and unchanged helper return shape', async () => {
  const t = await token({ claims: { role: 'admin', modules: ['marketing'] } })
  reset({ role: 'staff', modules: ['customers'] })
  await deny((await auth.requireModule(request(t), 'marketing')).response, 403, 'Access denied')
  reset({ role: 'staff', modules: ['marketing'] })
  const r = await auth.requireModule(request(t, null, { authorization: `bEaReR ${t}` }), 'marketing')
  assert.deepEqual(r, { ok: true, uid, email: null, role: 'staff', modules: ['marketing'] })
  for (const e of endpoints) {
    reset({ role: 'customer', modules: ['marketing'] })
    await deny(await e.handler(request(t, e)), 403, 'Access denied')
    assert.equal(f.aiCalls.length, 0)
  }
})

test('shared helpers preserve any-module matching and explicit role checks', async () => {
  const t = await token()
  reset({ role: 'staff', modules: ['customers'] })
  assert.equal((await auth.requireModule(request(t), ['marketing', 'customers'])).ok, true)
  await deny((await auth.requireModule(request(t), ['marketing', 'supply'])).response, 403, 'Access denied')
  await deny((await auth.requireModule(request(t), [])).response, 403, 'Access denied')
  assert.deepEqual(await auth.requireRole(request(t), ['staff']), { ok: true, uid, email: 'qa@example.test', role: 'staff' })
  await deny((await auth.requireAdmin(request(t))).response, 403, 'Access denied')
  reset()
  assert.equal((await auth.requireModule(request(t), [])).ok, true)
  assert.deepEqual(await auth.requireAdmin(request(t)), { ok: true, uid, email: 'qa@example.test', role: 'admin' })
})

test('method and configuration ordering stays distinct from shared authentication', async () => {
  const t = await token()
  for (const e of endpoints) {
    for (const method of ['GET', 'OPTIONS']) {
      reset(); f.env = {}
      await deny(await e.handler(request(t, e, { method, authorization: null })), 405, 'Method not allowed')
      assert.equal(f.verifications.length, 0)
    }
    reset(); delete f.env.DEEPSEEK_API_KEY
    await deny(await e.handler(request(t, e)), 500, 'Server not configured')
    assert.equal((await auth.requireModule(request(t), 'marketing')).ok, true)
    reset(); f.env = { DEEPSEEK_API_KEY: 'fictional-key' }
    await deny(await e.handler(request(t, e)), 500, 'Server not configured')
    await deny((await auth.requireModule(request(t), 'marketing')).response, 500, 'Server not configured')
    await deny((await auth.requireAdmin(request(t))).response, 500, 'Server not configured')
    assert.equal(f.verifications.length, 0)
    reset(); f.env.FIREBASE_PROJECT_ID = f.env.VITE_FIREBASE_PROJECT_ID; delete f.env.VITE_FIREBASE_PROJECT_ID
    assert.equal((await e.handler(request(t, e))).status, 200)
    assert.equal((await auth.requireModule(request(t), 'marketing')).ok, true)
    assert.equal((await auth.requireAdmin(request(t))).ok, true)
    reset(); f.env.FIREBASE_PROJECT_ID = 'ignored-secondary-project'
    assert.equal((await e.handler(request(t, e))).status, 200)
  }
})

test('non-OK profile reads deny; transport/JSON errors currently propagate', async () => {
  const t = await token()
  for (const gate of [req => auth.requireModule(req, 'marketing'), req => auth.requireAdmin(req), ...endpoints.map(e => e.handler)]) {
    for (const status of [403, 404, 500]) {
      reset(); f.profileStatus = status
      const r = await gate(request(t))
      await deny(r.response || r, 403, 'Access denied')
      assert.equal(f.aiCalls.length, 0)
    }
    reset(); f.profileError = new Error('Fictional transport failure')
    await assert.rejects(gate(request(t)), /Fictional transport failure/)
    reset(); f.invalidProfileJson = true
    await assert.rejects(gate(request(t)), SyntaxError)
    assert.equal(f.aiCalls.length, 0)
  }
})

test('unauthorized requests cannot reach body validation or AI', async () => {
  const t = await token()
  for (const e of endpoints) {
    reset({ role: 'staff', modules: [] })
    await deny(await e.handler(request(t, e, { body: '{bad' })), 403, 'Access denied')
    assert.equal(f.aiCalls.length, 0)
    reset()
    await deny(await e.handler(request(t, e, { body: '{bad' })), 400, 'Bad JSON')
    assert.equal(f.aiCalls.length, 0)
    const missing = e.name === 'topic' ? 'topic is required' : 'message is required'
    await deny(await e.handler(request(t, e, { body: '{}' })), 400, missing)
    if (e.name === 'refinement') await deny(await e.handler(request(t, e, { body: '{"message":"Fictional"}' })), 400, 'draftSubject and draftBody are required')
    assert.equal(f.aiCalls.length, 0)
  }
})
