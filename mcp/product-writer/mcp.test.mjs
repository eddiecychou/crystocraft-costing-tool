import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

test('MCP server starts on stdio and advertises only the narrow draft tool', async () => {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url))
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] })
  const client = new Client({ name: 'product-writer-test', version: '1.0.0' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'create_corp_gift_product_draft')
    assert.deepEqual(new Set(tools[0].inputSchema.required), new Set(['name', 'category', 'request_id']))
    for (const blocked of ['active', 'status', 'price', 'heroImage', 'collection']) {
      assert.equal(tools[0].inputSchema.properties[blocked], undefined)
    }
  } finally {
    await client.close()
  }
})
