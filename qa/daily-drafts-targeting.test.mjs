import { test, before, beforeEach, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { dailyDraftsFixturePlugin, createDailyDraftsFixture } from './daily-drafts-fixture.mjs'

const require = createRequire(import.meta.url)
let dom, scratch, DailyDrafts, createRoot, Simulate, root, host, f, originalFetch
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const panel = () => [...host.querySelectorAll('h2')].find(e => e.textContent === '2. Who do you want to reach?').parentElement
const targeting = () => panel().querySelector('input:not([type])')
const includePrior = () => [...panel().querySelectorAll('label')].find(el => el.textContent.includes('Include people already contacted')).querySelector('input')
const click = async el => { assert.ok(el); await act(async () => el.click()) }
const change = async (el, value) => { assert.ok(el); await act(async () => Simulate.change(el, { target: { value } })) }
const readyMaster = async () => {
  await change(host.querySelector('textarea'), '  Fictional topic  ')
  await click(button('Draft with AI'))
}
const generated = () => f.calls.filter(c => c[0] === 'generateDrafts').at(-1)
const candidateIds = () => generated()[3].map(c => c.id).sort()

before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/marketing' })
  for (const name of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[name] = dom.window[name]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Simulate = (await import('react-dom/test-utils')).Simulate
  originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('Network forbidden in Daily Drafts fixture') }
  scratch = await mkdtemp(join(tmpdir(), 'daily-drafts-'))
  await build({ entryPoints: ['src/marketing/DailyDrafts.jsx'], outfile: join(scratch, 'ui.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'same-react-runtime', setup(b) { b.onResolve({ filter: /^(?:react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true })) } }, dailyDraftsFixturePlugin()] })
  DailyDrafts = (await import(pathToFileURL(join(scratch, 'ui.mjs')))).default
})
beforeEach(async () => {
  f = createDailyDraftsFixture(); globalThis.__dailyDraftsFixture = f
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(React.createElement(DailyDrafts)))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
after(async () => { globalThis.fetch = originalFetch; delete globalThis.__dailyDraftsFixture; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })

test('empty master keeps every targeting control and generation disabled', async () => {
  assert.equal(panel().querySelector('input[value=b2b]').checked, true)
  assert.equal(panel().querySelectorAll('input[type=checkbox]').length, 5)
  assert.ok([...panel().querySelectorAll('input,button')].every(el => el.disabled))
  assert.ok(panel().classList.contains('opacity-50'))
  await click(button('Generate Drafts')); assert.equal(generated(), undefined)
  await readyMaster(); assert.ok([...panel().querySelectorAll('input,button')].every(el => !el.disabled))
  assert.ok(!panel().classList.contains('opacity-50'))
  await change(host.querySelector('input[placeholder=Subject]'), '   ')
  assert.ok(button('Generate Drafts').disabled)
})
test('category selections survive audience switches and notes/toggles remain parent-owned', async () => {
  await readyMaster()
  const labels = () => [...panel().querySelectorAll('label')]
  await click(labels().find(l => l.textContent.trim() === 'Distributor').querySelector('input'))
  await click(labels().find(l => l.textContent.trim() === 'Gift / OEM').querySelector('input'))
  await change(targeting(), '  Hong Kong gift projects  '); await click(includePrior())
  await click(panel().querySelector('input[value=retail]'))
  assert.equal(panel().querySelectorAll('input[type=checkbox]').length, 1)
  await click(panel().querySelector('input[value=all]'))
  await click(panel().querySelector('input[value=b2b]'))
  assert.ok(labels().find(l => l.textContent.trim() === 'Distributor').querySelector('input').checked)
  assert.ok(labels().find(l => l.textContent.trim() === 'Gift / OEM').querySelector('input').checked)
  assert.equal(targeting().value, '  Hong Kong gift projects  '); assert.equal(includePrior().checked, true)
  await click(labels().find(l => l.textContent.trim() === 'Gift / OEM').querySelector('input'))
  await click(button('Generate Drafts')); assert.deepEqual(candidateIds(), ['trade'])
  assert.deepEqual(generated().slice(1, 3), [{ subject: 'Fictional master subject', body: 'Fictional approved message' }, 'Fictional topic'])
  assert.equal(generated()[5], 'Hong Kong gift projects')
})
for (const [audience, ids] of [['b2b', ['gift', 'lead', 'trade']], ['retail', ['retail']], ['all', ['gift', 'lead', 'retail', 'trade']]]) {
  test('real generation handler preserves ' + audience + ' audience and never sends email', async () => {
    f.contacts = [{ id: 'lead', status: 'subscribed', emailable: true, audiences: ['trade'], tags: [], email: 'lead@example.test' }]
    await readyMaster(); await click(panel().querySelector('input[value=' + audience + ']'))
    await click(button('Generate Drafts')); assert.deepEqual(candidateIds(), ids)
    assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction'].includes(c[0])))
  })
}
test('prior-contact opt-in annotates reminders without changing the history query or sending', async () => {
  f.prior = [{ id: 'prior', parentId: 'trade', date: { toMillis: () => Date.parse('2026-10-01'), toDate: () => new Date('2026-10-01') } }]
  await readyMaster(); await click(button('Generate Drafts')); assert.deepEqual(candidateIds(), ['gift'])
  await click(includePrior()); await click(button('Generate Drafts'))
  assert.deepEqual(candidateIds(), ['gift', 'trade'])
  assert.ok(generated()[3].find(c => c.id === 'trade').previouslyContactedAt)
  assert.deepEqual(f.calls.find(c => c[0] === 'getDocs' && c[1].kind === 'group')[1], { kind: 'group', path: 'enquiries', filters: [['product_interest', 'array-contains', 'Fictional topic']] })
})
test('busy generation prevents a second click; failure retains edits and permits retry', async () => {
  await readyMaster(); await change(targeting(), 'Keep this targeting note')
  let reject
  f.handlers.generateDrafts = () => new Promise((_resolve, fail) => { reject = fail })
  await click(button('Generate Drafts')); assert.ok(button('Generating…').disabled)
  await click(button('Generating…')); assert.equal(f.calls.filter(c => c[0] === 'generateDrafts').length, 1)
  await act(async () => reject(Error('Fictional provider unavailable')))
  assert.match(host.textContent, /Fictional provider unavailable/)
  assert.equal(targeting().value, 'Keep this targeting note'); assert.ok(!button('Generate Drafts').disabled)
  delete f.handlers.generateDrafts; await click(button('Generate Drafts'))
  assert.equal(f.calls.filter(c => c[0] === 'generateDrafts').length, 2)
})
test('successful generation preserves creation payload and resets compose while keeping audience selection', async () => {
  await readyMaster(); await click(panel().querySelector('input[value=retail]'))
  f.handlers.generateDrafts = async () => [{ customerId: 'retail', source: 'customer', subject: 'Fictional draft', body: 'Review before sending' }]
  await click(button('Generate Drafts'))
  const create = f.calls.find(c => c[0] === 'createDrafts')
  assert.deepEqual(create[1], { topicLabel: 'Fictional topic', productId: null, productName: null, productSource: null })
  assert.deepEqual(create[3], { imageUrls: [], links: [] })
  assert.equal(create[2][0].customerId, 'retail')
  assert.equal(panel().querySelector('input[value=retail]').checked, true)
  assert.equal(host.querySelector('textarea').value, '')
  assert.ok(button('Generate Drafts').disabled)
  assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction'].includes(c[0])))
})
