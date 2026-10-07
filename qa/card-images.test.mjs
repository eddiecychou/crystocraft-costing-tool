import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCardImages } from '../src/cardImages.js'

test('stale cached hero is omitted when a live gallery exists', () => {
  const result = buildCardImages([
    { file_url: 'live-a.jpg', caption: 'A' },
    { file_url: 'live-b.jpg', caption: 'B' },
  ], 'deleted-hero.jpg')
  assert.deepEqual(result, [
    { url: 'live-a.jpg', caption: 'A' },
    { url: 'live-b.jpg', caption: 'B' },
  ])
})

test('valid cached hero is placed first without duplication', () => {
  const result = buildCardImages([
    { file_url: 'a.jpg', caption: 'A' },
    { file_url: 'b.jpg', caption: 'B' },
  ], 'b.jpg')
  assert.deepEqual(result.map(im => im.url), ['b.jpg', 'a.jpg'])
})

test('gallery hero flag repairs ordering when the product cache is stale', () => {
  const result = buildCardImages([
    { file_url: 'a.jpg' },
    { file_url: 'b.jpg', is_hero: true },
  ], 'deleted-hero.jpg')
  assert.deepEqual(result.map(im => im.url), ['b.jpg', 'a.jpg'])
})

test('cache-only legacy products retain their hero image', () => {
  assert.deepEqual(buildCardImages([], 'legacy.jpg'), [{ url: 'legacy.jpg', caption: '' }])
})
