import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogueUploadMetadata, CATALOGUE_IMAGE_CACHE_CONTROL, isCurrentHero, productHeroPatch, chooseGalleryHero, catalogueStoragePath } from '../src/catalogueImagePolicy.js'

test('catalogue uploads cache in the browser without changing customer/supplier assets', () => {
  assert.equal(catalogueUploadMetadata('products/p/images/123.jpg').cacheControl, CATALOGUE_IMAGE_CACHE_CONTROL)
  assert.equal(catalogueUploadMetadata('range_products/r/123.jpg').cacheControl, CATALOGUE_IMAGE_CACHE_CONTROL)
  assert.equal(catalogueUploadMetadata('customer-assets/c/123.jpg').cacheControl, undefined)
  assert.equal(catalogueUploadMetadata('range_products/r/quote.pdf', 'application/pdf').cacheControl, undefined)
})
test('legacy cached hero is recognized even without is_hero, and unrelated photos are not selected', () => {
  assert.equal(isCurrentHero({ file_url: 'old' }, 'old'), true)
  assert.equal(isCurrentHero({ file_url: 'other' }, 'old'), false)
})
test('a stale hero resolves to the selected live gallery image and keeps its visibility/branding', () => {
  const rows = [{ id: 'a', file_url: 'first', sort_order: 0 }, { id: 'b', file_url: 'chosen', is_hero: true, visibility: 'internal', branded_for_customer_id: 'client-a', sort_order: 1 }]
  assert.deepEqual(productHeroPatch(chooseGalleryHero(rows, 'deleted')), { heroImage: 'chosen', heroImage_visibility: 'internal', heroImage_branded_for_customer_id: 'client-a' })
  assert.equal(chooseGalleryHero(rows, 'first').file_url, 'first')
  assert.deepEqual(productHeroPatch(null), { heroImage: null, heroImage_visibility: 'internal', heroImage_branded_for_customer_id: null })
})
test('metadata repairs accept only image paths belonging to the same catalogue record and bucket', () => {
  const url = (bucket, path) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=fixture`
  assert.equal(catalogueStoragePath(url('b', 'products/p/images/a.jpg'), 'b', 'products', 'p'), 'products/p/images/a.jpg')
  assert.equal(catalogueStoragePath(url('b', 'products/other/images/a.jpg'), 'b', 'products', 'p'), null)
  assert.equal(catalogueStoragePath(url('other', 'products/p/images/a.jpg'), 'b', 'products', 'p'), null)
  assert.equal(catalogueStoragePath(url('b', 'customer-assets/c/a.jpg'), 'b', 'products', 'p'), null)
})
