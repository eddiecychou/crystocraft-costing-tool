import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getRangeIdToken } from '../product-writer/auth.mjs'

const endpoint = new URL('/api/mcp-figurine-range', process.env.OC_BASE_URL || 'https://portal.crystocraft.com')
if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') throw new Error('OC_BASE_URL must use HTTPS')
const codes = z.tuple([
  z.literal('B0016-000-GBK'), z.literal('B0016-000-GBL'), z.literal('B0016-000-GC1'),
  z.literal('B0016-000-GMT'), z.literal('B0016-000-GPE'), z.literal('B0016-000-GVL'),
])
const uuid = z.string().uuid()
const docId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const componentCode = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,79}$/)
const rangeId = z.string().regex(/^mcp_range_[a-f0-9]{32}$/)

export async function callRange(op, input, { token = getRangeIdToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, input }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${data.error?.code || 'REQUEST_FAILED'}: ${data.error?.message || `OC returned HTTP ${response.status}`}`)
  return data
}

const reply = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
const tool = (server, name, title, description, inputSchema, readOnlyHint) => server.registerTool(name, {
  title, description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
}, async input => {
  try { return reply(await callRange(name, input)) }
  catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true } }
})

export function registerRangeTools(server) {
  tool(server, 'create_mezuzah_colour_bom', 'Create approved seven-component B0016 BOM', 'DISABLED pending separately approved rules/config release. Atomic fixed-code bundle, exact C1 reuse, audit and idempotent UUID. Requires approved dry-run hash and explicit acknowledgement that supplier colour coverage is pending. No screws or selling prices.', { range_id: rangeId, request_id: uuid, approved: z.literal(true), dry_run: z.literal(false), expected_preview_hash: z.string().regex(/^[a-f0-9]{64}$/), acknowledge_supplier_colour_pending: z.literal(true) }, false)
  tool(server, 'prepare_mezuzah_colour_bom', 'Prepare colour-specific B0016 BOM', 'DRY RUN ONLY. Fixed FM-B0016BY00-G plus six P-CF003 colours, reusing existing C1. One matching panel per SKU, no screws or selling prices. No live colour-BOM write tool is enabled.', { range_id: rangeId.optional(), request_id: uuid, dry_run: z.literal(true) }, true)
  tool(server, 'search_range_designs', 'Search B0016 Figurine designs', 'Read-only search among B0016 designs by name/number or exact item code. Returns compact records.', { query: z.string().max(80).optional(), item_code: z.string().max(80).optional(), limit: z.number().int().min(1).max(50).optional() }, true)
  tool(server, 'get_range_design', 'Get B0016 Figurine design', 'Read-only B0016 design summary and exact resolvable item codes.', { range_id: docId }, true)
  tool(server, 'prepare_mezuzah_range_design', 'Prepare B0016 design', 'Read-only uniqueness check and exact six-variant preview. Requires dry_run:true; writes nothing.', { item_codes: codes, dry_run: z.literal(true) }, true)
  tool(server, 'create_mezuzah_range_design', 'Create approved B0016 concept', 'Owner-approved atomic create only after review. Writes disabled in phase one. Requires same UUID and payload on retries; no selling price is set.', { item_codes: codes, request_id: uuid, acknowledge_warnings: z.array(z.enum(['UNNAMED_BRAND_CODE', 'UNNAMED_FORMAT_CODE', 'PLATING_REVIEW', 'COLOUR_CODE_NOT_IN_LIBRARY', 'LEGACY_SKU_AUDIT_REQUIRED'])), approved: z.literal(true), dry_run: z.literal(false) }, false)
  tool(server, 'prepare_mezuzah_range_components', 'Prepare B0016 supply components', 'Read-only provenance check and component-code proposal; a separate privileged legacy-code audit is still required. Never transfers the corporate-gift BOM or selling price.', { range_id: rangeId, metal_component_code: componentCode.optional(), fabric_component_code: componentCode.optional(), dry_run: z.literal(true) }, true)
  tool(server, 'create_mezuzah_range_components', 'Create approved B0016 supply components', 'Owner-approved atomic link of two range components and their quotes. Working costs remain internal; no finished-product price is calculated or published.', { range_id: rangeId, metal_component_code: componentCode, fabric_component_code: componentCode, request_id: uuid, approved: z.literal(true), dry_run: z.literal(false) }, false)
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const server = new McpServer({ name: 'crystocraft-figurine-range', version: '0.1.0' })
  registerRangeTools(server)
  await server.connect(new StdioServerTransport())
}
