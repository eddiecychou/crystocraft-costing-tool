import { strict as assert } from 'node:assert'
import { rangeQuoteChoices, quoteItemKey, rangeQuoteItem, hasIncompleteRangeLine, quoteItemToOrderLine } from '../src/rangeQuote.js'

const product = {
  id: 'R1', description: 'Butterfly Freestand', design_type: 'Butterflies', moq: 100,
  gallery: [{ url: 'https://example.com/hero.jpg' }],
  variants: [
    { sku: 'D0002-001-C', brand_name: 'Bohemia', plating_name: 'Chrome', ws_price_usd: 4.11, image: 'https://example.com/chrome.jpg' },
    { sku: 'A0002-001-C', brand_name: 'Asfour', plating_name: 'Chrome', ws_price_usd: 3.61 },
  ],
}
const choices = rangeQuoteChoices(product)
assert.equal(choices.length, 2)
assert.notEqual(choices[0].key, choices[1].key)
assert.equal(choices[0].image, 'https://example.com/chrome.jpg')
assert.equal(choices[1].image, 'https://example.com/hero.jpg')
assert.equal(choices[1].sku, 'A0002-001-C')

const hkd = rangeQuoteItem(choices[0], 'HKD', { USD: 7.8, HKD: 1 })
assert.equal(hkd.tiers[0].price, 32.06)
assert.equal(hkd.tiers[0].quantity, 100)
assert.equal(hkd.product_variant_sku, 'D0002-001-C')
assert.equal(hkd.unit_cost_hkd, null)
assert.equal(quoteItemKey(hkd), choices[0].key)
assert.equal(quoteItemKey({ product_id: 'R1' }), 'products:R1')
assert.equal(quoteItemKey({ product_id: 'R1', product_collection: 'products' }), 'products:R1')
assert.equal(hasIncompleteRangeLine(hkd), false)
assert.equal(hasIncompleteRangeLine({ ...hkd, tiers: [{ quantity: 100, price: 32.06 }] }), false)
assert.equal(hasIncompleteRangeLine({ product_collection: 'products', tiers: [{ quantity: '', price: '' }] }), false)
const rangeOrder = quoteItemToOrderLine({ ...hkd, tiers: [{ quantity: 100, price: 32.06 }] }, 0)
assert.equal(rangeOrder.line_type, 'range')
assert.equal(rangeOrder.item_code, 'D0002-001-C')
assert.equal(rangeOrder.matched_product_ref.collection, 'range_products')
const legacyOrder = quoteItemToOrderLine({ product_id: 'P1', product_name: 'Clock' }, 1)
assert.equal(legacyOrder.line_type, 'corp_gift')
assert.equal(legacyOrder.matched_product_ref.collection, 'products')
assert.equal(quoteItemToOrderLine({ is_custom: true, product_name: 'Sample' }, 2).line_type, 'ad_hoc')

const usd = rangeQuoteItem(choices[0], 'USD', { USD: 7.8 })
assert.equal(usd.tiers[0].price, 4.11)
const unpriced = rangeQuoteItem({ ...choices[0], usdPrice: null }, 'HKD', { USD: 7.8 })
assert.equal(unpriced.tiers[0].price, '')
assert.equal(hasIncompleteRangeLine(unpriced), true)
assert.equal(rangeQuoteItem(choices[0], 'EUR', { USD: 7.8 }).tiers[0].price, '')
assert.equal(rangeQuoteItem(choices[0], 'HKD', { USD: 0 }).tiers[0].price, '')

const designOnly = rangeQuoteChoices({ id: 'R2', design_name: 'New gift', variants: [] })[0]
assert.equal(designOnly.sku, '')
assert.equal(designOnly.variantIndex, null)
assert.equal(rangeQuoteItem(designOnly, 'HKD', { USD: 7.8 }).tiers[0].price, '')
console.log('range quote: assertions passed')
