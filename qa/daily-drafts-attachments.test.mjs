import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change, changeFiles } from './daily-drafts-test-harness.mjs'

const calls = name => f.calls.filter(c => c[0] === name)
const picker = () => host.querySelector('input[placeholder="Search Corporate Gifts or Crystocraft Range…"]')
const linkUrl = () => host.querySelector('input[placeholder="https://www.crystocraft.com/blog/…"]')
const linkTitle = () => host.querySelector('input[placeholder="Link text (optional)"]')
const upload = () => host.querySelector('input[type=file]')
const previews = () => [...host.querySelectorAll('img')].filter(i => i.parentElement.tagName === 'DIV' && i.parentElement.querySelector('button'))
const gallery = () => [...host.querySelectorAll('button')].filter(b => b.querySelector('img'))
const choose = async name => { await click(button('+ Link a product (optional, unlocks its photos)')); await click(button(name + (name.includes('Range') ? 'Range' : 'Corporate'))) }
const unlink = () => [...host.querySelectorAll('span')].find(e => e.classList.contains('max-w-xs')).parentElement.querySelector('button')
const draft = async () => { await change(host.querySelector('textarea'), 'Fictional attachment topic'); await click(button('Draft with AI')) }
const addLink = async (url, title = '') => {
  await click(button('+ Link a blog post or page (optional)'))
  await change(linkUrl(), url); await change(linkTitle(), title); await click(button('Attach link'))
}

setupDailyDraftsTests(f => {
  f.handlers.loadBlogProducts = source => [{ id: 'same-id', source, name: source === 'range' ? 'Fictional Range 新系列' : 'Fictional Corporate Gift' }]
  f.handlers.loadBlogImages = source => [
    { id: 'public-1', file_url: 'https://assets.example.test/' + source + '-public-1.png', visibility: 'public' },
    { id: 'legacy', file_url: 'https://assets.example.test/' + source + '-legacy.png' },
    { id: 'private', file_url: 'https://assets.example.test/private.png', visibility: 'private' },
    { id: 'internal', file_url: 'https://assets.example.test/internal.png', visibility: 'internal' },
  ]
  f.handlers.ref = (_storage, path) => ({ path })
  f.handlers.uploadBytes = () => undefined
  f.handlers.getDownloadURL = () => 'https://assets.example.test/fictional-upload.png'
})
afterEach(() => { assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction', 'saveTopicTemplate', 'updateDoc'].includes(c[0]))) })

test('product picker searches both sources, distinguishes matching ids and retains search when toggled', async () => {
  await click(button('+ Link a product (optional, unlocks its photos)'))
  assert.ok(button('Fictional Corporate GiftCorporate')); assert.ok(button('Fictional Range 新系列Range'))
  await change(picker(), '  RANGE 新系列 '); assert.equal(button('Fictional Corporate GiftCorporate'), undefined)
  await click(button('+ Link a product (optional, unlocks its photos)')); assert.equal(picker(), null)
  await click(button('+ Link a product (optional, unlocks its photos)')); assert.equal(picker().value, '  RANGE 新系列 ')
  await change(picker(), 'no result'); assert.match(host.textContent, /No matches\./)
  await change(picker(), ''); await click(button('Fictional Range 新系列Range'))
  assert.equal(picker(), null); assert.deepEqual(calls('loadBlogImages')[0].slice(1), ['range', { id: 'same-id', source: 'range', name: 'Fictional Range 新系列' }])
  await click(unlink()); await click(button('+ Link a product (optional, unlocks its photos)')); assert.equal(picker().value, '')
})

for (const source of ['corporate', 'range']) test(source + ' gallery preserves public/legacy visibility and excludes private/internal images', async () => {
  await choose(source === 'range' ? 'Fictional Range 新系列' : 'Fictional Corporate Gift')
  assert.equal(gallery().length, 0); assert.equal(upload(), null)
  await draft(); assert.equal(gallery().length, 2)
  assert.deepEqual(gallery().map(b => b.querySelector('img').src), ['https://assets.example.test/' + source + '-public-1.png', 'https://assets.example.test/' + source + '-legacy.png'])
  assert.ok(!host.querySelector('img[src="https://assets.example.test/internal.png"]'))
  assert.ok(!host.querySelector('img[src="https://assets.example.test/private.png"]'))
})

test('gallery toggle, removal and two-image limit retain selection and recover controls', async () => {
  await choose('Fictional Range 新系列'); await draft()
  await click(gallery()[0]); assert.equal(previews().length, 1)
  await click(gallery()[0]); assert.equal(previews().length, 0)
  await click(gallery()[0]); await click(gallery()[1])
  assert.equal(previews().length, 2); assert.equal(gallery().length, 0); assert.equal(upload(), null)
  await click(previews()[0].parentElement.querySelector('button'))
  assert.equal(previews().length, 1); assert.equal(gallery().length, 2); assert.ok(upload())
  await click(unlink()); assert.equal(gallery().length, 0); assert.equal(previews().length, 1)
})

test('manual links work before drafting, trim values, fall back to URL titles and remove selected link only', async () => {
  await click(button('+ Link a blog post or page (optional)')); assert.ok(button('Attach link').disabled)
  await change(linkUrl(), '   '); await click(button('Attach link')); assert.ok(linkUrl())
  await change(linkUrl(), ' https://example.test/新系列?a=1&b=2 '); await change(linkTitle(), ' Details 新系列 '); await click(button('Attach link'))
  assert.equal(linkUrl(), null); assert.match(host.textContent, /Details 新系列/)
  await addLink(' https://example.test/second ')
  const chip = [...host.querySelectorAll('span')].find(e => e.textContent.trim() === 'Details 新系列')
  await click(chip.querySelector('button')); assert.doesNotMatch(host.textContent, /Details 新系列/)
  await draft(); await click(button('Generate Drafts'))
  // Generation returning no rows retains composer state and does not persist drafts.
  assert.equal(calls('createDrafts').length, 0); assert.match(host.textContent, /https:\/\/example.test\/second/)
})

test('link-form Cancel and reopen retain unsaved URL/title, while attaching clears the form', async () => {
  await click(button('+ Link a blog post or page (optional)')); await change(linkUrl(), 'https://example.test/unsaved'); await change(linkTitle(), 'Unsaved title')
  await click(button('Cancel')); assert.equal(linkUrl(), null)
  await click(button('+ Link a blog post or page (optional)')); assert.equal(linkUrl().value, 'https://example.test/unsaved'); assert.equal(linkTitle().value, 'Unsaved title')
  await click(button('Attach link')); await click(button('+ Link a blog post or page (optional)'))
  assert.equal(linkUrl().value, ''); assert.equal(linkTitle().value, '')
})

test('upload uses original storage path/file, disables while busy, and allows same-file selection after removal', async () => {
  await draft(); let finish
  f.handlers.uploadBytes = () => new Promise(resolve => { finish = resolve })
  const file = new window.File(['fictional image'], '新系列 & sample.png', { type: 'image/png' })
  await changeFiles(upload(), [file]); assert.equal(upload().disabled, true)
  assert.match(calls('ref')[0][2], /^daily_draft_images\/\d+_新系列 & sample\.png$/)
  assert.equal(calls('uploadBytes')[0][2], file); assert.equal(calls('getDownloadURL').length, 0)
  await act(async () => finish()); assert.equal(previews().length, 1); assert.equal(upload().disabled, false); assert.equal(upload().value, '')
  await click(previews()[0].parentElement.querySelector('button')); f.handlers.uploadBytes = () => undefined
  await changeFiles(upload(), [file]); assert.equal(calls('uploadBytes').length, 2); assert.equal(previews().length, 1)
})

test('cancelled file selection does not upload; upload failure preserves edits and permits retry', async () => {
  await draft(); await addLink('https://example.test/keep', 'Keep link')
  await changeFiles(upload(), []); assert.equal(calls('uploadBytes').length, 0)
  const file = new window.File(['fictional'], 'retry.png', { type: 'image/png' })
  f.handlers.uploadBytes = () => { throw Error('Fictional upload failure') }
  await changeFiles(upload(), [file]); assert.match(host.textContent, /Fictional upload failure/)
  assert.equal(upload().disabled, false); assert.equal(host.querySelector('input[placeholder=Subject]').value, 'Fictional master subject'); assert.match(host.textContent, /Keep link/); assert.equal(previews().length, 0)
  f.handlers.uploadBytes = () => undefined; await changeFiles(upload(), [file]); assert.equal(previews().length, 1); assert.doesNotMatch(host.textContent, /Fictional upload failure/)
})

test('download-URL failure leaves existing image selected and releases upload busy state', async () => {
  await choose('Fictional Corporate Gift'); await draft(); await click(gallery()[0])
  f.handlers.getDownloadURL = () => { throw Error('Fictional URL failure') }
  await changeFiles(upload(), [new window.File(['fixture'], 'fixture.png')])
  assert.equal(previews().length, 1); assert.match(host.textContent, /Fictional URL failure/); assert.equal(upload().disabled, false)
})

test('gallery and uploaded images share the two-image cap', async () => {
  await choose('Fictional Corporate Gift'); await draft(); await click(gallery()[0])
  await changeFiles(upload(), [new window.File(['fixture'], 'fixture.png')])
  assert.equal(previews().length, 2); assert.equal(upload(), null); assert.equal(gallery().length, 0)
})

test('successful generation preserves product identity, selected images and links payload, then resets composer only', async () => {
  await choose('Fictional Range 新系列'); await addLink(' https://example.test/new ', ' New details '); await draft(); await click(gallery()[1])
  await changeFiles(upload(), [new window.File(['fixture'], 'fixture.png')]); await click(host.querySelector('input[value=retail]'))
  f.handlers.generateDrafts = () => [{ customerId: 'retail', source: 'customer', subject: 'Fictional reviewed draft', body: 'Review before sending' }]
  await click(button('Generate Drafts'))
  const create = calls('createDrafts')[0]
  assert.deepEqual(create[1], { topicLabel: 'Fictional attachment topic', productId: 'same-id', productName: 'Fictional Range 新系列', productSource: 'range' })
  assert.deepEqual(create[3], { imageUrls: ['https://assets.example.test/range-legacy.png', 'https://assets.example.test/fictional-upload.png'], links: [{ title: 'New details', url: 'https://example.test/new' }] })
  assert.equal(create[2][0].customerId, 'retail'); assert.ok(host.querySelector('input[value=retail]').checked)
  assert.ok(button('+ Link a product (optional, unlocks its photos)')); assert.equal(previews().length, 0); assert.equal(upload(), null); assert.equal(host.querySelector('textarea').value, '')
  await click(button('+ Link a blog post or page (optional)')); assert.equal(linkUrl().value, ''); assert.equal(linkTitle().value, '')
})
