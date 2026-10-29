import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogueBlocks, catalogueImages, planCataloguePages, splitCatalogueText } from '../src/catalogueLayout.js'

const product = (number, photos = 1, specs = 'Material: glass') => ({ id: String(number), product_name: `Product ${number}`, product_description: specs, selected_images: Array.from({ length: photos }, (_, index) => `image-${number}-${index}`) })
// Deterministic stand-in for the browser's measured height, not a production
// character estimate. Different capacities exercise promotion and continuation.
const fits = (mode, item, blocks) => blocks.reduce((sum, block) => sum + Array.from(block.text).length, 0) <= ({ overview: 40, standard: 100, feature: 140, details: 240, gallery: 40 }[mode])
const allEntries = pages => pages.flatMap(page => page.entries)

test('four short products share an overview; mixed photo counts share a standard page', () => {
  assert.equal(planCataloguePages([1, 2, 3, 4].map(n => product(n)), fits)[0].type, 'overview')
  const pages = planCataloguePages([product(1, 4), product(2, 3)], fits)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].type, 'standard')
  assert.deepEqual(pages[0].entries.map(e => e.number), [1, 2])
})

test('long specifications promote a product and preserve every character across pages', () => {
  const specs = ('Material: 晶體 / crystal ✨\n\nDimensions: 14 × 14 mm\n' + 'X'.repeat(91) + '\n').repeat(12)
  const item = { ...product(1, 4, specs), marketing_description: 'A detailed product introduction. '.repeat(12) }
  const pages = planCataloguePages([item, product(2)], fits)
  assert.equal(pages[0].type, 'feature')
  const entries = allEntries(pages).filter(e => e.number === 1)
  assert.ok(entries.length > 2)
  for (const original of catalogueBlocks(item)) assert.equal(entries.flatMap(e => e.blocks).filter(b => b.kind === original.kind).map(b => b.text).join(''), original.text)
  assert.ok(entries.slice(1).every(e => e.continued))
  assert.equal(allEntries(pages).at(-1).number, 2)
})

test('7, 8, 13 and 29 photos retain exact order without omissions or duplicates', () => {
  for (const count of [7, 8, 13, 29]) {
    const item = product(1, count)
    const pages = planCataloguePages([item], fits)
    assert.ok(pages.length > 1)
    assert.deepEqual(allEntries(pages).flatMap(e => e.images), item.selected_images)
    assert.ok(pages.slice(1).every(p => p.type === 'gallery'))
    assert.ok(pages.every(p => p.entries[0].images.length <= 6))
  }
})

test('many photos and long copy finish together before the next product', () => {
  const item = { ...product(1, 19, '長規格\n'.repeat(200)), marketing_description: 'Copy '.repeat(180) }
  const pages = planCataloguePages([item, product(2)], fits)
  const entries = allEntries(pages)
  assert.deepEqual(entries.filter(e => e.number === 1).flatMap(e => e.images), item.selected_images)
  assert.equal(entries.at(-1).number, 2)
  for (const block of catalogueBlocks(item)) assert.equal(entries.filter(e => e.number === 1).flatMap(e => e.blocks).filter(b => b.kind === block.kind).map(b => b.text).join(''), block.text)
})

test('feature and page-break choices preserve product order and do not leave empty slots', () => {
  const items = [product(1), { ...product(2), page_break_before: true }, { ...product(3), layout_mode: 'feature' }, product(4)]
  const pages = planCataloguePages(items, fits)
  assert.ok(pages.every(p => p.entries.length > 0))
  assert.deepEqual(allEntries(pages).map(e => e.number), [1, 2, 3, 4])
  assert.equal(pages[0].entries.length, 1)
  assert.equal(pages[2].entries.length, 1)
})

test('legacy hero fallback, explicit no-photo selection and empty copy remain distinct', () => {
  assert.deepEqual(catalogueImages({ hero_image: 'hero' }), ['hero'])
  assert.deepEqual(catalogueImages({ hero_image: 'hero', selected_images: [] }), [])
  assert.deepEqual(catalogueImages({ selected_images: ['a', '', 'a', 'b'] }), ['a', 'b'])
  assert.deepEqual(catalogueBlocks({ marketing_description: '', product_marketing_description: 'Old copy' }), [])
  assert.deepEqual(planCataloguePages([], fits), [])
  assert.equal(planCataloguePages([product(1, 0)], fits)[0].type, 'details')
})

test('splitting keeps whitespace, Chinese, emoji and long words exactly; an impossible heading fails closed', () => {
  for (const text of ['  First\n\nSecond  ', '晶體規格💎✨尺寸', 'X'.repeat(1000)]) {
    const [head, tail] = splitCatalogueText(text, part => Array.from(part).length <= 7)
    assert.equal(head + tail, text)
    assert.ok(Array.from(head).length <= 7)
    assert.ok(!/[\uD800-\uDBFF]$/.test(head))
  }
  assert.throws(() => planCataloguePages([product(1)], () => false), /heading/)
})
