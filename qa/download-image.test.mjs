import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { normalizedImageUrl } from '../netlify/edge-functions/download-image.js'
import { imageDownloadUrl } from '../src/imageDownloadUrl.js'

const source = 'https://firebasestorage.googleapis.com/v0/b/demo/o/photo.jpg?alt=media&token=test'
const imageBytes = new Uint8Array([255, 216, 255, 217])

function mockDownload(t, upstream = () => new Response(imageBytes, { headers: { 'Content-Type': 'image/jpeg' } })) {
  const originalDeno = globalThis.Deno
  globalThis.Deno = { env: { get: () => 'demo' } }
  t.after(() => {
    if (originalDeno === undefined) delete globalThis.Deno
    else globalThis.Deno = originalDeno
  })
  return t.mock.method(globalThis, 'fetch', upstream)
}

function downloadRequest(filename, fileUrl = source, normalize = true) {
  return new Request(new URL(imageDownloadUrl(fileUrl, filename, normalize), 'https://portal.crystocraft.com'))
}

function dispositionNames(response) {
  const header = response.headers.get('Content-Disposition')
  assert.match(header, /^[\x20-\x7e]+$/)
  const match = /^attachment; filename="([^"\\]*)"; filename\*=UTF-8''(.+)$/.exec(header)
  assert.ok(match, 'download has a quoted ASCII fallback and a UTF-8 filename')
  return { fallback: match[1], unicode: decodeURIComponent(match[2]) }
}

test('downloads the affected bottle image with its Unicode product name and unchanged image bytes', async t => {
  const upstream = mockDownload(t)
  const filename = 'Carry-Loop Water Bottle — 600 mL - 4.jpg'
  const response = await handler(downloadRequest(filename))

  assert.equal(response.status, 200)
  assert.deepEqual(dispositionNames(response), { fallback: 'Carry-Loop Water Bottle _ 600 mL - 4.jpg', unicode: filename })
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes)
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=3600')
  const [url, options] = upstream.mock.calls[0].arguments
  assert.equal(url.pathname, '/.netlify/images')
  assert.equal(url.searchParams.get('url'), source)
  assert.equal(options.redirect, 'error')
  assert.ok(options.signal instanceof AbortSignal)
})

test('downloads Chinese, accented and emoji filenames using a valid UTF-8 disposition', async t => {
  mockDownload(t)
  for (const filename of ['水樽产品图 - 5.jpg', 'Café ✨.png', "Supplier's (final)* quote.pdf"]) {
    const response = await handler(downloadRequest(filename))
    assert.equal(response.status, 200)
    assert.equal(dispositionNames(response).unicode, filename)
  }
})

test('keeps filenames inside the attachment header and removes paths and control characters', async t => {
  mockDownload(t)
  const response = await handler(downloadRequest('folder/quote\\"\r\nX-Injected: yes\u0000\u007f.jpg'))
  assert.equal(response.status, 200)
  const names = dispositionNames(response)
  assert.equal(names.unicode, 'folder_quote_"__X-Injected: yes__.jpg')
  assert.equal(names.fallback, 'folder_quote____X-Injected: yes__.jpg')
  assert.equal(response.headers.has('X-Injected'), false)
})

test('retains ordinary filenames, defaults empty names and bounds very long Unicode names', async t => {
  mockDownload(t)
  for (const filename of ['Bottle - 4.jpg', '', '✨'.repeat(205)]) {
    const response = await handler(downloadRequest(filename))
    assert.equal(response.status, 200)
    assert.equal(dispositionNames(response).unicode, filename ? Array.from(filename).slice(0, 200).join('') : 'image.jpg')
  }
})

test('continues rejecting missing, malformed, insecure, foreign-host and foreign-bucket sources', async t => {
  const upstream = mockDownload(t)
  assert.equal((await handler(new Request('https://portal.crystocraft.com/api/download-image'))).status, 400)
  assert.equal((await handler(downloadRequest('photo.jpg', 'invalid'))).status, 400)
  for (const url of ['http://storage.googleapis.com/demo/photo.jpg', 'https://example.com/photo.jpg', 'https://crystocraft.com.example.com/photo.jpg', 'https://storage.googleapis.com/other/photo.jpg']) {
    assert.equal((await handler(downloadRequest('photo.jpg', url))).status, 403)
  }
  assert.equal(upstream.mock.callCount(), 0)
})

test('continues reporting upstream failures and refusing oversized downloads', async t => {
  const upstream = mockDownload(t, () => { throw new Error('upstream unavailable') })
  assert.equal((await handler(downloadRequest('photo.jpg'))).status, 502)
  upstream.mock.mockImplementation(() => new Response('missing', { status: 404 }))
  assert.equal((await handler(downloadRequest('photo.jpg'))).status, 502)
  upstream.mock.mockImplementation(() => new Response(imageBytes, { headers: { 'Content-Length': String(51 * 1024 * 1024) } }))
  assert.equal((await handler(downloadRequest('photo.jpg'))).status, 413)
})

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
