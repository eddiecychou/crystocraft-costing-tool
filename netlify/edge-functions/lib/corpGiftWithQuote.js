import { validateDraft, draftIdentity, commitBody, readLimitedJson } from './corpGiftDraft.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const string = value => ({ stringValue: value })
const integer = value => ({ integerValue: String(value) })
const number = value => ({ doubleValue: value })
const allowed = new Set(['name', 'category', 'description', 'marketing_description', 'assembly_notes', 'product_code', 'request_id', 'component_name', 'component_spec', 'supplier_id', 'unit_cost', 'unit_cost_currency', 'moq', 'production_lead_time_days', 'sampling_lead_time_days', 'tooling_lead_time_days', 'tooling_sample_cost', 'tooling_sample_cost_currency', 'quote_notes'])

function text(value, key, max, required = false) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) throw new Error(`${key} must be a ${required ? 'nonempty ' : ''}string of at most ${max} characters`)
  return value.trim()
}
function numeric(value, key, integerOnly = false, required = false) {
  if (value === undefined && !required) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integerOnly && !Number.isSafeInteger(value))) throw new Error(`${key} must be a nonnegative ${integerOnly ? 'integer' : 'number'}`)
  return value
}

export function validateBundle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object')
  const unknown = Object.keys(input).find(key => !allowed.has(key))
  if (unknown) throw new Error(`Unsupported field: ${unknown}`)
  const product = validateDraft(Object.fromEntries(Object.entries(input).filter(([key]) => !allowed.has(key) || ['name', 'category', 'description', 'marketing_description', 'assembly_notes', 'product_code', 'request_id'].includes(key))))
  const supplier_id = text(input.supplier_id, 'supplier_id', 128, true)
  if (!/^[A-Za-z0-9_-]+$/.test(supplier_id)) throw new Error('supplier_id is invalid')
  const unit_cost_currency = text(input.unit_cost_currency, 'unit_cost_currency', 3, true).toUpperCase()
  if (!/^[A-Z]{3}$/.test(unit_cost_currency)) throw new Error('unit_cost_currency must be a three-letter currency code')
  const tooling_sample_cost_currency = text(input.tooling_sample_cost_currency, 'tooling_sample_cost_currency', 3).toUpperCase()
  if (tooling_sample_cost_currency && !/^[A-Z]{3}$/.test(tooling_sample_cost_currency)) throw new Error('tooling_sample_cost_currency must be a three-letter currency code')
  return {
    product,
    component_name: text(input.component_name, 'component_name', 160, true),
    component_spec: text(input.component_spec, 'component_spec', 4000), supplier_id,
    unit_cost: numeric(input.unit_cost, 'unit_cost', false, true), unit_cost_currency,
    moq: numeric(input.moq, 'moq', true),
    production_lead_time_days: numeric(input.production_lead_time_days, 'production_lead_time_days', true),
    sampling_lead_time_days: numeric(input.sampling_lead_time_days, 'sampling_lead_time_days', true),
    tooling_lead_time_days: numeric(input.tooling_lead_time_days, 'tooling_lead_time_days', true),
    tooling_sample_cost: numeric(input.tooling_sample_cost, 'tooling_sample_cost'), tooling_sample_cost_currency,
    quote_notes: text(input.quote_notes, 'quote_notes', 4000),
  }
}

export async function bundleIdentity(uid, bundle) {
  const { productId } = await draftIdentity(uid, bundle.product)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(bundle)))
  const fingerprint = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { productId, componentId: `mcp_${productId.slice(4, 24)}`, quoteId: `mcp_${productId.slice(24)}`, fingerprint }
}

export function bundleCommit(names, bundle, uid, fingerprint, supplierName) {
  const productWrite = commitBody(names.product, bundle.product, uid, fingerprint).writes[0]
  const marker = { mcp_creator_uid: string(uid), mcp_request_hash: string(fingerprint) }
  const componentFields = {
    name: string(bundle.component_name), spec: string(bundle.component_spec), unit: string('pcs'),
    qty_per_product: integer(1), sort_order: integer(0), ...marker,
  }
  const quoteFields = {
    supplier_id: string(bundle.supplier_id), supplier_name: string(supplierName),
    unit_cost: number(bundle.unit_cost), unit_cost_currency: string(bundle.unit_cost_currency),
    is_preferred: { booleanValue: true }, notes: string(bundle.quote_notes),
    attachments: { arrayValue: { values: [] } }, volume_tiers: { arrayValue: { values: [] } }, ...marker,
  }
  for (const key of ['moq', 'production_lead_time_days', 'sampling_lead_time_days', 'tooling_lead_time_days']) {
    if (bundle[key] !== null) quoteFields[key] = integer(bundle[key])
  }
  if (bundle.tooling_sample_cost !== null) {
    quoteFields.tooling_sample_cost = number(bundle.tooling_sample_cost)
    quoteFields.tooling_sample_cost_currency = string(bundle.tooling_sample_cost_currency || bundle.unit_cost_currency)
  }
  const write = (name, fields) => ({ update: { name, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] })
  return { writes: [productWrite, write(names.component, componentFields), write(names.quote, quoteFields)] }
}

export async function handleCreateCorpGiftWithQuote(req, { authorize, fetchImpl = fetch, projectId }) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const products = await authorize(req, 'products')
  if (!products.ok) return products.response
  const supply = await authorize(req, 'supply')
  if (!supply.ok) return supply.response
  if (supply.uid !== products.uid) return json({ error: 'Authorization mismatch' }, 403)
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Content-Type must be application/json' }, 415)
  if (!projectId) return json({ error: 'Server not configured' }, 500)
  let bundle
  try { bundle = validateBundle(await readLimitedJson(req)) }
  catch (error) { return json({ error: error.message }, 400) }
  const ids = await bundleIdentity(products.uid, bundle)
  const prefix = `projects/${projectId}/databases/(default)/documents`
  const names = {
    product: `${prefix}/products/${ids.productId}`,
    component: `${prefix}/products/${ids.productId}/components/${ids.componentId}`,
    quote: `${prefix}/products/${ids.productId}/components/${ids.componentId}/supplier_quotes/${ids.quoteId}`,
  }
  const headers = { Authorization: req.headers.get('authorization'), 'Content-Type': 'application/json' }
  const get = name => fetchImpl(`https://firestore.googleapis.com/v1/${name}`, { headers })
  const output = {
    product_id: ids.productId, component_id: ids.componentId, quote_id: ids.quoteId,
    name: bundle.product.name, status: 'concept', active: false,
    edit_url: `${new URL(req.url).origin}/products/${ids.productId}/edit`,
  }
  try {
    const supplier = await get(`${prefix}/suppliers/${bundle.supplier_id}`)
    if (supplier.status === 404) return json({ error: 'Supplier not found' }, 404)
    if (supplier.status === 401 || supplier.status === 403) return json({ error: 'Supplier read was denied' }, 403)
    if (!supplier.ok) return json({ error: 'Supplier could not be verified; retry with the same request_id' }, 502)
    const supplierDoc = await supplier.json()
    const englishName = supplierDoc.fields?.name?.stringValue
    const chineseName = supplierDoc.fields?.name_cn?.stringValue
    const supplierName = englishName && chineseName ? `${englishName} (${chineseName})` : englishName
    if (!supplierName) return json({ error: 'Supplier record has no name' }, 409)
    const commit = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
      method: 'POST', headers, body: JSON.stringify(bundleCommit(names, bundle, products.uid, ids.fingerprint, supplierName)),
    })
    if (commit.ok) return json({ ...output, created: true }, 201)
    const failure = await commit.json().catch(() => ({}))
    if (commit.status === 409 || ['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(failure.error?.status)) {
      const existing = await Promise.all([get(names.product), get(names.component), get(names.quote)])
      if (existing.some(item => !item.ok)) return json({ error: 'Could not verify the existing bundle; retry with the same request_id' }, 502)
      const docs = await Promise.all(existing.map(item => item.json()))
      if (docs.some(doc => doc.fields?.mcp_creator_uid?.stringValue !== products.uid || doc.fields?.mcp_request_hash?.stringValue !== ids.fingerprint)) return json({ error: 'request_id was already used for different content' }, 409)
      return json({ ...output, name: docs[0].fields?.name?.stringValue || output.name, status: docs[0].fields?.status?.stringValue || 'concept', active: docs[0].fields?.active?.booleanValue === true, created: false }, 200)
    }
    if (commit.status === 401 || commit.status === 403) return json({ error: 'Product or quote write was denied' }, 403)
    return json({ error: 'Bundle could not be saved; retry with the same request_id' }, 502)
  } catch {
    return json({ error: 'Firestore is temporarily unavailable; retry with the same request_id' }, 502)
  }
}
