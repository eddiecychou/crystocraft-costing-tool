import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testStep } from './async-test-step.mjs'

test('diagnostic step returns the real operation result and reports completion', async () => {
  const logs = [], result = { original: true }
  assert.equal(await testStep('read saved summary', async () => result, { log: value => logs.push(value) }), result)
  assert.deepEqual(logs, ['[workspace-sync] start: read saved summary', '[workspace-sync] done: read saved summary'])
})

test('operation errors preserve identity and cannot be reported as completion', async () => {
  const logs = [], error = new Error('Original SDK failure')
  await assert.rejects(testStep('seed fixture', () => { throw error }, { log: value => logs.push(value) }), value => value === error)
  assert.deepEqual(logs, ['[workspace-sync] start: seed fixture'])
})

test('an unresolved operation fails with its exact phase instead of hanging the job', async () => {
  const logs = []
  await assert.rejects(testStep('render Dashboard', () => new Promise(() => {}), { timeoutMs: 5, log: value => logs.push(value) }),
    error => error.code === 'QA_STEP_TIMEOUT' && error.message === 'Workspace test stalled at: render Dashboard (5ms)')
  assert.deepEqual(logs, ['[workspace-sync] start: render Dashboard'])
})
