import { readLimitedJson } from './corpGiftDraft.js'

const SERVICE_UID = 'mcp-product-writer-service'
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNITS = new Set(['pcs', 'set', 'pair', 'kg', 'g', 'm', 'box'])
const CURRENCIES = new Set(['RMB', 'HKD', 'USD', 'EUR'])
const WRITE_FIELDS = new Set(['product_id', 'supplier_id', 'component_name', 'component_spec', 'component_unit', 'qty_per_product', 'unit_cost', 'unit_cost_currency', 'moq', 'source_notes', 'request_id', 'dry_run'])
const SEARCH_FIELDS = new Set(['query', 'limit'])
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (code, message, status) => json({ ok: false, error: { code, message } }, status)
const str = value => ({ stringValue: value })
const int = value => ({ integerValue: String(value) })
const num = value => ({ doubleValue: value })

function text(value, key, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${key} must be nonempty text of at most ${max} characters`)
  return value.trim()
}
function only(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object')
  const unknown = Object.keys(input).find(key => !fields.has(key))
  if (unknown) throw new Error(`Unsupported field: ${unknown}`)
}
function documentId(value, key) {
  const id = text(value, key, 128)
  if (!ID_RE.test(id)) throw new Error(`${key} must be an existing document ID, not a path`)
  return id
}

export function validateSupplyWrite(input) {
  only(input, WRITE_FIELDS)
  const product_id = documentId(input.product_id, 'product_id')
  if (!/^mcp_[a-f0-9]{40}$/.test(product_id)) throw new Error('product_id must identify an existing MCP concept product')
  const supplier_id = documentId(input.supplier_id, 'supplier_id')
  const request_id = text(input.request_id, 'request_id', 36).toLowerCase()
  if (!UUID_RE.test(request_id)) throw new Error('request_id must be a UUID')
  const component_unit = text(input.component_unit, 'component_unit', 12)
  if (!UNITS.has(component_unit)) throw new Error('component_unit is not an OC component unit')
  const qty_per_product = input.qty_per_product
  if (!Number.isSafeInteger(qty_per_product) || qty_per_product < 1 || qty_per_product > 1000) throw new Error('qty_per_product must be an integer from 1 to 1000')
  const unit_cost = input.unit_cost
  if (typeof unit_cost !== 'number' || !Number.isFinite(unit_cost) || unit_cost < 0.0001 || unit_cost > 10000000 || Math.abs(unit_cost * 10000 - Math.round(unit_cost * 10000)) > 0.000001) throw new Error('unit_cost must be 0.0001–10000000 with at most four decimals')
  const moq = input.moq
  if (!Number.isSafeInteger(moq) || moq < 1 || moq > 10000000) throw new Error('moq must be a positive integer at most 10000000')
  const suppliedCurrency = text(input.unit_cost_currency, 'unit_cost_currency', 3).toUpperCase()
  const unit_cost_currency = suppliedCurrency === 'CNY' ? 'RMB' : suppliedCurrency
  if (!CURRENCIES.has(unit_cost_currency)) throw new Error('unit_cost_currency must be RMB/CNY, HKD, USD, or EUR')
  if (input.dry_run !== undefined && typeof input.dry_run !== 'boolean') throw new Error('dry_run must be boolean')
  return {
    product_id, supplier_id, component_name: text(input.component_name, 'component_name', 160),
    component_spec: text(input.component_spec, 'component_spec', 4000), component_unit, qty_per_product,
    unit_cost, unit_cost_currency, moq, source_notes: text(input.source_notes, 'source_notes', 4000),
    request_id, dry_run: input.dry_run !== false,
  }
}

export function validateSupplierSearch(input) {
  only(input, SEARCH_FIELDS)
  const query = text(input.query, 'query', 80).toLocaleLowerCase()
  if (query.length < 2) throw new Error('query must contain at least two characters')
  const limit = input.limit ?? 8
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('limit must be from 1 to 10')
  return { query, limit }
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function supplyIdentity(uid, input) {
  const { request_id, dry_run, ...content } = input
  const key = await sha256(`${uid}\n${content.product_id}\n${request_id}`)
  return {
    componentId: `mcp_${key.slice(0, 32)}`,
    quoteId: `mcp_${key.slice(32)}`,
    auditId: `mcp_supply_${key}`,
    fingerprint: await sha256(JSON.stringify(content)),
  }
}

function value(v) {
  if (!v) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, value(x)]))
  return null
}
const field = (doc, key) => value(doc?.fields?.[key])
function supplierName(supplier) {
  const english = field(supplier, 'name')
  const chinese = field(supplier, 'name_cn')
  return english && chinese ? `${english} (${chinese})` : english || chinese || ''
}

function names(projectId, input, ids) {
  const root = `projects/${projectId}/databases/(default)/documents`
  const component = `${root}/products/${input.product_id}/components/${ids.componentId}`
  return { product: `${root}/products/${input.product_id}`, supplier: `${root}/suppliers/${input.supplier_id}`, component, quote: `${component}/supplier_quotes/${ids.quoteId}`, audit: `${root}/audit_logs/${ids.auditId}`, root }
}
function write(name, fields) {
  return { update: { name, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
}
export function supplyCommit(paths, input, ids, supplier_name, uid, preconditions) {
  const marker = { mcp_creator_uid: str(uid), mcp_request_hash: str(ids.fingerprint) }
  return { writes: [
    { verify: paths.product, currentDocument: { updateTime: preconditions.product } },
    { verify: paths.supplier, currentDocument: { updateTime: preconditions.supplier } },
    write(paths.component, {
      name: str(input.component_name), spec: str(input.component_spec), unit: str(input.component_unit),
      qty_per_product: int(input.qty_per_product), sort_order: int(0), ...marker,
    }),
    write(paths.quote, {
      supplier_id: str(input.supplier_id), supplier_name: str(supplier_name),
      unit_cost: num(input.unit_cost), unit_cost_currency: str(input.unit_cost_currency),
      moq: int(input.moq), notes: str(input.source_notes), is_preferred: { booleanValue: true },
      attachments: { arrayValue: { values: [] } }, volume_tiers: { arrayValue: { values: [] } }, ...marker,
    }),
    { update: { name: paths.audit, fields: {
      kind: str('mcp_supplier_quote'), action: str('add_corp_gift_component_with_supplier_quote'),
      service_principal: str(uid), requested_by: str('unknown'), product_id: str(input.product_id),
      component_id: str(ids.componentId), quote_id: str(ids.quoteId), supplier_id: str(input.supplier_id),
      request_id: str(input.request_id), request_hash: str(ids.fingerprint),
    } }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] },
  ] }
}

async function load(fetchImpl, path, headers) {
  return fetchImpl(`https://firestore.googleapis.com/v1/${path}`, { headers })
}
async function authorizeService(req, authorize) {
  const product = await authorize(req, 'products')
  if (!product.ok) return { error: fail('PERMISSION_DENIED', 'Products access is required for this service', product.response?.status === 401 ? 401 : 403) }
  const supply = await authorize(req, 'supply')
  if (!supply.ok) return { error: fail('PERMISSION_DENIED', 'Supply access is required for this service', supply.response?.status === 401 ? 401 : 403) }
  if (product.uid !== SERVICE_UID || supply.uid !== SERVICE_UID || product.role !== 'staff' || supply.role !== 'staff') {
    return { error: fail('PERMISSION_DENIED', 'The product-writer service identity is required', 403) }
  }
  return { uid: product.uid }
}

export async function handleMcpProductSupply(req, { authorize, fetchImpl = fetch, projectId }) {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST is required', 405)
  const auth = await authorizeService(req, authorize)
  if (auth.error) return auth.error
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail('INVALID_CONTENT_TYPE', 'Content-Type must be application/json', 415)
  if (!projectId) return fail('NOT_CONFIGURED', 'Firestore project is not configured', 500)
  let body
  try { body = await readLimitedJson(req) }
  catch (error) { return fail('INVALID_REQUEST', error.message, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['search_suppliers', 'add_corp_gift_component_with_supplier_quote'].includes(body.op)) return fail('INVALID_OPERATION', 'Use search_suppliers or add_corp_gift_component_with_supplier_quote', 400)
  if (Object.keys(body).some(key => key !== 'op' && key !== 'input')) return fail('INVALID_REQUEST', 'Only op and input are supported', 400)
  return body.op === 'search_suppliers'
    ? searchSuppliers(body.input, { fetchImpl, projectId, token: req.headers.get('authorization') })
    : addComponentWithQuote(body.input, { fetchImpl, projectId, token: req.headers.get('authorization'), uid: auth.uid, origin: new URL(req.url).origin })
}

export async function searchSuppliers(raw, { fetchImpl, projectId, token }) {
  let input
  try { input = validateSupplierSearch(raw) } catch (error) { return fail('INVALID_REQUEST', error.message, 400) }
  const root = `projects/${projectId}/databases/(default)/documents`
  const headers = { Authorization: token }
  const matches = []
  let pageToken = ''
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(`https://firestore.googleapis.com/v1/${root}/suppliers`)
      url.searchParams.set('pageSize', '100')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await fetchImpl(url, { headers })
      if (response.status === 401 || response.status === 403) return fail('PERMISSION_DENIED', 'Supplier lookup was denied', 403)
      if (!response.ok) return fail('SUPPLIER_READ_FAILED', 'Supplier lookup failed; retry later', 502)
      const data = await response.json()
      for (const supplier of data.documents || []) {
        const contacts = field(supplier, 'contacts') || []
        const names = [field(supplier, 'name'), field(supplier, 'name_cn'), field(supplier, 'contact_person'), ...contacts.flatMap(c => [c.name, c.wechat])].filter(Boolean)
        if (!names.some(name => String(name).toLocaleLowerCase().includes(input.query))) continue
        matches.push({ supplier_id: supplier.name.split('/').at(-1), name: field(supplier, 'name'), name_cn: field(supplier, 'name_cn'), category: field(supplier, 'category'), region: [field(supplier, 'city'), field(supplier, 'province')].filter(Boolean).join(', '), contacts: names.slice(2, 5) })
      }
      pageToken = data.nextPageToken || ''
      if (!pageToken) return json({ ok: true, matches: matches.slice(0, input.limit), count: matches.length, truncated: matches.length > input.limit })
    }
    return fail('SEARCH_LIMIT', 'Supplier directory exceeds 1000 records; refine lookup in OC', 409)
  } catch { return fail('SUPPLIER_READ_FAILED', 'Supplier lookup is temporarily unavailable', 502) }
}

export async function addComponentWithQuote(raw, { fetchImpl, projectId, token, uid, origin }) {
  let input
  try { input = validateSupplyWrite(raw) } catch (error) { return fail('INVALID_REQUEST', error.message, 400) }
  const ids = await supplyIdentity(uid, input)
  const paths = names(projectId, input, ids)
  const headers = { Authorization: token, 'Content-Type': 'application/json' }
  const output = { ok: true, product_id: input.product_id, component_id: ids.componentId, quote_id: ids.quoteId, product_url: `${origin}/products/${input.product_id}`, component_url: `${origin}/products/${input.product_id}/components/${ids.componentId}` }
  const checkExisting = async () => {
    const responses = await Promise.all([load(fetchImpl, paths.component, headers), load(fetchImpl, paths.quote, headers)])
    if (responses.every(r => r.status === 404)) return null
    if (responses.some(r => r.status === 401 || r.status === 403)) return { error: fail('PERMISSION_DENIED', 'Component or quote read was denied', 403) }
    if (responses.some(r => r.status >= 500)) return { error: fail('RECORD_READ_FAILED', 'Could not check whether this request was already saved; retry later', 502) }
    if (responses.some(r => !r.ok)) return { error: fail('DUPLICATE_CONFLICT', 'Request ID has incomplete or inaccessible existing records; inspect before retrying', 409) }
    const docs = await Promise.all(responses.map(r => r.json()))
    if (docs.some(doc => field(doc, 'mcp_creator_uid') !== uid || field(doc, 'mcp_request_hash') !== ids.fingerprint)) return { error: fail('DUPLICATE_REQUEST', 'request_id was already used with different content', 409) }
    return { existing: true }
  }
  try {
    // Resolve a completed retry before checking mutable product/supplier state.
    // The original atomic commit may have succeeded before a timeout, and a
    // later status change must not turn that successful request into a failure.
    const previous = await checkExisting()
    if (previous?.error) return previous.error
    if (previous && !input.dry_run) return json({ ...output, created: false, normalized_currency: input.unit_cost_currency })
    const [productRes, supplierRes] = await Promise.all([load(fetchImpl, paths.product, headers), load(fetchImpl, paths.supplier, headers)])
    if (productRes.status === 404) return fail('PRODUCT_NOT_FOUND', 'The product does not exist; check product_id', 404)
    if (supplierRes.status === 404) return fail('SUPPLIER_NOT_FOUND', 'The supplier does not exist; use search_suppliers', 404)
    if ([productRes, supplierRes].some(r => r.status === 401 || r.status === 403)) return fail('PERMISSION_DENIED', 'Product or supplier read was denied', 403)
    if (!productRes.ok || !supplierRes.ok) return fail('RECORD_READ_FAILED', 'Product or supplier could not be verified', 502)
    const [product, supplier] = await Promise.all([productRes.json(), supplierRes.json()])
    if (field(product, 'status') !== 'concept' || field(product, 'active') !== false) return fail('PRODUCT_NOT_CONCEPT', 'Only an inactive Concept product can receive an MCP component', 409)
    const supplier_name = supplierName(supplier)
    if (!supplier_name) return fail('INVALID_SUPPLIER', 'Supplier record has no name', 409)
    if (!product.updateTime || !supplier.updateTime) return fail('RECORD_READ_FAILED', 'Product or supplier version is unavailable; cannot safely commit', 502)
    if (input.dry_run) return json({ ...output, dry_run: true, will_write: false, already_exists: Boolean(previous), audit_preview: { service_principal: uid, requested_by: 'unknown', action: 'add_corp_gift_component_with_supplier_quote', product_id: input.product_id, component_id: ids.componentId, quote_id: ids.quoteId, supplier_id: input.supplier_id }, normalized_currency: input.unit_cost_currency, supplier_name })
    const commit = await fetchImpl(`https://firestore.googleapis.com/v1/${paths.root}:commit`, { method: 'POST', headers, body: JSON.stringify(supplyCommit(paths, input, ids, supplier_name, uid, { product: product.updateTime, supplier: supplier.updateTime })) })
    if (commit.ok) return json({ ...output, created: true, normalized_currency: input.unit_cost_currency }, 201)
    const failure = await commit.json().catch(() => ({}))
    if (commit.status === 409 || ['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(failure.error?.status)) {
      const retry = await checkExisting()
      if (retry?.existing) return json({ ...output, created: false, normalized_currency: input.unit_cost_currency })
      if (retry?.error) return retry.error
      return fail('PRECONDITION_FAILED', 'Product or supplier changed during write; recheck IDs and retry with the same request_id', 409)
    }
    if (commit.status === 401 || commit.status === 403) return fail('PERMISSION_DENIED', 'Component, quote or audit write was denied', 403)
    return fail('WRITE_FAILED', 'Atomic write failed; retry with the same request_id', 502)
  } catch { return fail('SERVICE_UNAVAILABLE', 'Firestore is temporarily unavailable; retry with the same request_id', 502) }
}
