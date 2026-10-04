import assert from 'node:assert/strict'
import test from 'node:test'
import { ALREADY_COMPLIANT_IDS, GENERATE_IDS, REGENERATE_IDS, TARGET_IDS } from '../src/marketingRegenerationList.js'

test('bulk marketing allowlist matches the workbook groups without overlap', () => {
  assert.equal(REGENERATE_IDS.length, 75)
  assert.equal(GENERATE_IDS.length, 39)
  assert.equal(ALREADY_COMPLIANT_IDS.length, 13)
  assert.equal(TARGET_IDS.length, 114)
  assert.equal(new Set([...TARGET_IDS, ...ALREADY_COMPLIANT_IDS]).size, 127)
  assert.ok(TARGET_IDS.every(id => /^[a-zA-Z0-9]{20}$/.test(id)))
})
