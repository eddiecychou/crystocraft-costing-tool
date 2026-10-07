import test from 'node:test'
import assert from 'node:assert/strict'
import { cardImageUrl } from '../src/cardImageUrl.js'

test('Firebase card images use a bounded Netlify thumbnail', () => {
  const original = 'https://firebasestorage.googleapis.com/v0/b/demo/o/products%2Fphoto.jpg?alt=media&token=a&b'
  const result = cardImageUrl(original)
  assert.match(result, /^\/\.netlify\/images\?url=/)
  assert.match(result, /&w=640&q=72$/)
  assert.equal(new URLSearchParams(result.split('?')[1]).get('url'), original)
})

test('Google Storage card images use the image CDN', () => {
  assert.notEqual(cardImageUrl('https://storage.googleapis.com/demo/photo.jpg'), 'https://storage.googleapis.com/demo/photo.jpg')
})

test('unknown and malformed image URLs are left alone', () => {
  assert.equal(cardImageUrl('https://www.crystocraft.com/photo.jpg'), 'https://www.crystocraft.com/photo.jpg')
  assert.equal(cardImageUrl('not a url'), 'not a url')
})
