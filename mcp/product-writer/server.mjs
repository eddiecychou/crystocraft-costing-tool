import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getIdToken, getPricingIdToken } from './auth.mjs'
import { CATEGORIES } from '../../src/productCategories.js'

const endpoint = new URL('/api/create-corp-gift-product', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
const quoteEndpoint = new URL('/api/create-corp-gift-product-with-quote', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
const catalogueEndpoint = new URL('/api/mcp-catalogue', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
const supplyEndpoint = new URL('/api/mcp-product-supply', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
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

export async function callCatalogue(op, input, { token = op === 'search_products' ? getIdToken : getPricingIdToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(catalogueEndpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, input }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.errors?.[0]?.message || `Operation Center returned HTTP ${response.status}`)
  return data
}

export async function callProductSupply(op, input, { token = getIdToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(supplyEndpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, input }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${data.error?.code || 'REQUEST_FAILED'}: ${data.error?.message || `Operation Center returned HTTP ${response.status}`}`)
  return data
}

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
const toolFailure = error => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, updated: [], skipped: [], warnings: [], errors: [{ code: 'REQUEST_FAILED', message: error.message }] }) }], isError: true })

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
    unit_cost_currency: z.enum(['RMB', 'HKD', 'USD', 'EUR']).describe('Supplier-cost currency. Use RMB for Chinese yuan.'),
    moq: z.number().int().nonnegative().optional().describe('Supplier minimum order quantity.'),
    production_lead_time_days: z.number().int().nonnegative().optional(),
    sampling_lead_time_days: z.number().int().nonnegative().optional(),
    tooling_lead_time_days: z.number().int().nonnegative().optional(),
    tooling_sample_cost: z.number().finite().nonnegative().optional(),
    tooling_sample_cost_currency: z.enum(['RMB', 'HKD', 'USD', 'EUR']).optional().describe('Tooling currency. Use RMB for Chinese yuan.'),
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

server.registerTool('search_products', {
  title: 'Search corporate-gift products',
  description: 'Read-only product search. Returns compact catalogue summaries only; supplier filtering is deferred in this first release.',
  inputSchema: { query: z.string().trim().optional(), status: z.enum(['concept', 'sampled', 'active', 'retired']).optional(), category: z.string().trim().optional(), supplier_id: z.string().trim().optional(), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callCatalogue('search_products', input)) } catch (error) { return toolFailure(error) } })

server.registerTool('get_product', {
  title: 'Get internal product record',
  description: 'Read-only internal product detail. Include confidential supplier quotes or pricing only when necessary for an authorised operational task.',
  inputSchema: { product_id: z.string().trim().min(1), include: z.array(z.enum(['components', 'quotes', 'pricing', 'links', 'media'])).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callCatalogue('get_product', input)) } catch (error) { return toolFailure(error) } })

server.registerTool('get_product_costing_readiness', {
  title: 'Check product costing readiness',
  description: 'Read-only readiness check for preferred supplier quotes, costs, MOQ, lead time, tiers, exchange rates, and existing publication state.',
  inputSchema: { product_id: z.string().trim().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callCatalogue('get_product_costing_readiness', input)) } catch (error) { return toolFailure(error) } })

server.registerTool('prepare_catalogue_collection', {
  title: 'Prepare a catalogue collection',
  description: 'DRY RUN ONLY. Validates catalogue metadata, a pricing tier, supplier-cost readiness and price preview for multiple existing products. It does not save, activate, or publish prices in this release.',
  inputSchema: { product_ids: z.array(z.string().trim().min(1)).min(1).max(50), status: z.enum(['concept', 'sampled', 'active', 'retired']).optional(), visible_in_catalogue: z.boolean().optional(), youtube_urls: z.array(z.string().url()).optional(), learn_more_links: z.array(z.object({ label: z.string().trim().min(1).max(120), url: z.string().url() })).optional(), pricing_tier: z.object({ quantity: z.number().positive(), production_lead_time_days: z.number().positive() }), publish_prices: z.boolean().optional(), dry_run: z.literal(true) },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callCatalogue('prepare_catalogue_collection', input)) } catch (error) { return toolFailure(error) } })

server.registerTool('search_suppliers', {
  title: 'Find an existing supplier',
  description: 'Read-only lookup by company name, Chinese name or contact. Returns IDs for human/agent selection; never creates or guesses a supplier.',
  inputSchema: { query: z.string().trim().min(2).max(80), limit: z.number().int().min(1).max(10).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callProductSupply('search_suppliers', input)) } catch (error) { return toolFailure(error) } })

server.registerTool('add_corp_gift_component_with_supplier_quote', {
  title: 'Add component and supplier quote to existing Concept product',
  description: 'Defaults to dry run. Uses an existing inactive MCP Concept product and existing supplier ID; atomically adds only one BOM component, one quote and an audit entry. Requires explicit approval before dry_run:false. Never changes product copy, visibility, selling price, tiers or existing components. Reuse the same request_id and content after a timeout.',
  inputSchema: {
    product_id: z.string().regex(/^mcp_[a-f0-9]{40}$/), supplier_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    component_name: z.string().trim().min(1).max(160), component_spec: z.string().trim().min(1).max(4000),
    component_unit: z.enum(['pcs', 'set', 'pair', 'kg', 'g', 'm', 'box']), qty_per_product: z.number().int().min(1).max(1000),
    unit_cost: z.number().finite().positive().max(10000000), unit_cost_currency: z.enum(['RMB', 'CNY', 'HKD', 'USD', 'EUR']),
    moq: z.number().int().min(1).max(10000000), source_notes: z.string().trim().min(1).max(4000),
    request_id: z.string().uuid(), dry_run: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async input => { try { return result(await callProductSupply('add_corp_gift_component_with_supplier_quote', input)) } catch (error) { return toolFailure(error) } })

await server.connect(new StdioServerTransport())
