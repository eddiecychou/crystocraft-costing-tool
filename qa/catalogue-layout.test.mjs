import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogueBlocks, catalogueImages, catalogueImageSize, catalogueImageOrientation, withCatalogueImageSize, planCataloguePages, splitCatalogueText } from '../src/catalogueLayout.js'

const product = (number, photos = 1, specs = 'Material: glass') => ({ id: String(number), product_name: `Product ${number}`, product_description: specs, selected_images: Array.from({ length: photos }, (_, index) => `image-${number}-${index}`) })
// Deterministic stand-in for the browser's measured height, not a production
// character estimate. Different capacities exercise promotion and continuation.
const fits = (mode, item, blocks) => blocks.reduce((sum, block) => sum + Array.from(block.text).length, 0) <= ({ overview: 40, standard: 100, feature: 140, details: 240, gallery: 40, large: 40, full: 40 }[mode])
const allEntries = pages => pages.flatMap(page => page.entries)

test('compact single-photo products share overview/comparison pages', () => {
  assert.equal(planCataloguePages([1, 2, 3, 4].map(n => product(n)), fits)[0].type, 'overview')
  const pages = planCataloguePages([product(1), product(2)], fits)
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
    assert.ok(pages.every(p => p.entries[0].images.length <= 4))
  }
})

test('supporting Standard images have galleries rather than a thumbnail strip', () => {
  const item = product(1, 9)
  const pages = planCataloguePages([item], fits)
  assert.deepEqual(pages.map(p => [p.type, p.entries[0].images.length]), [['feature', 1], ['gallery', 4], ['gallery', 4]])
  assert.deepEqual(allEntries(pages).flatMap(e => e.images), item.selected_images)
  const fiveSupporting = planCataloguePages([product(2, 6)], fits)
  assert.deepEqual(fiveSupporting.map(p => p.entries[0].images.length), [1, 3, 2], 'Balance the final galleries instead of leaving a single image after four')
})

test('mixed per-image sizes retain exact order, dedicated full pages and automatic portrait', () => {
  const item = product(1, 8)
  const images = item.selected_images
  item.image_layouts = [
    { url: images[1], size: 'large' }, { url: images[2], size: 'large' },
    { url: images[3], size: 'full' }, { url: images[5], size: 'full' },
    { url: images[6], size: 'large' },
  ]
  const dimensions = { [images[3]]: { width: 800, height: 1800 }, [images[5]]: { width: 1800, height: 800 } }
  const pages = planCataloguePages([item, product(2)], fits, dimensions)
  const first = pages.filter(p => p.entries[0].number === 1)
  assert.deepEqual(first.map(p => p.type), ['feature', 'large', 'full', 'gallery', 'full', 'large', 'gallery'])
  assert.deepEqual(first.map(p => p.orientation), ['landscape', 'landscape', 'portrait', 'landscape', 'landscape', 'landscape', 'landscape'])
  assert.deepEqual(first.flatMap(p => p.entries[0].images), images)
  assert.ok(first.filter(p => p.type === 'large').every(p => p.entries[0].images.length <= 2))
  assert.ok(first.filter(p => p.type === 'full').every(p => p.entries[0].images.length === 1 && p.entries[0].blocks.length === 0))
  assert.equal(allEntries(pages).at(-1).number, 2)
})

test('a Full page hero appears once and retains complete text on following pages', () => {
  const item = product(1, 3, '晶體規格\n'.repeat(200))
  item.image_layouts = [{ url: item.selected_images[0], size: 'full' }]
  const pages = planCataloguePages([item], fits, { [item.selected_images[0]]: { width: 600, height: 1600 } })
  assert.equal(pages[0].type, 'full')
  assert.equal(pages[0].orientation, 'portrait')
  assert.deepEqual(allEntries(pages).flatMap(e => e.images), item.selected_images)
  assert.equal(allEntries(pages).flatMap(e => e.blocks).map(b => b.text).join(''), item.product_description)
})

test('image choices follow URL identity across reorder/removal and preserve other metadata', () => {
  const item = product(1, 3)
  const url = item.selected_images[1]
  item.image_layouts = [{ url, size: 'full', original_note: 'keep' }, { url: 'unselected-image', size: 'large' }]
  const layouts = withCatalogueImageSize(item, url, 'large')
  assert.deepEqual(layouts, [{ url: 'unselected-image', size: 'large' }, { url, size: 'large', original_note: 'keep' }])
  const reordered = { ...item, selected_images: [...item.selected_images].reverse(), image_layouts: layouts }
  assert.equal(catalogueImageSize(reordered, url), 'large')
  assert.equal(catalogueImageSize({ ...item, image_layouts: [{ url, size: 'invalid' }] }, url), 'standard')
  assert.equal(catalogueImageSize(product(2), 'legacy-photo'), 'standard')
  assert.throws(() => withCatalogueImageSize({ ...item, selected_images: [] }, url, 'large'), /no longer selected/)
  assert.throws(() => withCatalogueImageSize(item, url, 'invalid'), /Choose/)
  assert.equal(item.image_layouts[0].size, 'full')
})

test('full-page orientation requires genuine image dimensions', () => {
  assert.equal(catalogueImageOrientation({ width: 800, height: 1200 }), 'portrait')
  assert.equal(catalogueImageOrientation({ width: 800, height: 800 }), 'landscape')
  assert.throws(() => catalogueImageOrientation({ width: 0, height: 1200 }), /could not load/)
  const item = product(1)
  item.image_layouts = [{ url: item.selected_images[0], size: 'full' }]
  assert.throws(() => planCataloguePages([item], fits), /could not load/)
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
