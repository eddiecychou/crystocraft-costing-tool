import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

test('MCP server advertises the draft and bundled quote tools', async () => {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url))
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] })
  const client = new Client({ name: 'product-writer-test', version: '1.0.0' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.equal(tools.length, 2)
    const draft = tools.find(tool => tool.name === 'create_corp_gift_product_draft')
    const bundle = tools.find(tool => tool.name === 'create_corp_gift_product_with_supplier_quote')
    assert.ok(draft)
    assert.ok(bundle)
    assert.deepEqual(new Set(draft.inputSchema.required), new Set(['name', 'category', 'request_id']))
    assert.deepEqual(new Set(bundle.inputSchema.required), new Set(['name', 'category', 'request_id', 'component_name', 'supplier_id', 'unit_cost', 'unit_cost_currency']))
    assert.deepEqual(new Set(bundle.inputSchema.properties.unit_cost_currency.enum), new Set(['RMB', 'HKD', 'USD', 'EUR']))
    for (const blocked of ['active', 'status', 'price', 'heroImage', 'collection']) {
      assert.equal(draft.inputSchema.properties[blocked], undefined)
      assert.equal(bundle.inputSchema.properties[blocked], undefined)
    }
  } finally {
    await client.close()
  }
})
