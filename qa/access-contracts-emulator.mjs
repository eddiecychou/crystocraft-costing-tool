// Exercise the deployed rule source against ordinary fictional human profiles.
// No live project, auth user, endpoint, AI request or outgoing email is used.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref, uploadString, getMetadata } from 'firebase/storage'
import { accessCases } from './access-contract-cases.mjs'

for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  assert.match(process.env[key] || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Both loopback emulators required; live writes forbidden')
}
const projectId = 'crystocraft-rbac-test'
if (process.env.FIREBASE_TEST_PROJECT && process.env.FIREBASE_TEST_PROJECT !== projectId) throw Error('Unexpected test project')
const resources = [
  ['outreach_drafts', 'marketing'], ['draft_memory_rules', 'marketing'],
  ['outreach_topic_templates', 'marketing'], ['marketing_contacts', 'customers'],
]
const files = [['daily_draft_images/access-contract.txt', 'marketing'], ['marketing_contacts/access-contract/fixture.txt', 'customers']]
let env
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
  })
  await env.withSecurityRulesDisabled(async context => {
    for (const [i, c] of accessCases.entries()) if (c.profile) await setDoc(doc(context.firestore(), `users/access-contract-${i}`), c.profile)
    for (const [collection] of resources) await setDoc(doc(context.firestore(), `${collection}/access-contract-seed`), { fictional: true })
    for (const [path] of files) await uploadString(ref(context.storage(), path), 'Fictional local fixture')
  })
}, { timeout: 45000 })
after(async () => { if (env) await env.cleanup() }, { timeout: 15000 })

for (const [i, c] of [...accessCases, { name: 'unauthenticated', marketing: false, customers: false }].entries()) {
  test(`real rules human matrix: ${c.name}`, { timeout: 20000 }, async () => {
    const context = i < accessCases.length ? env.authenticatedContext(`access-contract-${i}`) : env.unauthenticatedContext()
    for (const [collection, module] of resources) {
      const check = c[module] ? assertSucceeds : assertFails
      await check(getDoc(doc(context.firestore(), `${collection}/access-contract-seed`)))
      await check(setDoc(doc(context.firestore(), `${collection}/access-contract-write-${i}`), { fictional: true }))
    }
    for (const [path, module] of files) {
      const check = c[module] ? assertSucceeds : assertFails
      await check(getMetadata(ref(context.storage(), path)))
      await check(uploadString(ref(context.storage(), `${path}-${i}`), 'Fictional local write'))
    }
  })
}
