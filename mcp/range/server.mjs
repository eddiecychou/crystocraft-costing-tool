import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getRangeUploadToken } from './auth.mjs'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const str = z.string().max(200)
const code = z.string().min(2).max(80)
const variant = z.object({ variant_id: str.optional(), brand_code: str.optional(), plating_code: str.optional(), crystal_colors: z.array(z.string().max(8)).max(32).optional(), crystal_code: str.optional(), running_no: str.optional(), no_crystal: z.boolean().optional() }).strict()
const component = z.object({ component_id: id.optional(), code: code.optional(), create: z.object({ code, name: str, category: str, plating_code: str, notes: z.string().max(2000).optional() }).strict().optional(), qty_per_unit: z.number().int().positive().max(100000), applicability: str, ref_index: z.number().int().nonnegative().optional(), critical_reason: z.enum(['long_lead','tooling','high_moq','supply_risk']) }).strict()
const family = z.object({ design_no: str.optional(), format_code: str.optional(), design_name: str.optional(), description: z.string().max(12000).optional(), marketing_description: z.string().max(300).optional(), dimensions: z.object({ length: z.number(), width: z.number(), height: z.number(), unit: z.enum(['mm','cm']), overall_confirmed: z.boolean() }).strict().optional(), category: str.optional(), design_type: str.optional(), product_type: str.optional(), crystal_type: str.optional() }).strict()
export const schemas = {
  search_range_families: z.object({ design_no: str.optional(), format_code: str.optional(), item_code: code.optional(), query: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  get_range_family: z.object({ range_id: id }).strict(),
  search_range_components: z.object({ code: code.optional(), query: z.string().max(100).optional(), range_id: id.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  prepare_range_upload: z.object({ mode: z.enum(['create','update']), range_id: id.optional(), expected_version: z.string().regex(/^[a-f0-9]{64}$/).optional(), family: family.optional(), variants: z.array(variant).max(40).optional(), components: z.array(component).max(20).optional(), media: z.array(z.object({ source_range_id: id, url: z.string().url().max(2000), caption: z.string().max(300) }).strict()).max(10).optional(), category_confirmations: z.array(str).max(20).optional(), code_confirmations: z.array(str).max(20).optional(), dry_run: z.literal(true) }).strict(),
  commit_range_upload: z.object({ preview_token: z.string().max(150000), approval_id: z.string().regex(/^[a-f0-9]{64}$/), idempotency_key: z.string().uuid() }).strict(),
}
const descriptions = {
  search_range_families: 'Bounded read of Crystocraft Range families by exact design/format, canonical item code or name. Never dumps the catalogue or reads Corporate Gifts.',
  get_range_family: 'Read a normalized Range family with ID/version, finish rows and colour chips, components, dimensions, gallery and price state. Supplier costs/private fields are redacted.',
  search_range_components: 'Exact library code first, or bounded name search. Punctuation-only matches require explicit identity confirmation. Returns stable IDs/descriptors, never supplier quotes or costs.',
  prepare_range_upload: 'READ-ONLY dry run for any Range family. New families are hidden Concept with null prices. Returns existing/proposed/diff/conflicts/missing facts plus an expiring signed preview. One finish row contains chips; selected critical parts are NOT a full BOM. Does not approve, write or publish.',
  commit_range_upload: 'Commit ONLY an exact human-reviewed signed preview with a separate private OC-owner approval and caller UUID. Atomic family/components/reservations/audit, live version checks and durable retries. No activation, price, stock, costs, quotes, arbitrary uploads or destructive variant/image replacement. Writes are disabled by default. Retry uncertain outcomes with the SAME token and key.',
}
export async function callRangeUpload(op, input, { token = getRangeUploadToken, fetchImpl = fetch, baseUrl = process.env.OC_BASE_URL || 'https://portal.crystocraft.com' } = {}) {
  if (!Object.hasOwn(schemas, op)) throw new Error('Unsupported Range tool')
  const parsed = schemas[op].parse(input)
  const endpoint = new URL('/api/mcp-range', baseUrl)
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname))) || endpoint.username || endpoint.password) throw new Error('Use HTTPS or an explicit localhost test endpoint')
  const r = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, input: parsed }) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${data.error?.code || 'REQUEST_FAILED'}: ${data.error?.message || 'OC Range request failed'}`)
  return data
}
export function registerRangeUploadTools(server, call = callRangeUpload) {
  for (const [name, schema] of Object.entries(schemas)) server.registerTool(name, { description: descriptions[name], inputSchema: schema,
    annotations: { readOnlyHint: name !== 'commit_range_upload', destructiveHint: name === 'commit_range_upload', idempotentHint: true, openWorldHint: false } }, async input => {
    try { const data = await call(name, input); return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } }
    catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true } }
  })
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const server = new McpServer({ name: 'crystocraft-range-upload', version: '0.1.0' })
  registerRangeUploadTools(server)
  await server.connect(new StdioServerTransport())
}
