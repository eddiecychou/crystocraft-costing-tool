import { readLimitedJson } from './corpGiftDraft.js'
import { totalUnitCostAtQty, DEFAULT_MARKUP } from '../../../src/pricingCore.js'
import { hkdRateForCostCurrency } from '../../../src/costCurrency.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const VALID_STATUS = new Set(['concept', 'sampled', 'active', 'retired'])
const VALID_INCLUDE = new Set(['components', 'quotes', 'pricing', 'links', 'media'])

function decode(value) {
  if (!value || typeof value !== 'object') return null
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]))
  return null
}
function docData(doc) {
  if (!doc?.name) return null
  return { id: doc.name.split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, decode(v)])) }
}
function compactError(code, message, product_id = undefined) { return { ...(product_id ? { product_id } : {}), code, message } }
function httpsUrl(value) { try { return new URL(value).protocol === 'https:' } catch { return false } }
function displayLabel(value) { return typeof value === 'string' && value.trim() && !/^https?:\/\//i.test(value.trim()) }
function canonicalLink(link) { return { label: link.label.trim(), url: new URL(link.url).href } }
function invalidLink(link) { return !link || !displayLabel(link.label) || !httpsUrl(link.url) }

function base(projectId) { return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents` }
async function readJson(response) { return response.json().catch(() => ({})) }
async function get(fetchImpl, headers, name) {
  let response
  try { response = await fetchImpl(`${baseName(headers.projectId)}/${name}`, { headers }) }
  catch { try { response = await fetchImpl(`${baseName(headers.projectId)}/${name}`, { headers }) } catch { throw new Error('UPSTREAM_READ_FAILED') } }
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Firestore read failed')
  return docData(await readJson(response))
}
function baseName(projectId) { return base(projectId) }
async function list(fetchImpl, headers, path) {
  let response
  try { response = await fetchImpl(`${baseName(headers.projectId)}/${path}?pageSize=100`, { headers }) }
  catch { try { response = await fetchImpl(`${baseName(headers.projectId)}/${path}?pageSize=100`, { headers }) } catch { throw new Error('UPSTREAM_READ_FAILED') } }
  if (!response.ok) throw new Error('Firestore list failed')
  return (await readJson(response)).documents?.map(docData) || []
}

async function productDetail(fetchImpl, headers, productId, include = []) {
  const product = await get(fetchImpl, headers, `products/${productId}`)
  if (!product) return null
  const wantsComponents = include.includes('components') || include.includes('quotes') || include.includes('pricing')
  const components = wantsComponents ? await list(fetchImpl, headers, `products/${productId}/components`) : []
  if (include.includes('quotes') || include.includes('pricing')) {
    for (const component of components) {
      const quotes = await list(fetchImpl, headers, `products/${productId}/components/${component.id}/supplier_quotes`)
      component.quotes = quotes
      component.preferred_quote = quotes.find(q => q.is_preferred) || null
    }
  }
  const tiers = include.includes('pricing') ? await list(fetchImpl, headers, `products/${productId}/pricing_tiers`) : []
  return { product, components, tiers }
}

function readiness(detail, rates) {
  const components = detail.components || []
  const missingPreferred = components.filter(c => !c.preferred_quote).map(c => c.id)
  const missingCost = components.filter(c => c.preferred_quote && c.preferred_quote.unit_cost == null).map(c => c.id)
  const unavailableCurrencies = [...new Set(components.flatMap(c => {
    const q = c.preferred_quote
    if (!q) return []
    return [q.unit_cost_currency, q.tooling_sample_cost ? q.tooling_sample_cost_currency : null]
      .filter(currency => currency && hkdRateForCostCurrency(currency, rates) == null)
  }))]
  const maxMoq = Math.max(0, ...components.map(c => Number(c.preferred_quote?.moq) || 0))
  const missingLeadTime = components.filter(c => c.preferred_quote && !Number.isFinite(Number(c.preferred_quote.production_lead_time_days))).map(c => c.id)
  return {
    preferred_supplier_quotes_present: missingPreferred.length === 0 && components.length > 0,
    components_without_cost: missingCost,
    components_without_preferred_quote: missingPreferred,
    components_without_production_lead_time: missingLeadTime,
    preferred_supplier_moq: maxMoq,
    unavailable_currencies: unavailableCurrencies,
    pricing_tiers: detail.tiers.map(t => ({ quantity: t.quantity, production_lead_time_days: t.production_lead_time_days ?? null })),
    last_price_published_at: detail.product.prices_published_at || null,
    safe_to_publish: components.length > 0 && !missingPreferred.length && !missingCost.length && !missingLeadTime.length && !unavailableCurrencies.length && detail.tiers.length > 0,
  }
}

async function exchangeRates(fetchImpl, headers) {
  return (await get(fetchImpl, headers, 'settings/exchange_rates')) || { HKD: 1 }
}

function requireDryRun(input) {
  if (input?.dry_run !== true) throw new Error('This first MCP release is dry-run only; live catalogue and pricing writes are disabled')
}

export async function handleMcpCatalogue(req, { authorize, fetchImpl = fetch, projectId }) {
  if (req.method !== 'POST') return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError('METHOD_NOT_ALLOWED', 'POST required')] }, 405)
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError('CONTENT_TYPE', 'application/json required')] }, 415)
  let body
  try { body = await readLimitedJson(req) } catch (error) { return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError('INVALID_INPUT', error.message)] }, 400) }
  const op = body?.op
  const input = body?.input || {}
  const need = op === 'search_products' ? ['products'] : ['products', 'supply', 'pricing']
  for (const module of need) {
    const auth = await authorize(req, module)
    if (!auth.ok) return auth.response
  }
  if (!projectId) return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError('SERVER_CONFIG', 'Server not configured')] }, 500)
  const headers = { Authorization: req.headers.get('authorization'), projectId }
  try {
    if (op === 'search_products') {
      const all = await list(fetchImpl, headers, 'products')
      const query = String(input.query || '').trim().toLowerCase()
      const rows = all.filter(p => (!query || `${p.name || ''} ${p.product_code || ''}`.toLowerCase().includes(query))
        && (!input.status || p.status === input.status) && (!input.category || p.category === input.category))
        .slice(0, Math.min(Math.max(Number(input.limit) || 20, 1), 50))
        .map(p => ({ product_id: p.id, name: p.name || '', status: p.status || 'concept', active: p.active !== false, category: p.category || '', prices_published_at: p.prices_published_at || null }))
      return json({ ok: true, updated: [], skipped: [], warnings: input.supplier_id ? [compactError('SUPPLIER_FILTER_DEFERRED', 'Supplier filtering is not available in the read-only first release')] : [], errors: [], products: rows })
    }
    if (op === 'get_product' || op === 'get_product_costing_readiness' || op === 'prepare_catalogue_collection') {
      const ids = op === 'prepare_catalogue_collection' ? input.product_ids : [input.product_id]
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) throw new Error('At least one product ID is required')
      const include = op === 'get_product' ? [...new Set(input.include || [])] : ['components', 'quotes', 'pricing']
      if (include.some(item => !VALID_INCLUDE.has(item))) throw new Error('Unsupported include section')
      if (op === 'prepare_catalogue_collection') requireDryRun(input)
      if (op === 'prepare_catalogue_collection' && input.status && !VALID_STATUS.has(input.status)) throw new Error('status must be concept, sampled, active, or retired')
      for (const url of input.youtube_urls || []) if (!httpsUrl(url)) throw new Error('youtube_urls must contain HTTPS URLs')
      const malformedLink = (input.learn_more_links || []).find(invalidLink)
      if (malformedLink) return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError('INVALID_LEARN_MORE_LINK', 'Learn More links require plain display text in label and an HTTPS URL in url')] }, 400)
      const rates = await exchangeRates(fetchImpl, headers)
      const updated = [], skipped = [], warnings = [], errors = []
      for (const productId of ids) {
        const detail = await productDetail(fetchImpl, headers, productId, include)
        if (!detail) { errors.push(compactError('PRODUCT_NOT_FOUND', 'Product does not exist', productId)); continue }
        if (op === 'get_product') { updated.push({ product_id: productId, product: detail.product, components: include.includes('components') ? detail.components : undefined, pricing_tiers: include.includes('pricing') ? detail.tiers : undefined }); continue }
        const checks = readiness(detail, rates)
        if (op === 'get_product_costing_readiness') { updated.push({ product_id: productId, ...checks }); continue }
        const tier = input.pricing_tier
        if (!tier || !Number.isFinite(tier.quantity) || tier.quantity <= 0 || !Number.isFinite(tier.production_lead_time_days) || tier.production_lead_time_days <= 0) {
          errors.push(compactError('INVALID_TIER', 'pricing_tier requires positive quantity and production_lead_time_days', productId)); continue
        }
        const moq = checks.preferred_supplier_moq
        if (moq > tier.quantity) warnings.push(compactError('MOQ_CONFLICT', `Preferred supplier MOQ is ${moq} while requested tier is ${tier.quantity}`, productId))
        const allInCost = checks.safe_to_publish ? totalUnitCostAtQty(detail.components, rates, tier.quantity) : null
        if (!checks.safe_to_publish || allInCost == null) warnings.push(compactError('NOT_READY_TO_PUBLISH', 'Preferred costs, exchange rates, and at least one tier must be complete before publishing', productId))
        const existingTier = detail.tiers.some(old => Number(old.quantity) === Number(tier.quantity))
        if (existingTier) warnings.push(compactError('DUPLICATE_PRICING_TIER', `A pricing tier already exists at quantity ${tier.quantity}`, productId))
        const requestedVideos = [...new Set(input.youtube_urls || [])]
        const existingLinks = detail.product.blog_links || []
        const invalidExistingLinks = existingLinks.filter(invalidLink)
        for (const link of invalidExistingLinks) warnings.push(compactError('INVALID_LEARN_MORE_LINK', 'Existing Learn More link has a non-HTTPS url or URL-shaped label and was not matched or repaired', productId))
        const requestedLinks = [...new Map((input.learn_more_links || []).map(canonicalLink).map(link => [`${link.label}\u0000${link.url}`, link])).values()]
        if (requestedVideos.length !== (input.youtube_urls || []).length) warnings.push(compactError('DUPLICATE_VIDEO_IGNORED', 'Duplicate proposed video URLs were removed from the preview', productId))
        if (requestedLinks.length !== (input.learn_more_links || []).length) warnings.push(compactError('DUPLICATE_LINK_IGNORED', 'Duplicate proposed link URLs were removed from the preview', productId))
        updated.push({ product_id: productId, name: detail.product.name || '', dry_run: true, catalogue: { status: input.status || detail.product.status || 'concept', visible: input.visible_in_catalogue ?? (detail.product.active !== false), videos_to_add: requestedVideos.filter(url => !(detail.product.videos || []).includes(url)), links_to_add: requestedLinks.filter(link => !existingLinks.some(old => !invalidLink(old) && canonicalLink(old).label === link.label && canonicalLink(old).url === link.url)) }, pricing: { tier: { quantity: tier.quantity, lead_time_days: tier.production_lead_time_days, already_exists: existingTier }, all_in_cost_hkd: allInCost, default_price_hkd: allInCost == null ? null : Math.ceil(allInCost * DEFAULT_MARKUP), publish_requested: input.publish_prices === true, publish_enabled: false }, audit_preview: { service_principal: 'mcp-catalogue-pricing-service', requested_by: input.requested_by || 'unknown', action: 'prepare_catalogue_collection', dry_run: true, will_write: false }, readiness: checks })
      }
      return json({ ok: errors.length === 0, updated, skipped, warnings, errors })
    }
    throw new Error('Unsupported MCP operation')
  } catch (error) {
    const code = error.message === 'UPSTREAM_READ_FAILED' ? 'UPSTREAM_READ_FAILED' : 'REQUEST_FAILED'
    return json({ ok: false, updated: [], skipped: [], warnings: [], errors: [compactError(code, code === 'UPSTREAM_READ_FAILED' ? 'Catalogue read service was temporarily unavailable; retry the read.' : error.message)] }, 400)
  }
}
