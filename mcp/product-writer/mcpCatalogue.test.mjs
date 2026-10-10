import test from 'node:test'
import assert from 'node:assert/strict'
import { handleMcpCatalogue } from '../../netlify/edge-functions/lib/mcpCatalogue.js'

const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
const request = (op, input) => new Request('https://portal.crystocraft.com/api/mcp-catalogue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify({ op, input }) })
const authorize = async () => ({ ok: true, uid: 'mcp-catalogue-pricing-service' })
const field = value => typeof value === 'number' ? { doubleValue: value } : typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value }
const doc = (name, fields) => ({ name: `projects/test/databases/(default)/documents/${name}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, field(v)])) })

test('search is compact and requires only products access', async () => {
  const requested = []
  const res = await handleMcpCatalogue(request('search_products', { query: 'glass' }), {
    projectId: 'test', authorize: async (_req, module) => { requested.push(module); return { ok: true, uid: 'writer' } },
    fetchImpl: async () => response({ documents: [doc('products/a', { name: 'Glass', status: 'concept', active: true, category: 'Drinkware' })] }),
  })
  assert.deepEqual(requested, ['products'])
  const data = await res.json()
  assert.equal(data.ok, true); assert.equal(data.products[0].product_id, 'a')
})

test('collection preparation is dry-run only and flags MOQ and duplicate conflicts without writing', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url.includes('settings/exchange_rates')) return response(doc('settings/exchange_rates', { RMB: 1.1653, HKD: 1 }))
    if (url.includes('products/a/components/c/supplier_quotes')) return response({ documents: [doc('products/a/components/c/supplier_quotes/q', { is_preferred: true, unit_cost: 35, unit_cost_currency: 'RMB', moq: 500 })] })
    if (url.includes('products/a/components')) return response({ documents: [doc('products/a/components/c', { name: 'Glass', qty_per_product: 1 })] })
    if (url.includes('products/a/pricing_tiers')) return response({ documents: [doc('products/a/pricing_tiers/t', { quantity: 100, production_lead_time_days: 30 })] })
    if (url.includes('/products/a')) return response(doc('products/a', { name: 'Crystal Glass', status: 'concept', active: false }))
    throw new Error(url)
  }
  const res = await handleMcpCatalogue(request('prepare_catalogue_collection', { product_ids: ['a'], status: 'active', visible_in_catalogue: true, youtube_urls: ['https://youtu.be/example', 'https://youtu.be/example'], learn_more_links: [{ label: 'Collection', url: 'https://www.crystocraft.com/product/glasses/' }, { label: 'Again', url: 'https://www.crystocraft.com/product/glasses/' }], pricing_tier: { quantity: 100, production_lead_time_days: 30 }, publish_prices: true, dry_run: true }), { projectId: 'test', authorize, fetchImpl })
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.updated[0].pricing.all_in_cost_hkd, 40.7855)
  assert.equal(data.updated[0].pricing.publish_enabled, false)
  assert.deepEqual(data.warnings.map(w => w.code), ['MOQ_CONFLICT', 'DUPLICATE_PRICING_TIER', 'DUPLICATE_VIDEO_IGNORED', 'DUPLICATE_LINK_IGNORED'])
  assert.equal(data.updated[0].audit_preview.will_write, false)
  assert.ok(calls.every(url => !url.includes(':commit')))
})

test('collection preparation refuses a live write request before any Firestore access', async () => {
  let calls = 0
  const res = await handleMcpCatalogue(request('prepare_catalogue_collection', { product_ids: ['a'], pricing_tier: { quantity: 100, production_lead_time_days: 30 }, dry_run: false }), { projectId: 'test', authorize, fetchImpl: async () => { calls++; return response({}) } })
  const data = await res.json()
  assert.equal(data.ok, false); assert.match(data.errors[0].message, /dry-run only/); assert.equal(calls, 0)
})
