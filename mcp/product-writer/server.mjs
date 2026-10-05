import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getIdToken } from './auth.mjs'
import { CATEGORIES } from '../../src/productCategories.js'

const endpoint = new URL('/api/create-corp-gift-product', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
const quoteEndpoint = new URL('/api/create-corp-gift-product-with-quote', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
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

export async function createWithQuote(input, { token = getIdToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(quoteEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Operation Center returned HTTP ${response.status}`)
  if (!data.product_id || !data.component_id || !data.quote_id || !data.edit_url || typeof data.created !== 'boolean') {
    throw new Error('Operation Center returned an incomplete confirmation; retry with the same request_id')
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

server.registerTool('create_corp_gift_product_with_supplier_quote', {
  title: 'Create corporate-gift product and supplier quote',
  description: 'Creates one inactive concept product, its single-item component, and a preferred supplier quote atomically. Requires products and supply access. Use an existing supplier ID; keep confidential pricing only in quote fields. Obtain user approval before calling. Reuse the same request_id and identical content after a timeout.',
  inputSchema: {
    ...schema,
    component_name: z.string().trim().min(1).max(160).describe('Name of the supplied item or component.'),
    component_spec: z.string().trim().max(4000).optional().describe('Factual component specifications only.'),
    supplier_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).describe('Existing Operation Center supplier document ID.'),
    unit_cost: z.number().finite().nonnegative().describe('Supplier unit cost.'),
    unit_cost_currency: z.string().length(3).describe('Three-letter currency code, such as CNY.'),
    moq: z.number().int().nonnegative().optional().describe('Supplier minimum order quantity.'),
    production_lead_time_days: z.number().int().nonnegative().optional(),
    sampling_lead_time_days: z.number().int().nonnegative().optional(),
    tooling_lead_time_days: z.number().int().nonnegative().optional(),
    tooling_sample_cost: z.number().finite().nonnegative().optional(),
    tooling_sample_cost_currency: z.string().length(3).optional(),
    quote_notes: z.string().trim().max(4000).optional().describe('Supplier quote terms, e.g. logo printing included and ex-factory location.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async input => {
  try {
    const result = await createWithQuote(input)
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
  } catch (error) {
    return { content: [{ type: 'text', text: error.message }], isError: true }
  }
})

await server.connect(new StdioServerTransport())
