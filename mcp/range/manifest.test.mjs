import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { callRangeUpload } from './server.mjs'

test('fresh stdio manifest contains only the five generic tools and no approval/provision/admin tool', async () => {
  const client = new Client({ name: 'range-manifest-test', version: '1' })
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }))
    const { tools } = await client.listTools()
    assert.deepEqual({tools}, JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8')), 'checked-in manifest must match live stdio schemas')
    assert.deepEqual(tools.map(t => t.name).sort(), ['search_range_families','get_range_family','search_range_components','prepare_range_upload','commit_range_upload'].sort())
    assert.equal(tools.find(t => t.name === 'commit_range_upload').annotations.idempotentHint, true)
    assert.equal(tools.find(t => t.name === 'prepare_range_upload').annotations.readOnlyHint, true)
    const invalid = await client.callTool({ name: 'prepare_range_upload', arguments: { mode: 'create', dry_run: true, family: { active: true } } })
    assert.equal(invalid.isError, true)
  } finally { await client.close() }
})
test('transport validates nested fields and uses only the scoped endpoint/credential', async () => {
  let calls = 0
  const deps = { baseUrl: 'https://portal.crystocraft.com', token: async () => 'fixture-scoped-token', fetchImpl: async (url, options) => {
    calls++; assert.equal(String(url), 'https://portal.crystocraft.com/api/mcp-range')
    assert.equal(options.headers.Authorization, 'Bearer fixture-scoped-token')
    assert.equal(JSON.parse(options.body).op, 'get_range_family')
    return Response.json({ ok: true, family: { id: 'fixture' } })
  } }
  assert.equal((await callRangeUpload('get_range_family', { range_id: 'fixture' }, deps)).ok, true)
  await assert.rejects(callRangeUpload('prepare_range_upload', { mode: 'create', dry_run: true, family: { active: true } }, deps))
  await assert.rejects(callRangeUpload('get_range_family', { range_id: '../products' }, deps))
  await assert.rejects(callRangeUpload('get_range_family', { range_id: 'fixture' }, { ...deps, baseUrl: 'http://example.test' }))
  assert.equal(calls, 1)
})
test('new client auth cannot import Admin credentials or mint broad custom tokens', () => {
  const auth = readFileSync(new URL('./auth.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(auth, /from ['"]firebase-admin|createCustomToken\(|firebase-service-account\.json/)
  assert.match(auth, /0o077/)
})
