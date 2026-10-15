import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeQuoteChoices, rangeQuoteItem, quoteItemKey } from '../src/rangeQuote.js'
import { filterQuoteChoices } from '../src/quoteProductSearch.js'

const variants = rangeQuoteChoices({ id: 'r1', design_name: 'Butterfly', design_code: '0002', variants: [
  { sku: 'D0002-C', brand_name: 'Bohemia', ws_price_usd: 4.11 },
  { sku: 'D0002-C', brand_name: 'Asfour', ws_price_usd: 3.61 },
  { ws_price_usd: 2 },
] })
const ballerina = rangeQuoteChoices({ id: 'r2', description: 'Ballerina', design_code: '0327', variants: [{ sku: 'D0327-C' }] })
const choices = [...variants, ...ballerina]

test('duplicate SKU rows have independent identities and preserve exact price snapshots', () => {
  assert.equal(new Set(choices.map(p => p.key)).size, choices.length)
  const lines = variants.map(p => rangeQuoteItem(p, 'USD', { USD: 7.8 }))
  assert.deepEqual(lines.map(quoteItemKey), variants.map(p => p.key))
  assert.deepEqual(lines.map(p => p.tiers[0].price), [4.11, 3.61, 2])
  assert.deepEqual(lines.map(p => p.product_variant_index), [0, 1, 2])
  assert.ok(lines.every(p => p.unit_cost_hkd === null))
})
test('search matches name, design code, SKU and variant details; trims and ignores case', () => {
  for (const term of ['ball', ' BALL ', '0327', 'd0327-c']) assert.deepEqual(filterQuoteChoices(choices, term), ballerina)
  assert.deepEqual(filterQuoteChoices(choices, 'asfour'), [variants[1]])
  assert.deepEqual(filterQuoteChoices(choices, 'no such product'), [])
  assert.deepEqual(filterQuoteChoices(choices, ''), choices)
})
test('existing indexed quote line hides only its exact variant, including older snapshots', () => {
  const oldLine = { product_id: 'r1', product_collection: 'range_products', product_variant_sku: 'D0002-C', product_variant_index: 0 }
  assert.deepEqual(filterQuoteChoices(choices, '', [quoteItemKey(oldLine)]), choices.slice(1))
})
test('legacy SKU-only lines remain excluded without guessing a price variant', () => {
  const legacyLine = { product_id: 'r1', product_collection: 'range_products', product_variant_sku: 'D0002-C' }
  assert.deepEqual(filterQuoteChoices(choices, '', [quoteItemKey(legacyLine)]), choices.slice(2))
  const design = rangeQuoteChoices({ id: 'empty' })[0]
  assert.equal(quoteItemKey(rangeQuoteItem(design, 'USD', { USD: 7.8 })), design.key)
})
test('corporate gifts retain search and existing-product exclusion', () => {
  const p = { key: 'products:p1', name: 'Desk Clock', category: 'Accessories' }
  assert.deepEqual(filterQuoteChoices([p], 'CLOCK'), [p])
  assert.deepEqual(filterQuoteChoices([p], '', [p.key]), [])
})
