import { buildRangeSku, enumerateRangeSkus } from '../../../src/rangeSku.js'
import { RANGE_CRYSTAL_BRANDS, RANGE_FORMAT_CODES, RANGE_PLATINGS } from '../../../src/constants.js'
import { readLimitedJson } from './corpGiftDraft.js'
import { prepareB0016ColourBom, createB0016ColourBom, B0016_REUSE_ID } from './b0016ColourBom.js'

export const RANGE_SERVICE_UID = 'mcp-figurine-range-service'
export const SOURCE_PRODUCT_ID = 'mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd'
export const ITEM_CODES = ['B0016-000-GBK', 'B0016-000-GBL', 'B0016-000-GC1', 'B0016-000-GMT', 'B0016-000-GPE', 'B0016-000-GVL']
export const SOURCE_PARTS = {
  metal: { component_id: 'mcp_a844ebe21ba90961027c', quote_id: 'mcp_05752f5a8554c7a7d4bd', supplier_id: '33VhLPOuBM46wcCmsb7B', cost: 11.30, moq: 500, tooling: 2912 },
  fabric: { component_id: 'mcp_4e4b6112f372269e30dcfb21ea53ca5f', quote_id: 'mcp_49239ae8ae9de42b0d7f9986d60da702', supplier_id: 'D1SDoLIAc2aw6PdP76Xo', source_cost: 8.10, working_cost: 9.00, moq: 100 },
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (code, message, status = 400) => json({ ok: false, error: { code, message } }, status)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,79}$/
const OPS = new Set(['search_range_designs', 'get_range_design', 'prepare_mezuzah_range_design', 'create_mezuzah_range_design', 'prepare_mezuzah_range_components', 'create_mezuzah_range_components', 'prepare_mezuzah_colour_bom', 'create_mezuzah_colour_bom'])
const WRITE_OPS = new Set(['create_mezuzah_range_design', 'create_mezuzah_range_components', 'create_mezuzah_colour_bom'])
const ALLOWED = {
  create_mezuzah_colour_bom: ['range_id', 'request_id', 'dry_run', 'approved', 'expected_preview_hash', 'acknowledge_supplier_colour_pending'],
  prepare_mezuzah_colour_bom: ['range_id', 'request_id', 'dry_run'],
  search_range_designs: ['query', 'item_code', 'limit'],
  get_range_design: ['range_id'],
  prepare_mezuzah_range_design: ['item_codes', 'dry_run'],
  create_mezuzah_range_design: ['item_codes', 'request_id', 'approved', 'acknowledge_warnings', 'dry_run'],
  prepare_mezuzah_range_components: ['range_id', 'metal_component_code', 'fabric_component_code', 'dry_run'],
  create_mezuzah_range_components: ['range_id', 'metal_component_code', 'fabric_component_code', 'request_id', 'approved', 'dry_run'],
}

function only(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object')
  const extra = Object.keys(input).find(key => !fields.includes(key))
  if (extra) throw new Error(`Unsupported field: ${extra}`)
}
function bool(value, label) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
}
function id(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`${label} must be a document ID, not a path`)
  return value
}
function requestId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error('request_id must be a UUID')
  return value.toLowerCase()
}
export function exactCodes(codes) {
  if (!Array.isArray(codes) || codes.length !== 6 || codes.some(code => typeof code !== 'string')) throw new Error('item_codes must contain exactly six item codes')
  if (new Set(codes).size !== 6 || !ITEM_CODES.every(code => codes.includes(code))) throw new Error('item_codes must match the six supplied B0016 codes exactly, with no duplicates or substitutions')
  return [...ITEM_CODES]
}
function componentCode(value, label) {
  if (typeof value !== 'string' || !CODE_RE.test(value)) throw new Error(`${label} must be a reviewed, uppercase component/ERP code (2–80 characters)`)
  return value
}
export function decode(v) {
  if (!v || typeof v !== 'object' || 'nullValue' in v) return null
  if ('stringValue' in v) return v.stringValue
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('timestampValue' in v) return v.timestampValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([key, value]) => [key, decode(value)]))
  return null
}
export function encode(v) {
  if (v == null) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } }
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([key, value]) => [key, encode(value)])) } }
  throw new Error('Unsupported Firestore value')
}
const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
const fromDoc = doc => ({ id: doc.name.split('/').at(-1), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, decode(value)])), updateTime: doc.updateTime })
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('')
export async function identity(op, request_id, payload) {
  const hash = await sha(JSON.stringify(payload))
  const key = await sha(`${RANGE_SERVICE_UID}\n${op}\n${request_id}`)
  return { hash, range_id: `mcp_range_${key.slice(0, 32)}`, audit_id: `mcp_range_${key}`, metal_id: `mcp_b0016_m_${key.slice(0, 20)}`, fabric_id: `mcp_b0016_f_${key.slice(0, 20)}`, metal_quote_id: `mcp_b0016_mq_${key.slice(0, 20)}`, fabric_quote_id: `mcp_b0016_fq_${key.slice(0, 20)}` }
}

export function designDraft(item_codes = ITEM_CODES) {
  exactCodes(item_codes)
  // RangeForm hydrates omitted optional display fields when the concept is
  // opened. Keep this initial customer-readable variant map exact and small:
  // Firestore can validate all six maps without exceeding its rule budget.
  const variants = ITEM_CODES.map(sku => ({
    brand_code: 'B', plating_code: 'G', crystal_code: sku.slice(-2), sku,
    ws_price_usd: null,
  }))
  const product = {
    design_no: '0016', body_code: '', body_name: '', design_code: '0016',
    design_name: 'CRYSTAL FABRIC MEZUZAH CASE', description: '', marketing_description: '',
    category: '', design_type: 'Crystal Fabric', product_type: '', format_code: '000',
    size: '', crystal_type: '', active: false, status: 'concept', is_new: false,
    moq: null, lead_time_weeks: null, delivery_note: '',
    critical_components: [], packing: {}, plating_stock: {}, crystal_components: {},
    gallery: [], videos: [], video_url: '', blog_links: [],
    variants,
  }
  const actual = enumerateRangeSkus(product).map(row => row.sku)
  if (actual.length !== 6 || !ITEM_CODES.every(code => actual.includes(code))) throw new Error('Range SKU builder did not resolve the six exact codes')
  if (variants.some(v => buildRangeSku({ brand_code: v.brand_code, design_no: '0016', format: '000', plating_code: v.plating_code, crystal_code: v.crystal_code }) !== v.sku)) throw new Error('Variant SKU does not match the Range builder')
  return product
}

export function reviewWarnings(colorCodes = []) {
  const warnings = []
  if (!RANGE_CRYSTAL_BRANDS.some(v => v.code === 'B')) warnings.push({ code: 'UNNAMED_BRAND_CODE', message: 'B is used by existing B-series designs but is not in the named crystal-brand list.' })
  if (!RANGE_FORMAT_CODES.some(v => v.code === '000')) warnings.push({ code: 'UNNAMED_FORMAT_CODE', message: '000 is not in the named Range format list.' })
  const gold = RANGE_PLATINGS.find(v => v.code === 'G')
  if (gold?.name === 'Gold') warnings.push({ code: 'PLATING_REVIEW', message: 'G is labelled Gold; reference photos may show other metal tones. Confirm the intended plating; no photo inference was made.' })
  for (const code of ['BK', 'BL', 'C1', 'MT', 'PE', 'VL']) if (!colorCodes.includes(code)) warnings.push({ code: 'COLOUR_CODE_NOT_IN_LIBRARY', colour_code: code, message: `${code} is absent from settings/crystal_colors; no name or taxonomy entry was invented.` })
  return warnings
}

export function usedSkus(product) {
  const out = new Set()
  for (const v of product.variants || []) if (typeof v.sku === 'string' && v.sku) out.add(v.sku.toUpperCase())
  for (const v of enumerateRangeSkus(product)) if (v.sku) out.add(v.sku.toUpperCase())
  return [...out]
}

function root(projectId) { return `projects/${projectId}/databases/(default)/documents` }
async function get(ctx, path) {
  const response = await ctx.fetchImpl(`https://firestore.googleapis.com/v1/${root(ctx.projectId)}/${path}`, { headers: { Authorization: ctx.token } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`READ_FAILED:${path}:${response.status}`)
  return fromDoc(await response.json())
}
async function listB0016Designs(ctx) {
  const response = await ctx.fetchImpl(`https://firestore.googleapis.com/v1/${root(ctx.projectId)}:runQuery`, {
    method: 'POST', headers: { Authorization: ctx.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'range_products' }],
      where: { fieldFilter: { field: { fieldPath: 'design_no' }, op: 'EQUAL', value: encode('0016') } },
      limit: 1000,
    } }),
  })
  if (!response.ok) throw new Error(`READ_FAILED:range_products/B0016:${response.status}`)
  const rows = (await response.json()).filter(row => row.document).map(row => fromDoc(row.document))
  if (rows.length >= 1000) throw new Error('SEARCH_LIMIT:B0016 result is too large to certify')
  return rows
}
async function commit(ctx, writes) {
  return ctx.fetchImpl(`https://firestore.googleapis.com/v1/${root(ctx.projectId)}:commit`, {
    method: 'POST', headers: { Authorization: ctx.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }),
  })
}
async function commitPlan(ctx, records) {
  const base = root(ctx.projectId)
  return commit(ctx, records.map(record => {
    const name = `${base}/${record.path}`
    if (record.action === 'create') return record.path.startsWith('range_mcp_audit/') ? audit(name, record.fields) : create(name, record.fields)
    if (!record.precondition_update_time) throw new Error('PRECONDITION_REQUIRED: updateTime required for existing records')
    return { update: { name, fields: fields(record.fields) }, updateMask: { fieldPaths: Object.keys(record.fields) }, currentDocument: { updateTime: record.precondition_update_time } }
  }))
}

async function listReuseQuotes(ctx) {
  const response = await ctx.fetchImpl(`https://firestore.googleapis.com/v1/${root(ctx.projectId)}/range_components/${B0016_REUSE_ID}/supplier_quotes?pageSize=20`, { headers: { Authorization: ctx.token } })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`READ_FAILED:existing C1 quotes:${response.status}`)
  const result = await response.json()
  if (result.nextPageToken) throw new Error('REUSE_QUOTE_NEEDS_REVIEW: too many existing C1 quotes')
  return result.documents || []
}
const create = (name, data) => ({ update: { name, fields: fields(data) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] })
const audit = (name, data) => ({ update: { name, fields: fields(data) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] })
const simple = (doc, keys) => Object.fromEntries(keys.map(key => [key, doc?.[key] ?? null]))

async function source(ctx) {
  const rootPath = `products/${SOURCE_PRODUCT_ID}`
  const product = await get(ctx, rootPath)
  if (!product || product.active !== false || product.status !== 'concept') throw new Error('SOURCE_PRODUCT_INVALID:Hidden source concept is missing or changed')
  const parts = {}
  for (const [kind, ref] of Object.entries(SOURCE_PARTS)) {
    const component = await get(ctx, `${rootPath}/components/${ref.component_id}`)
    const quote = await get(ctx, `${rootPath}/components/${ref.component_id}/supplier_quotes/${ref.quote_id}`)
    const supplier = await get(ctx, `suppliers/${ref.supplier_id}`)
    if (!component || !quote || !supplier || quote.supplier_id !== ref.supplier_id || quote.unit_cost_currency !== 'RMB' || quote.unit_cost !== (ref.working_cost ?? ref.cost) || quote.moq !== ref.moq || (kind === 'metal' && quote.tooling_sample_cost !== ref.tooling)) throw new Error(`SOURCE_QUOTE_CHANGED:${kind} source quote no longer matches reviewed terms`)
    parts[kind] = { component, quote, supplier }
  }
  return parts
}

function conflictRows(products) {
  return products.flatMap(product => usedSkus(product).filter(code => ITEM_CODES.includes(code)).map(code => ({ item_code: code, range_id: product.id })))
}

async function designPreview(ctx, input) {
  const draft = designDraft(input.item_codes)
  const [products, colours, claims] = await Promise.all([
    listB0016Designs(ctx), get(ctx, 'settings/crystal_colors'),
    Promise.all(ITEM_CODES.map(async item_code => ({ item_code, claim: await get(ctx, `range_sku_claims/${item_code}`) }))),
  ])
  const conflicts = conflictRows(products)
  for (const { item_code, claim } of claims) if (claim && !conflicts.some(row => row.item_code === item_code)) conflicts.push({ item_code, range_id: claim.range_id, reason: 'ORPHANED_OR_MISMATCHED_SKU_CLAIM' })
  const colorCodes = (colours?.colors || []).map(c => c.code)
  const warnings = [...reviewWarnings(colorCodes), { code: 'LEGACY_SKU_AUDIT_REQUIRED', message: 'B0016 query and six claim IDs cannot prove that an older, differently numbered design does not reuse one of these SKUs. A privileged legacy-code audit is required before enabling writes.' }]
  return { draft, products, conflicts, warnings, colour_library_codes: colorCodes }
}

async function getDesign(ctx, range_id) {
  const product = await get(ctx, `range_products/${id(range_id, 'range_id')}`)
  return product && { range_id: product.id, design_no: product.design_no, design_name: product.design_name, active: product.active, status: product.status, item_codes: usedSkus(product), critical_components: product.critical_components || [] }
}

async function completeDesignRetry(ctx, ids, request_id, existing) {
  if (!existing || existing.mcp_request_hash !== ids.hash || existing.mcp_request_id !== request_id) return false
  const [claims, oldAudit] = await Promise.all([
    Promise.all(ITEM_CODES.map(code => get(ctx, `range_sku_claims/${code}`))),
    get(ctx, `range_mcp_audit/${ids.audit_id}`),
  ])
  return Boolean(oldAudit && oldAudit.range_id === ids.range_id && oldAudit.request_hash === ids.hash
    && ITEM_CODES.every((code, index) => claims[index]?.item_code === code
      && claims[index]?.range_id === ids.range_id && usedSkus(existing).includes(code)))
}

async function designOperation(op, input, ctx) {
  exactCodes(input.item_codes)
  let ids, request_id
  if (op === 'create_mezuzah_range_design') {
    request_id = requestId(input.request_id)
    if (!Array.isArray(input.acknowledge_warnings) || input.acknowledge_warnings.some(code => typeof code !== 'string')) throw new Error('acknowledge_warnings must be a list of review codes')
    ids = await identity('range_design', request_id, { item_codes: ITEM_CODES, acknowledge_warnings: [...new Set(input.acknowledge_warnings)].sort() })
    const existing = await get(ctx, `range_products/${ids.range_id}`)
    if (existing) {
      if (existing.mcp_request_hash !== ids.hash || existing.mcp_request_id !== request_id) return fail('DUPLICATE_REQUEST', 'UUID was already used with different content', 409)
      if (!await completeDesignRetry(ctx, ids, request_id, existing)) {
        return fail('INCOMPLETE_PRIOR_REQUEST', 'Existing design, six SKU claims and audit do not agree; inspect before retrying', 409)
      }
      return json({ ok: true, created: false, already_exists: true, range_id: ids.range_id, edit_url: `${ctx.origin}/range/${ids.range_id}`, item_codes: ITEM_CODES, audit_ref: `range_mcp_audit/${ids.audit_id}` })
    }
  }
  const preview = await designPreview(ctx, input)
  const { draft, conflicts, warnings } = preview
  if (op === 'prepare_mezuzah_range_design') return json({
    ok: true, dry_run: true, will_write: false, conflicts, warnings,
    blocked: conflicts.length > 0 || warnings.length > 0,
    proposed: {
      records: [
        { path: 'range_products/{deterministic_request_id}', fields: draft },
        ...ITEM_CODES.map(item_code => ({ path: `range_sku_claims/${item_code}`, fields: { item_code, range_id: '{deterministic_request_id}', service_principal: RANGE_SERVICE_UID } })),
        { path: 'range_mcp_audit/{deterministic_audit_id}', fields: { action: 'create_mezuzah_range_design', service_principal: RANGE_SERVICE_UID, requested_by: 'unknown', source_product_id: SOURCE_PRODUCT_ID } },
      ],
      item_codes: ITEM_CODES, source_provenance: `products/${SOURCE_PRODUCT_ID} (audit only; no price transfer)`,
    },
  })
  if (input.dry_run !== false || input.approved !== true) return fail('APPROVAL_REQUIRED', 'Live create requires dry_run:false and approved:true after review of the exact preview', 409)
  if (!ctx.writesEnabled) return fail('WRITES_DISABLED', 'Figurine MCP writes are disabled until owner-approved deployment/configuration', 403)
  if (conflicts.length) return fail('DUPLICATE_ITEM_CODE', `Existing Range item code conflict: ${conflicts.map(x => x.item_code).join(', ')}`, 409)
  if (!ctx.legacyCodeAuditCertified) return fail('LEGACY_SKU_AUDIT_REQUIRED', 'A separately authorized legacy SKU audit must be certified before live create', 409)
  const acknowledged = input.acknowledge_warnings
  const required = [...new Set(warnings.map(w => w.code))]
  if (!Array.isArray(acknowledged) || required.some(code => !acknowledged.includes(code)) || acknowledged.some(code => !required.includes(code))) return fail('REVIEW_REQUIRED', `Acknowledge exactly these warning codes after owner review: ${required.join(', ')}`, 409)
  const name = `${root(ctx.projectId)}/range_products/${ids.range_id}`
  const auditName = `${root(ctx.projectId)}/range_mcp_audit/${ids.audit_id}`
  const writes = [create(name, { ...draft, mcp_creator_uid: RANGE_SERVICE_UID, mcp_request_id: request_id, mcp_request_hash: ids.hash }), audit(auditName, { action: 'create_mezuzah_range_design', service_principal: RANGE_SERVICE_UID, requested_by: 'unknown', request_id, request_hash: ids.hash, range_id: ids.range_id, source_product_id: SOURCE_PRODUCT_ID })]
  for (const code of ITEM_CODES) writes.push(create(`${root(ctx.projectId)}/range_sku_claims/${code}`, { item_code: code, range_id: ids.range_id, service_principal: RANGE_SERVICE_UID }))
  const response = await commit(ctx, writes)
  if (!response.ok) {
    const retry = await get(ctx, `range_products/${ids.range_id}`)
    if (await completeDesignRetry(ctx, ids, request_id, retry)) return json({ ok: true, created: false, already_exists: true, range_id: ids.range_id, edit_url: `${ctx.origin}/range/${ids.range_id}`, item_codes: ITEM_CODES, audit_ref: `range_mcp_audit/${ids.audit_id}` })
    return fail(response.status === 403 ? 'PERMISSION_DENIED' : 'ATOMIC_WRITE_FAILED', 'No design or code claim was created; review permissions/conflicts and retry with the same UUID', response.status === 403 ? 403 : 409)
  }
  return json({ ok: true, created: true, already_exists: false, range_id: ids.range_id, edit_url: `${ctx.origin}/range/${ids.range_id}`, item_codes: ITEM_CODES, audit_ref: `range_mcp_audit/${ids.audit_id}` }, 201)
}

async function componentOperation(op, input, ctx) {
  if (op === 'create_mezuzah_range_components' && (input.metal_component_code === 'FM-B0016BY00-G' || /^P-CF003-/.test(input.fabric_component_code || '')))
    return fail('COLOUR_BOM_REVIEW_REQUIRED', 'Use prepare_mezuzah_colour_bom. The legacy two-component create cannot represent six colour-specific panels; no write is allowed.', 409)
  const range_id = id(input.range_id, 'range_id')
  if (!/^mcp_range_[a-f0-9]{32}$/.test(range_id)) return fail('INVALID_RANGE_ID', 'Only a Range design created by this B0016 workflow is supported')
  const range = await get(ctx, `range_products/${range_id}`)
  if (!range) return fail('RANGE_NOT_FOUND', 'Range design does not exist', 404)
  if (range.mcp_creator_uid !== RANGE_SERVICE_UID || range.active !== false || range.status !== 'concept' || range.design_no !== '0016' || range.format_code !== '000' || !ITEM_CODES.every(code => usedSkus(range).includes(code))) return fail('RANGE_NOT_B0016', 'Range design is not the expected MCP-created hidden B0016 concept', 409)
  const metal_code = input.metal_component_code ? componentCode(input.metal_component_code, 'metal_component_code') : null
  const fabric_code = input.fabric_component_code ? componentCode(input.fabric_component_code, 'fabric_component_code') : null
  let ids, request_id
  if (op === 'create_mezuzah_range_components') {
    request_id = requestId(input.request_id)
    ids = await identity('range_components', request_id, { range_id, metal_code, fabric_code })
    const oldMetal = await get(ctx, `range_components/${ids.metal_id}`)
    const oldFabric = await get(ctx, `range_components/${ids.fabric_id}`)
    if (oldMetal || oldFabric) {
      if (oldMetal?.mcp_request_hash !== ids.hash || oldFabric?.mcp_request_hash !== ids.hash) return fail('DUPLICATE_REQUEST', 'UUID was already used with different content or partial records require review', 409)
      const [oldMetalQuote, oldFabricQuote, oldAudit] = await Promise.all([
        get(ctx, `range_components/${ids.metal_id}/supplier_quotes/${ids.metal_quote_id}`),
        get(ctx, `range_components/${ids.fabric_id}/supplier_quotes/${ids.fabric_quote_id}`),
        get(ctx, `range_mcp_audit/${ids.audit_id}`),
      ])
      const linked = range.critical_components || []
      if (!oldMetalQuote || !oldFabricQuote || !oldAudit
        || oldMetal.mcp_range_id !== range_id || oldFabric.mcp_range_id !== range_id
        || oldMetal.preferred_quote_id !== ids.metal_quote_id || oldFabric.preferred_quote_id !== ids.fabric_quote_id
        || oldMetalQuote.mcp_range_id !== range_id || oldFabricQuote.mcp_range_id !== range_id
        || oldMetalQuote.mcp_request_hash !== ids.hash || oldFabricQuote.mcp_request_hash !== ids.hash
        || oldAudit.range_id !== range_id || oldAudit.request_hash !== ids.hash
        || !linked.some(ref => ref.id === ids.metal_id && ref.code === oldMetal.code)
        || !linked.some(ref => ref.id === ids.fabric_id && ref.code === oldFabric.code)) {
        return fail('INCOMPLETE_PRIOR_REQUEST', 'Prior component, quote, BOM link and audit records disagree; inspect before retrying', 409)
      }
      return json({ ok: true, created: false, already_exists: true, range_id, component_ids: [ids.metal_id, ids.fabric_id], quote_ids: [ids.metal_quote_id, ids.fabric_quote_id], audit_ref: `range_mcp_audit/${ids.audit_id}` })
    }
  }
  const parts = await source(ctx)
  const warnings = []
  if (!metal_code || !fabric_code) warnings.push({ code: 'COMPONENT_CODES_REQUIRED', message: 'Both range component/ERP codes require owner review; none was invented.' })
  if ((range.critical_components || []).length) warnings.push({ code: 'BOM_NOT_EMPTY', message: 'Range design already has linked components; automatic linking is blocked.' })
  if (metal_code && fabric_code && metal_code === fabric_code) return fail('DUPLICATE_COMPONENT_CODE', 'Metal and fabric components must have different codes', 409)
  const duplicate = []
  warnings.push({ code: 'LEGACY_COMPONENT_CODE_AUDIT_REQUIRED', message: 'The scoped service cannot scan unrelated supplier-cost records. An authorized staff audit must clear both proposed component codes before live create is enabled.' })
  const proposed = {
    range_link: { range_id, field: 'critical_components', refs: ['metal', 'fabric'].map(kind => ({ kind, qty_per_unit: 1, all_variants: true })) },
    metal: { code: metal_code, supplier_id: SOURCE_PARTS.metal.supplier_id, unit_cost: 11.30, currency: 'RMB', moq: 500, one_time_sample_mould: 2912, screws_included: false, source_quote: `products/${SOURCE_PRODUCT_ID}/components/${SOURCE_PARTS.metal.component_id}/supplier_quotes/${SOURCE_PARTS.metal.quote_id}` },
    fabric: { code: fabric_code, supplier_id: SOURCE_PARTS.fabric.supplier_id, source_unit_cost: 8.10, working_unit_cost: 9.00, currency: 'RMB', moq_per_colour: 100, one_time_sample_mould: 0, source_quote: `products/${SOURCE_PRODUCT_ID}/components/${SOURCE_PARTS.fabric.component_id}/supplier_quotes/${SOURCE_PARTS.fabric.quote_id}` },
  }
  if (op === 'prepare_mezuzah_range_components') return json({
    ok: true, dry_run: true, will_write: false,
    blocked: Boolean(warnings.length || duplicate.length || (range.critical_components || []).length),
    warnings, conflicts: duplicate, source_verified: true,
    proposed: { ...proposed, records: [
      { path: `range_products/${range_id}`, action: 'update_only_critical_components', fields: ['critical_components'] },
      { path: 'range_components/{deterministic_metal_id}', fields: ['code', 'name', 'supplierId', 'unit_cost', 'unit_cost_currency', 'tooling_sample_cost', 'preferred_quote_id', 'mcp_range_id', 'mcp_request_id', 'mcp_request_hash'] },
      { path: 'range_components/{deterministic_metal_id}/supplier_quotes/{deterministic_quote_id}', fields: ['supplier_id', 'unit_cost', 'moq', 'tooling_sample_cost', 'source_provenance', 'notes'] },
      { path: 'range_components/{deterministic_fabric_id}', fields: ['code', 'name', 'supplierId', 'unit_cost', 'unit_cost_currency', 'preferred_quote_id', 'mcp_range_id', 'mcp_request_id', 'mcp_request_hash'] },
      { path: 'range_components/{deterministic_fabric_id}/supplier_quotes/{deterministic_quote_id}', fields: ['supplier_id', 'source_unit_cost', 'unit_cost', 'moq', 'source_provenance', 'notes'] },
      { path: 'range_mcp_audit/{deterministic_audit_id}', fields: ['action', 'service_principal', 'requested_by', 'source_product_id', 'component_ids', 'quote_ids'] },
    ] },
  })
  if (input.dry_run !== false || input.approved !== true) return fail('APPROVAL_REQUIRED', 'Live component linking requires dry_run:false and approved:true after review', 409)
  if (!ctx.writesEnabled) return fail('WRITES_DISABLED', 'Figurine MCP writes are disabled until owner-approved deployment/configuration', 403)
  if (!metal_code || !fabric_code || duplicate.length) return fail('REVIEW_REQUIRED', 'Component codes are missing or already used; resolve before creating records', 409)
  if (!ctx.legacyCodeAuditCertified) return fail('LEGACY_COMPONENT_CODE_AUDIT_REQUIRED', 'A separately authorized legacy component-code audit must be certified before live create', 409)
  if ((range.critical_components || []).length) return fail('BOM_NOT_EMPTY', 'Range design already has components; review manually before linking', 409)
  const base = root(ctx.projectId)
  const refs = [
    { id: ids.metal_id, code: metal_code, qty_per_unit: 1, plating_code: '', all_variants: true },
    { id: ids.fabric_id, code: fabric_code, qty_per_unit: 1, plating_code: '', all_variants: true },
  ]
  const component = (name, code, label, category, supplier, cost, tooling, quoteId) => create(name, {
    code, name: label, category, plating_code: '', supplierId: supplier.id,
    supplierName: supplier.name || supplier.name_cn || '', notes: '', images: [],
    unit_cost: cost, unit_cost_currency: 'RMB', tooling_sample_cost: tooling,
    tooling_sample_cost_currency: 'RMB', volume_tiers: [], preferred_quote_id: quoteId,
    preferred_supplier_name: supplier.name || supplier.name_cn || '',
    mcp_creator_uid: RANGE_SERVICE_UID, mcp_range_id: range_id, mcp_request_id: request_id, mcp_request_hash: ids.hash,
  })
  const quote = (name, supplier, cost, moq, tooling, sourcePart, extra = {}) => create(name, {
    supplier_id: supplier.id, supplier_name: supplier.name || supplier.name_cn || '',
    unit_cost: cost, unit_cost_currency: 'RMB', moq, tooling_sample_cost: tooling,
    tooling_sample_cost_currency: 'RMB', is_preferred: true, volume_tiers: [], attachments: [],
    notes: sourcePart === 'metal' ? 'Feihong metal case only. M3 screws quoted separately, excluded. One-time sample/mould fees recorded on this component only.' : 'Ryan crystal fabric panel only. RMB 8.10 source quotation; RMB 9.00 owner-approved conservative working cost. MOQ 100 per colour. Assembly and packaging excluded.',
    source_provenance: { product_id: SOURCE_PRODUCT_ID, component_id: SOURCE_PARTS[sourcePart].component_id, quote_id: SOURCE_PARTS[sourcePart].quote_id },
    ...extra, mcp_creator_uid: RANGE_SERVICE_UID, mcp_range_id: range_id, mcp_request_id: request_id, mcp_request_hash: ids.hash,
  })
  const writes = [
    { update: { name: `${base}/range_products/${range_id}`, fields: fields({ critical_components: refs }) }, updateMask: { fieldPaths: ['critical_components'] }, currentDocument: { updateTime: range.updateTime } },
    component(`${base}/range_components/${ids.metal_id}`, metal_code, 'Mezuzah Metal Case', 'Metal Part', parts.metal.supplier, 11.30, 2912, ids.metal_quote_id),
    component(`${base}/range_components/${ids.fabric_id}`, fabric_code, 'Crystal Fabric Mezuzah Panel', '', parts.fabric.supplier, 9.00, null, ids.fabric_quote_id),
    quote(`${base}/range_components/${ids.metal_id}/supplier_quotes/${ids.metal_quote_id}`, parts.metal.supplier, 11.30, 500, 2912, 'metal'),
    quote(`${base}/range_components/${ids.fabric_id}/supplier_quotes/${ids.fabric_quote_id}`, parts.fabric.supplier, 9.00, 100, null, 'fabric', { source_unit_cost: 8.10, source_unit_cost_currency: 'RMB', cost_basis: 'owner_conservative' }),
    audit(`${base}/range_mcp_audit/${ids.audit_id}`, { action: 'create_mezuzah_range_components', service_principal: RANGE_SERVICE_UID, requested_by: 'unknown', request_id, request_hash: ids.hash, range_id, source_product_id: SOURCE_PRODUCT_ID, component_ids: [ids.metal_id, ids.fabric_id], quote_ids: [ids.metal_quote_id, ids.fabric_quote_id] }),
  ]
  const response = await commit(ctx, writes)
  if (!response.ok) return fail(response.status === 403 ? 'PERMISSION_DENIED' : 'ATOMIC_WRITE_FAILED', 'No components, quotes or BOM link were saved; retry with the same UUID after review', response.status === 403 ? 403 : 409)
  return json({ ok: true, created: true, already_exists: false, range_id, component_ids: [ids.metal_id, ids.fabric_id], quote_ids: [ids.metal_quote_id, ids.fabric_quote_id], audit_ref: `range_mcp_audit/${ids.audit_id}` }, 201)
}

export async function handleMcpFigurineRange(req, { authorize, fetchImpl = fetch, projectId, writesEnabled = false, legacyCodeAuditCertified = false }) {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST required', 405)
  const auth = await authorize(req)
  if (!auth.ok) return auth.response || fail('PERMISSION_DENIED', 'Service identity required', 403)
  if (auth.uid !== RANGE_SERVICE_UID || auth.role !== 'staff') return fail('PERMISSION_DENIED', 'Dedicated Figurine-range service identity required', 403)
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail('INVALID_CONTENT_TYPE', 'application/json required', 415)
  if (!projectId) return fail('NOT_CONFIGURED', 'Firestore project is not configured', 500)
  let body
  try { body = await readLimitedJson(req) } catch (error) { return fail('INVALID_REQUEST', error.message) }
  if (!body || !OPS.has(body.op) || Object.keys(body).some(key => key !== 'op' && key !== 'input')) return fail('INVALID_OPERATION', 'Unsupported Figurine-range operation')
  const input = body.input || {}
  try {
    only(input, ALLOWED[body.op])
    bool(input.dry_run, 'dry_run')
    bool(input.approved, 'approved')
    if (body.op.startsWith('prepare_') && input.dry_run !== true) throw new Error('Preparation requires dry_run:true')
    if (WRITE_OPS.has(body.op) && input.dry_run !== false && input.dry_run !== undefined) throw new Error('dry_run must be false for an approved create')
    const ctx = { fetchImpl, projectId, token: req.headers.get('authorization'), origin: new URL(req.url).origin, writesEnabled, legacyCodeAuditCertified }
    const colourApi = { requestId, source, get, designPreview, listReuseQuotes, identity, id, usedSkus, ITEM_CODES, RANGE_SERVICE_UID, SOURCE_PRODUCT_ID, SOURCE_PARTS, commitPlan }
    if (body.op === 'prepare_mezuzah_colour_bom') return json(await prepareB0016ColourBom(input, ctx, colourApi))
    if (body.op === 'create_mezuzah_colour_bom') return json(await createB0016ColourBom(input, ctx, colourApi))
    if (body.op === 'search_range_designs') {
      const products = await listB0016Designs(ctx)
      const query = String(input.query || '').trim().toLowerCase()
      const item = input.item_code ? String(input.item_code).trim().toUpperCase() : ''
      const limit = input.limit == null ? 20 : Number(input.limit)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || query.length > 80 || (item && !/^[A-Z0-9-]{3,80}$/.test(item))) throw new Error('Invalid search or limit')
      const matches = products.filter(p => (!query || `${p.design_name || ''} ${p.design_no || ''} ${p.design_code || ''}`.toLowerCase().includes(query)) && (!item || usedSkus(p).includes(item)))
      return json({ ok: true, matches: matches.slice(0, limit).map(p => simple({ range_id: p.id, design_name: p.design_name, status: p.status, active: p.active, item_codes: usedSkus(p) }, ['range_id', 'design_name', 'status', 'active', 'item_codes'])), count: matches.length, truncated: matches.length > limit })
    }
    if (body.op === 'get_range_design') { const result = await getDesign(ctx, input.range_id); return result ? json({ ok: true, design: result }) : fail('RANGE_NOT_FOUND', 'Range design not found', 404) }
    if (body.op.endsWith('_range_design')) return await designOperation(body.op, input, ctx)
    return await componentOperation(body.op, input, ctx)
  } catch (error) {
    const code = String(error.message).split(':')[0]
    return fail(['READ_FAILED', 'SEARCH_LIMIT', 'SOURCE_PRODUCT_INVALID', 'SOURCE_QUOTE_CHANGED', 'SOURCE_SUPPLIER_INVALID', 'REUSE_COMPONENT_CHANGED', 'REUSE_COMPONENT_NEEDS_REVIEW', 'REUSE_QUOTE_NEEDS_REVIEW', 'RANGE_NOT_B0016', 'BOM_NOT_EMPTY', 'APPROVAL_REQUIRED', 'WRITES_DISABLED', 'LEGACY_COMPONENT_CODE_AUDIT_REQUIRED', 'INVALID_RANGE_ID', 'PREVIEW_REQUIRED', 'REVIEW_REQUIRED', 'PREVIEW_MISMATCH', 'DUPLICATE_REQUEST', 'INCOMPLETE_PRIOR_REQUEST', 'DUPLICATE_ITEM_CODE', 'ATOMIC_WRITE_UNCONFIRMED', 'ATOMIC_WRITE_FAILED', 'PERMISSION_DENIED', 'WRITE_VERIFICATION_FAILED', 'OWNER_PLAN_APPROVAL_REQUIRED'].includes(code) ? code : 'INVALID_REQUEST', error.message, code === 'READ_FAILED' ? 502 : ['WRITES_DISABLED', 'PERMISSION_DENIED'].includes(code) ? 403 : 400)
  }
}
