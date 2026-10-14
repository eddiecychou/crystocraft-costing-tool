import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFirebaseBuildConfig } from '../scripts/firebase-build-config.mjs'
import { loginErrorMessage } from '../src/loginError.js'

const valid = {
  VITE_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: 'auth.crystocraft.com',
  VITE_FIREBASE_PROJECT_ID: 'crystocraft-costing',
  VITE_FIREBASE_STORAGE_BUCKET: 'crystocraft-costing.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '848724224539',
  VITE_FIREBASE_APP_ID: '1:848724224539:web:test',
}
test('valid public client config passes', () => assert.doesNotThrow(() => validateFirebaseBuildConfig(valid)))
for (const key of [undefined, '', '****************b53o', 'placeholder', 'invalid-key']) {
  test(`rejects unusable key (${String(key)})`, () => assert.throws(() => validateFirebaseBuildConfig({ ...valid, VITE_FIREBASE_API_KEY: key })))
}
test('rejects wrong Firebase project', () => assert.throws(() => validateFirebaseBuildConfig({ ...valid, VITE_FIREBASE_PROJECT_ID: 'another-project' })))
test('requires all client config fields', () => assert.throws(() => validateFirebaseBuildConfig({ ...valid, VITE_FIREBASE_APP_ID: undefined })))
test('configuration errors do not blame credentials', () => {
  for (const code of ['auth/invalid-api-key', 'auth/app-not-authorized', 'auth/operation-not-allowed']) {
    assert.match(loginErrorMessage({ code }), /configuration problem/)
    assert.match(loginErrorMessage({ code }), /do not reset/)
  }
})
test('credential errors remain non-enumerating', () => {
  for (const code of ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']) {
    assert.equal(loginErrorMessage({ code }), 'Invalid email or password.')
  }
})
test('email format, connection and throttling have distinct errors', () => {
  assert.match(loginErrorMessage({ code: 'auth/invalid-email' }), /valid email/)
  assert.match(loginErrorMessage({ code: 'auth/network-request-failed' }), /connect/)
  assert.match(loginErrorMessage({ code: 'auth/too-many-requests' }), /wait/)
  assert.match(loginErrorMessage({}), /contact support/)
})
