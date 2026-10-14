import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

test('release entrypoint and Firestore rules hard-disable live writes independently of environment', () => {
  const endpoint = readFileSync(new URL('../../netlify/edge-functions/mcp-figurine-range.js', import.meta.url), 'utf8')
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
  assert.match(endpoint, /writesEnabled:\s*false/)
  assert.doesNotMatch(endpoint, /Deno\.env\.get\(['"]FIGURINE_MCP_WRITES_ENABLED/)
  assert.match(rules, /function b0016WritesApproved\(\)\s*\{\s*return false;/)
})

test('dedicated Figurine MCP starts and advertises only eight scoped tools', async () => {
  const path = fileURLToPath(new URL('./server.mjs', import.meta.url))
  const client = new Client({ name: 'figurine-range-test', version: '0.1.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [path] })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), [
      'search_range_designs', 'get_range_design', 'prepare_mezuzah_range_design',
      'create_mezuzah_range_design', 'prepare_mezuzah_range_components',
      'create_mezuzah_range_components',
      'prepare_mezuzah_colour_bom',
      'create_mezuzah_colour_bom',
    ].sort())
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, t.name.startsWith('search_') || t.name.startsWith('get_') || t.name.startsWith('prepare_'))
      for (const forbidden of ['price_hkd', 'selling_price', 'publish_prices', 'active', 'status', 'supplier_notes']) assert.equal(t.inputSchema.properties[forbidden], undefined)
    }
    for (const t of tools.filter(t => t.name.startsWith('create_'))) {
      assert.equal(t.inputSchema.properties.approved.const, true)
      assert.equal(t.inputSchema.properties.dry_run.const, false)
      assert.ok(t.inputSchema.required.includes('request_id'))
    }
  } finally { await client.close() }
})
