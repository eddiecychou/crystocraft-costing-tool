import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizedImageUrl } from '../netlify/edge-functions/download-image.js'
import { imageDownloadUrl } from '../src/imageDownloadUrl.js'

test('normalizes Firebase image downloads through same-origin Netlify Image CDN', () => {
  const target = new URL('https://firebasestorage.googleapis.com/v0/b/demo/o/photo.jpg?alt=media&token=a&b')
  const result = normalizedImageUrl('https://portal.crystocraft.com/api/download-image', target, 'jpeg')

  assert.equal(result.origin, 'https://portal.crystocraft.com')
  assert.equal(result.pathname, '/.netlify/images')
  assert.equal(result.searchParams.get('url'), target.toString())
  assert.equal(result.searchParams.get('fm'), 'jpg')
  assert.equal(result.searchParams.get('q'), '95')
})

test('does not normalize ordinary downloads or non-storage assets', () => {
  const storage = new URL('https://storage.googleapis.com/demo/photo.jpg')
  const wordpress = new URL('https://www.crystocraft.com/wp-content/uploads/photo.jpg')

  assert.equal(normalizedImageUrl('https://portal.crystocraft.com/api/download-image', storage, null), storage)
  assert.equal(normalizedImageUrl('https://portal.crystocraft.com/api/download-image', wordpress, 'jpeg'), wordpress)
})

test('shared image download URL normalizes only approved storage images', () => {
  const storage = imageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/demo/o/photo.jpg?alt=media&token=a&b', 'Photo 1.jpg', true)
  const storageParams = new URLSearchParams(storage.split('?')[1])
  assert.equal(storageParams.get('filename'), 'Photo 1.jpg')
  assert.equal(storageParams.get('normalize'), 'jpeg')

  const png = imageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/demo/o/logo.png', 'Logo.png', true)
  assert.equal(new URLSearchParams(png.split('?')[1]).get('normalize'), 'png')

  const wordpress = imageDownloadUrl('https://www.crystocraft.com/wp-content/uploads/photo.jpg', 'Photo.jpg', true)
  assert.equal(new URLSearchParams(wordpress.split('?')[1]).has('normalize'), false)

  const pdf = imageDownloadUrl('https://firebasestorage.googleapis.com/v0/b/demo/o/guide.pdf', 'guide.pdf', false)
  assert.equal(new URLSearchParams(pdf.split('?')[1]).has('normalize'), false)
})
