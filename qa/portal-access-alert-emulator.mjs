// The actual application endpoint with real Firestore transactions and fictional Auth/Resend.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { readFile } from 'node:fs/promises'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  retryAccessAlerts,
  deliverAccessAlert
} from '../netlify/functions/lib/portalAccessAlerts.js'

const projectId = 'demo-portal-access-alert'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/)
const app = initializeApp({ projectId }),
  db = getFirestore(app),
  auth = getAuth(app)
let env, handler, users, attempts, accepted, unknown, reject
const originalFetch = globalThis.fetch,
  originalAuth = {
    getUserByEmail: auth.getUserByEmail,
    createUser: auth.createUser,
    verifyIdToken: auth.verifyIdToken
  }
const variables = ['PORTAL_URL', 'RESEND_API_KEY', 'MAIL_FROM']
const oldEnv = Object.fromEntries(variables.map((k) => [k, process.env[k]]))
const owner = 'eddie@uart.com.hk',
  email = 'fictional-applicant@example.invalid'
const input = {
  email,
  companyName: 'Fictional Gifts',
  contactName: 'Fictional Contact',
  currency: 'GBP',
  to: 'someone-else@example.invalid'
}
const call = async (action, body = {}, token) => {
  const res = await handler(
    new Request('http://fictional.invalid/api/portal-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({ action, ...body })
    })
  )
  return { code: res.status, body: await res.json() }
}
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') }
  })
  handler = (await import('../netlify/functions/portal-invite.js')).default
  auth.getUserByEmail = async (value) => {
    if (users.has(value)) return users.get(value)
    throw Object.assign(Error('Unknown fictional user'), {
      code: 'auth/user-not-found'
    })
  }
  auth.createUser = async ({ email, uid }) => {
    if (users.has(email))
      throw Object.assign(Error('Exists'), {
        code: 'auth/email-already-exists'
      })
    const row = { uid: uid || 'fake-' + users.size, email }
    users.set(email, row)
    return row
  }
  auth.verifyIdToken = async (token) => {
    if (token === 'invalid') throw Error('Invalid fictional session')
    const claims = { uid: token, email, email_verified: true, firebase: { sign_in_provider: 'google.com' } }
    if (token === 'google') return claims
    if (token === 'unverified') return { ...claims, email_verified: false }
    if (token === 'missing-verification') return { ...claims, email_verified: undefined }
    if (token === 'no-email') return { ...claims, email: ' ' }
    if (token === 'no-provider') return { ...claims, firebase: undefined }
    if (token === 'other-google') return { ...claims, email: 'another@example.invalid' }
    return { ...claims, firebase: { sign_in_provider: 'password', identities: { 'google.com': ['linked'] } } }
  }
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === '127.0.0.1')
      return originalFetch(url, options)
    assert.equal(url, 'https://api.resend.com/emails')
    const key = options.headers['Idempotency-Key'],
      payload = JSON.parse(options.body)
    assert.deepEqual(payload.to, [owner])
    assert.equal(options.headers.Authorization, 'Bearer fictional')
    attempts.push({ key, payload, bytes: options.body })
    if (reject) return new Response('{}', { status: 422 })
    if (!accepted.has(key)) accepted.set(key, 'provider-' + accepted.size)
    if (unknown) throw Error('Fictional lost response')
    return Response.json({ id: accepted.get(key) })
  }
})
beforeEach(async () => {
  await env.clearFirestore()
  users = new Map()
  attempts = []
  accepted = new Map()
  reject = false
  unknown = false
  Object.assign(process.env, {
    RESEND_API_KEY: 'fictional',
    MAIL_FROM: 'OC <system@example.invalid>',
    PORTAL_URL: 'https://fictional.invalid'
  })
})
after(async () => {
  globalThis.fetch = originalFetch
  Object.assign(auth, originalAuth)
  for (const k of variables) {
    if (oldEnv[k] === undefined) delete process.env[k]
    else process.env[k] = oldEnv[k]
  }
  await env?.cleanup()
  await deleteApp(app)
})
async function sole(collection) {
  const d = await db.collection(collection).get()
  assert.equal(d.size, 1)
  return d.docs[0]
}
const invitationBody = { invitationId: 'fictional-invite', token: 'fixture-only-invitation', ...input }
async function seedInvitation() {
  const invite = {
    status: 'pending', source: 'self', customer_id: 'fictional-company', contact_email: email,
    token_hash: createHash('sha256').update(invitationBody.token).digest('hex'), audit_log: [],
  }
  await db.doc('customers/fictional-company').set({ company_name: 'Fictional Gifts' })
  await db.doc('portal_invitations/fictional-invite').set(invite)
  return invite
}

for (const action of ['apply_for_account_google', 'claim_invitation_google']) {
  test(action + ' checks the authenticated session before recording any changes', async () => {
    const original = await seedInvitation()
    for (const token of ['password','unverified','missing-verification','no-email','no-provider']) {
      const response = await call(action, invitationBody, token)
      assert.deepEqual(response, { code: 403, body: { error: 'verified_google_required' } })
    }
    assert.equal((await call(action, invitationBody)).code, 401)
    assert.equal((await call(action, invitationBody, 'invalid')).code, 401)
    assert.deepEqual((await sole('portal_invitations')).data(), original)
    assert.equal((await db.collection('users').get()).size, 0)
    assert.equal((await db.collection('portal_access_alerts').get()).size, 0)
    assert.equal(attempts.length, 0)
  })
}

test('only the invited Google email can claim its invitation, and a password invitation still works', async () => {
  const original = await seedInvitation()
  assert.equal((await call('claim_invitation_google', invitationBody, 'other-google')).body.error, 'email_mismatch')
  assert.deepEqual((await sole('portal_invitations')).data(), original)
  const response = await call('claim_invitation_google', invitationBody, 'google')
  assert.deepEqual(response, { code: 200, body: { ok: true, status: 'pending' } })
  assert.equal((await sole('users')).get('auth_provider'), 'google.com')
  assert.equal((await sole('portal_invitations')).get('claimed_uid'), 'google')
  assert.equal((await call('claim_invitation_google', invitationBody, 'google')).body.error,'used')

  const passwordEmail = 'password@example.invalid'
  await db.doc('portal_invitations/password-invite').set({ ...original, contact_email: passwordEmail })
  const password = await call('claim_invitation', { ...invitationBody, invitationId:'password-invite', email:passwordEmail })
  assert.equal(password.code, 200)
  const row = await db.doc('users/'+users.get(passwordEmail).uid).get()
  assert.equal(row.get('email'), passwordEmail)
  assert.equal(row.get('status'), 'pending')
  assert.equal(row.get('auth_provider'), undefined)
})
for (const google of [false, true])
  for (const invited of [false, true]) {
    test(
      (google ? 'Google' : 'email') +
        ' application ' +
        (invited ? 'claims existing invitation' : 'creates new application') +
        ' and sends one internal alert',
      async () => {
        if (invited)
          await db
            .doc('portal_invitations/existing')
            .set({
              status: 'pending',
              source: 'admin',
              contact_email: email,
              customer_id: 'existing-customer',
              contact_name: 'Known contact',
              audit_log: []
            })
        const action = google
            ? 'apply_for_account_google'
            : 'apply_for_account',
          token = google ? 'google' : undefined
        const r = await call(
          action,
          { ...input, email: google ? 'spoofed@example.invalid' : email },
          token
        )
        assert.equal(r.code, 200)
        assert.equal(r.body.status, 'pending')
        const inv = await sole('portal_invitations'),
          user = await sole('users'),
          job = await sole('portal_access_alerts')
        assert.equal(inv.get('claimed_uid'), user.id)
        assert.equal(user.get('status'), 'pending')
        assert.equal(inv.get('status'), 'claimed')
        assert.equal(job.id, inv.id)
        assert.equal(user.get('invitation_id'), inv.id)
        assert.equal(
          user.get('customer_id'),
          invited ? 'existing-customer' : null
        )
        assert.equal(inv.get('source'), invited ? 'admin' : 'self')
        assert.equal(attempts.length, 1)
        assert.match(attempts[0].payload.text, /Fictional Contact/)
        assert.match(
          attempts[0].payload.text,
          /fictional-applicant@example.invalid/
        )
        assert.ok(
          attempts[0].payload.text.includes(
            'https://fictional.invalid/portal/accounts/' + user.id
          )
        )
        assert.equal(job.get('status'), 'accepted')
        assert.equal(inv.get('access_alert_status'), 'accepted')
        assert.ok(job.get('provider_id'))
        const duplicate = await call(action, input, token)
        assert.equal(duplicate.code, google ? 200 : 409)
        await retryAccessAlerts(db)
        assert.equal(attempts.length, 1)
        assert.equal((await db.collection('marketing_contacts').get()).size, 0)
      }
    )
  }
test('concurrent Google completion saves one pending account, invitation, alert and provider acceptance', async () => {
  const results = await Promise.all([
    call('apply_for_account_google', input, 'google'),
    call('apply_for_account_google', input, 'google')
  ])
  assert.ok(
    results.every((r) => r.code === 200),
    JSON.stringify(results)
  )
  await sole('users')
  await sole('portal_invitations')
  await sole('portal_access_alerts')
  assert.equal(attempts.length, 1)
})
test('invalid input, honeypot, ordinary existing login and old pending accounts trigger no alert or historical resend', async () => {
  assert.equal(
    (await call('apply_for_account', { ...input, hp: 'bot' })).code,
    200
  )
  assert.equal(
    (await call('apply_for_account', { ...input, email: 'invalid' })).code,
    400
  )
  await db
    .doc('users/google')
    .set({ role: 'customer', status: 'approved', email })
  await db
    .doc('users/old')
    .set({ role: 'customer', status: 'pending', email: 'old@example.invalid' })
  assert.equal(
    (await call('apply_for_account_google', input, 'google')).body.status,
    'approved'
  )
  await retryAccessAlerts(db)
  assert.equal(attempts.length, 0)
  assert.equal((await db.collection('portal_access_alerts').get()).size, 0)
})
test('ambiguous provider response keeps signup successful and pending; concurrent retries use identical bytes and key once', async () => {
  unknown = true
  assert.equal((await call('apply_for_account', input)).code, 200)
  const inv = await sole('portal_invitations'),
    job = await sole('portal_access_alerts')
  assert.equal(inv.get('access_alert_status'), 'retry')
  assert.equal((await sole('users')).get('status'), 'pending')
  assert.equal(job.get('status'), 'retry')
  assert.equal(accepted.size, 1)
  process.env.MAIL_FROM = 'Changed <changed@example.invalid>'
  unknown = false
  const options = { now: () => job.get('next_attempt_at') + 1 }
  await Promise.all([
    retryAccessAlerts(db, options),
    retryAccessAlerts(db, options)
  ])
  assert.equal(attempts.length, 2)
  assert.equal(accepted.size, 1)
  assert.equal(attempts[0].key, attempts[1].key)
  assert.equal(attempts[0].bytes, attempts[1].bytes)
  assert.equal((await inv.ref.get()).get('access_alert_status'), 'accepted')
})
test('missing settings and definitive sender rejection recover after configuration is corrected', async () => {
  delete process.env.RESEND_API_KEY
  assert.equal((await call('apply_for_account', input)).code, 200)
  const job = await sole('portal_access_alerts')
  assert.equal(attempts.length, 0)
  assert.equal(job.get('status'), 'retry')
  process.env.RESEND_API_KEY = 'fictional'
  reject = true
  await retryAccessAlerts(db, { now: () => job.get('next_attempt_at') + 1 })
  assert.equal(attempts.length, 1)
  process.env.MAIL_FROM = 'Corrected <correct@example.invalid>'
  reject = false
  const retry = await job.ref.get()
  await retryAccessAlerts(db, { now: () => retry.get('next_attempt_at') + 1 })
  assert.equal(accepted.size, 1)
  assert.equal(attempts[1].payload.from, process.env.MAIL_FROM)
  assert.notEqual(attempts[0].key, attempts[1].key)
})
test('an expired ambiguous send requires admin review; applicants cannot read or change delivery jobs', async () => {
  unknown = true
  await call('apply_for_account', input)
  const job = await sole('portal_access_alerts')
  await deliverAccessAlert(db, job.id, {
    now: () => job.get('uncertain_since') + 24 * 3600000
  })
  assert.equal((await job.ref.get()).get('status'), 'needs_review')
  assert.equal(attempts.length, 1)
  await db.doc('users/admin').set({ role: 'admin' })
  const details = { invitationId: job.id, confirmedNotSent: true }
  assert.equal((await call('retry_access_alert', details)).code, 401)
  assert.equal((await call('retry_access_alert', details, 'fake-0')).code, 403)
  assert.equal(
    (
      await call(
        'retry_access_alert',
        { ...details, confirmedNotSent: false },
        'admin'
      )
    ).code,
    400
  )
  const client = env.authenticatedContext('fake-0').firestore()
  try {
    await assert.rejects(
      getDoc(doc(client, job.ref.path)),
      (e) => e.code === 'permission-denied'
    )
    await assert.rejects(
      setDoc(doc(client, job.ref.path), { status: 'queued' }),
      (e) => e.code === 'permission-denied'
    )
  } finally {
    await client.terminate()
  }
  unknown = false
  assert.equal((await call('retry_access_alert', details, 'admin')).code, 200)
  assert.equal((await job.ref.get()).get('status'), 'accepted')
})

const retryKey = 'ab02ee27-c0d3-4ad9-888a-4562f951c001'
const retryInput = { ...input, retryKey }
const pending = { code: 200, body: { ok: true, status: 'pending' } }

async function interruptAfterAuth(request) {
  const create = auth.createUser
  auth.createUser = async details => {
    await create(details)
    throw Error('Fictional interruption after Firebase creates the sign-in')
  }
  try { await assert.rejects(call('apply_for_account', request), /Fictional interruption/) }
  finally { auth.createUser = create }
  assert.equal(users.size, 1)
  assert.equal((await db.collection('users').get()).size, 0)
  assert.equal((await db.collection('portal_access_alerts').get()).size, 0)
  assert.equal(attempts.length, 0)
  return sole('portal_signup_retries')
}

test('interrupted email application resumes its original invitation and fields; concurrent and lost-response retries alert once', async () => {
  await seedInvitation()
  const receipt = await interruptAfterAuth(retryInput)
  assert.equal(receipt.get('uid'), users.get(email).uid)
  assert.equal(receipt.get('invitationId'), invitationBody.invitationId)
  assert.ok(!JSON.stringify(receipt.data()).includes(retryKey))
  const client = env.unauthenticatedContext().firestore()
  try {
    await assert.rejects(getDoc(doc(client, receipt.ref.path)), e => e.code === 'permission-denied')
    await assert.rejects(setDoc(doc(client, receipt.ref.path), { uid: 'other' }), e => e.code === 'permission-denied')
  } finally { await client.terminate() }
  assert.equal((await call('apply_for_account', { ...input, retryKey: 'ab02ee27-c0d3-4ad9-888a-4562f951c002' })).code, 409)
  const retry = { ...retryInput, email: email.toUpperCase(), companyName: 'Retyped name', currency: 'USD' }
  const results = await Promise.all([call('apply_for_account', retry), call('apply_for_account', retry)])
  assert.deepEqual(results, [pending, pending])
  assert.deepEqual(await call('apply_for_account', retryInput), pending)
  const profile = await sole('users')
  assert.equal(profile.id, receipt.get('uid'))
  assert.equal(profile.get('base_currency'), input.currency)
  assert.equal(profile.get('company_name'), input.companyName)
  assert.equal(profile.get('invitation_id'), invitationBody.invitationId)
  assert.equal(profile.get('customer_id'), 'fictional-company')
  assert.equal((await sole('portal_invitations')).get('claimed_uid'), profile.id)
  assert.equal((await sole('portal_access_alerts')).get('status'), 'accepted')
  assert.equal((await receipt.ref.get()).exists, false)
  assert.equal(users.size, 1)
  assert.equal(attempts.length, 1)
})

test('two concurrent first submissions converge even when both see no Auth user', async () => {
  const results = await Promise.all([call('apply_for_account', retryInput), call('apply_for_account', retryInput)])
  assert.deepEqual(results, [pending, pending])
  assert.equal(users.size, 1)
  await sole('users')
  await sole('portal_invitations')
  await sole('portal_access_alerts')
  assert.equal(attempts.length, 1)
})

test('a cached email form can replay its exact frozen application after an interruption', async () => {
  await interruptAfterAuth(input)
  assert.equal((await call('apply_for_account', { ...input, currency: 'EUR' })).code, 409)
  assert.deepEqual(await call('apply_for_account', input), pending)
  assert.equal(users.size, 1)
  assert.equal(attempts.length, 1)
})

test('unknown Auth identities, changed credentials and revoked invitations cannot be adopted by a retry', async () => {
  users.set(email, { uid: 'old-auth', email })
  assert.equal((await call('apply_for_account', retryInput)).body.error, 'already_registered')
  assert.equal((await db.collection('portal_signup_retries').get()).size, 0)
  users.clear()
  await seedInvitation()
  const receipt = await interruptAfterAuth(retryInput)
  const original = users.get(email)
  for (const change of [{ uid: 'replacement' }, { disabled: true }, { emailVerified: true },
    { customClaims: { staff: true } }, { providerData: [{ providerId: 'google.com' }] }, { passwordHash: 'fictional' }]) {
    users.set(email, { ...original, ...change })
    assert.equal((await call('apply_for_account', retryInput)).body.error, 'already_registered')
  }
  users.set(email, original)
  await db.doc('portal_invitations/'+invitationBody.invitationId).update({ status: 'revoked' })
  assert.equal((await call('apply_for_account', retryInput)).code, 409)
  assert.equal((await receipt.ref.get()).exists, true)
  assert.equal((await sole('portal_invitations')).get('status'), 'revoked')
  assert.equal((await db.collection('users').get()).size, 0)
  assert.equal((await db.collection('portal_access_alerts').get()).size, 0)
  assert.equal(attempts.length, 0)
})

test('the same reserved UID survives a transient Auth outage before creation', async () => {
  const create = auth.createUser
  auth.createUser = async () => { throw Error('Fictional temporary Auth outage') }
  try { await assert.rejects(call('apply_for_account', retryInput), /temporary Auth outage/) }
  finally { auth.createUser = create }
  const receipt = await sole('portal_signup_retries')
  assert.equal(users.size, 0)
  assert.equal(attempts.length, 0)
  assert.deepEqual(await call('apply_for_account', retryInput), pending)
  assert.equal(users.get(email).uid, receipt.get('uid'))
  assert.equal(attempts.length, 1)
})

test('a new staff invitation arriving during interruption is preserved', async () => {
  await interruptAfterAuth(retryInput)
  const original = await seedInvitation()
  assert.equal((await call('apply_for_account', retryInput)).body.error, 'signup_invitation_changed')
  assert.deepEqual((await sole('portal_invitations')).data(), original)
  assert.equal((await db.collection('users').get()).size, 0)
  assert.equal(attempts.length, 0)
})
