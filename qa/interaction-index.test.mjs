import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fieldName, planRepair } from '../scripts/repair-enquiries-date-index.mjs'

const index = (queryScope, order) => ({ queryScope, fields: [{ fieldPath: 'date', order }], state: 'READY' })
test('repository override retains both query scopes and date sort directions', async () => {
  const config = JSON.parse(await readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'))
  const date = config.fieldOverrides.find(f => f.collectionGroup === 'enquiries' && f.fieldPath === 'date')
  for (const queryScope of ['COLLECTION', 'COLLECTION_GROUP']) for (const order of ['ASCENDING', 'DESCENDING']) {
    assert.ok(date.indexes.some(i => i.queryScope === queryScope && i.order === order))
  }
})
test('repair only adds missing collection indexes, preserving every existing spec and omitting output-only state', () => {
  const existing = [index('COLLECTION_GROUP', 'ASCENDING'), index('COLLECTION_GROUP', 'DESCENDING'),
    { queryScope: 'COLLECTION', fields: [{ fieldPath: 'date', arrayConfig: 'CONTAINS' }], state: 'READY', name: 'output-only' }]
  const field = { name: fieldName, indexConfig: { indexes: existing }, ttlConfig: { state: 'ACTIVE' } }
  const { additions, body } = planRepair(field)
  assert.deepEqual(additions.map(i => i.queryScope), ['COLLECTION', 'COLLECTION'])
  assert.deepEqual(body.indexConfig.indexes.slice(0, 3), existing.map(({ state, name, ...spec }) => spec))
  assert.deepEqual(Object.keys(body).sort(), ['indexConfig', 'name'])
  assert.equal(field.indexConfig.indexes.length, 3, 'No mutation of the live baseline')
  assert.deepEqual(planRepair({ ...body, ttlConfig: field.ttlConfig }).additions, [], 'Idempotent after completion')
})
test('repair refuses another project, another field, inherited config or an in-flight revert', () => {
  for (const field of [null, { name: fieldName }, { name: fieldName.replace('enquiries', 'email_threads'), indexConfig: { indexes: [] } },
    { name: fieldName.replace('crystocraft-costing', 'other-project'), indexConfig: { indexes: [] } },
    { name: fieldName, indexConfig: { indexes: [], usesAncestorConfig: true } },
    { name: fieldName, indexConfig: { indexes: [], reverting: true } }]) assert.throws(() => planRepair(field))
})
