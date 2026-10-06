import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteYoastIndexable } from './yoast-indexable.mjs'

test('deletes only the matching product indexable and confirms it is gone', async () => {
  const calls = []
  const runWpCli = async argv => { calls.push(argv); return calls.length === 1 ? 'wp_\n' : calls.length === 3 ? '0\n' : '' }
  assert.equal(await deleteYoastIndexable({ id: 60509, endpoint: 'wc/v3/products/60509?lang=zh-hant', runWpCli }), true)
  assert.match(calls[1][2], /DELETE FROM wp_yoast_indexable WHERE object_id = 60509 AND object_type = 'post' AND object_sub_type = 'product'/)
  assert.deepEqual(calls[2].slice(-1), ['--skip-column-names'])
})

test('rejects unsafe inputs and a row that remains after delete', async () => {
  const runWpCli = async argv => argv[1] === 'prefix' ? 'wp_' : '1'
  await assert.rejects(deleteYoastIndexable({ id: '1; DROP TABLE', endpoint: 'wp/v2/posts/1', runWpCli }), /invalid WordPress/)
  await assert.rejects(deleteYoastIndexable({ id: 1, endpoint: 'wc/v3/orders/1', runWpCli }), /specific post/)
  await assert.rejects(deleteYoastIndexable({ id: 1, endpoint: 'wp/v2/posts/1', runWpCli }), /still present/)
})
