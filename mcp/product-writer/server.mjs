import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getIdToken } from './auth.mjs'
import { CATEGORIES } from '../../src/productCategories.js'

const endpoint = new URL('/api/create-corp-gift-product', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') throw new Error('OC_BASE_URL must use HTTPS')

const schema = {
  name: z.string().trim().min(1).max(160).describe('Product name, using only supplied or verified facts.'),
  category: z.enum(CATEGORIES).describe('Existing Operation Center corporate-gift category.'),
  description: z.string().trim().max(4000).optional().describe('Factual specs only. Omit unknown materials, dimensions, certifications, functions, and performance claims.'),
  marketing_description: z.string().trim().max(300).optional().describe('Customer-facing copy, max 300 characters. Do not put prices or MOQ here.'),
  assembly_notes: z.string().trim().max(4000).optional().describe('Internal production/handling notes.'),
  product_code: z.string().trim().max(80).optional().describe('Only if the user explicitly supplied a code.'),
  request_id: z.string().uuid().describe('Generate one UUID per intended product and reuse exactly the same UUID and content on retries.'),
}

export async function createDraft(input, { token = getIdToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Operation Center returned HTTP ${response.status}`)
  if (!data.product_id || !data.edit_url || typeof data.created !== 'boolean') {
    throw new Error('Operation Center returned an incomplete product confirmation; retry with the same request_id')
  }
  return data
}

const server = new McpServer({ name: 'crystocraft-product-writer', version: '1.0.0' })
server.registerTool('create_corp_gift_product_draft', {
  title: 'Create corporate-gift product draft',
  description: 'Creates one inactive concept product in the Operation Center catalogue. Write only facts supplied by the user or verified from source material. Omit unknown specs and do not place supplier prices or MOQs in catalogue copy. This is a write action; obtain user approval before calling. Return the edit URL for staff review. Reuse request_id and identical content after a timeout.',
  inputSchema: schema,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async input => {
  try {
    const result = await createDraft(input)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
  } catch (error) {
    return { content: [{ type: 'text', text: error.message }], isError: true }
  }
})

await server.connect(new StdioServerTransport())
