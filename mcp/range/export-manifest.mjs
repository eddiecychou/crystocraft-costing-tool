// Local schema inspection only: listTools does not invoke an OC endpoint.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
const client = new Client({ name: 'range-manifest-export', version: '1' })
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }))
  console.log(JSON.stringify(await client.listTools(), null, 2))
} finally { await client.close() }
