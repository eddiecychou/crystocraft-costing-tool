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
import { crmFixturePlugin, createCrmFixture } from './crm-components-fixture.mjs'

const require = createRequire(import.meta.url)
let dom, scratch, ui, createRoot, Simulate, MemoryRouter, root, host, f, runtimeErrors
const lead = 'fictional_lead'
const path = channel => 'marketing_contacts/' + lead + '/' + channel + '_threads'
const buttons = () => [...host.querySelectorAll('button')]
const find = label => buttons().find(b => b.textContent.trim() === label)
const click = async label => { const b = find(label); assert.ok(b, 'Button exists: ' + label); await act(async () => b.click()) }
const change = async (el, value) => { assert.ok(el); await act(async () => Simulate.change(el, { target: { value } })) }
const mount = async (Component, props = {}) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Component, props))))
}
const unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; host.remove() } }
before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/customers/fictional' })
  for (const name of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'sessionStorage']) globalThis[name] = dom.window[name]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.addEventListener('error', event => runtimeErrors.push(event.message))
  ;({ MemoryRouter } = await import('react-router-dom'))
  createRoot = (await import('react-dom/client')).createRoot
  Simulate = (await import('react-dom/test-utils')).Simulate
  scratch = await mkdtemp(join(tmpdir(), 'crm-components-'))
  const exports = [
    ['EmailThreads', 'ContactEmailThreads'], ['WhatsAppThreads', 'ContactWhatsAppThreads'],
    ['AlibabaThreads', 'ContactAlibabaThreads'], ['InteractionLog', 'ContactInteractionLog'],
    ['default as Collapsible', 'CustomerCollapsible'], ['default as BrandProposalCard', 'BrandProposalCard'],
    ['default as ProductDesignConceptsCard', 'ProductDesignConceptsCard'],
    ['default as InvitePricingDialog', 'InvitePricingDialog'], ['default as MergeCustomerModal', 'MergeCustomerModal'],
  ].map(([name, file]) => 'export {' + name + '} from "./src/components/crm/' + file + '.jsx";').join('\n')
  await build({ stdin: { contents: exports, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', outfile: join(scratch, 'ui.mjs'),
    plugins: [{ name: 'same-react-runtime', setup(b) { b.onResolve({ filter: /^(?:react(?:-dom|-router-dom)?(?:\/.*)?|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true })) } }, crmFixturePlugin()] })
  ui = await import(pathToFileURL(join(scratch, 'ui.mjs')))
})
beforeEach(() => { f = createCrmFixture(); globalThis.__crmFixture = f; runtimeErrors = []; sessionStorage.clear(); window.confirm = () => true })
afterEach(async () => { await unmount(); assert.deepEqual(runtimeErrors, [], 'No component runtime errors') })
after(async () => { delete globalThis.__crmFixture; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })

test('email sorts/expands threads and persists refreshed summary on the same lead', async () => {
  f.data[path('email')] = [
    { id: 'old', subject: 'Older', date_range: ['2025-01-01', '2025-01-02'], messages: [] },
    { id: 'new', subject: 'Latest quotation', message_count: 1, date_range: ['2026-10-20', '2026-10-21'], messages: [{ from: 'Test', date: '2026-10-21', body_text: 'Fictional email body 中文' }] },
  ]
  const updates = []
  await mount(ui.EmailThreads, { contactId: lead, onSummaryUpdated: data => updates.push(data) })
  const thread = buttons().find(b => b.textContent.includes('Latest quotation'))
  assert.ok(thread.compareDocumentPosition(buttons().find(b => b.textContent.includes('Older'))) & 4)
  await act(async () => thread.click()); assert.match(host.textContent, /Fictional email body 中文/)
  await click('Generate summary'); assert.match(host.textContent, /Refreshed fictional summary/)
  const write = f.calls.find(c => c[0] === 'write')
  assert.equal(write[1], 'marketing_contacts/' + lead); assert.equal(write[2].email_summary.thread_count, 2)
  assert.equal(write[2].has_email_threads, true); assert.ok(updates[0].email_summary.generated_at instanceof Date)
  await unmount(); assert.ok(f.closed.includes(path('email')))
})
test('empty email/WhatsApp stay hidden; failed refresh preserves saved context', async () => {
  await mount(ui.EmailThreads, { contactId: lead }); assert.equal(host.textContent, ''); await unmount()
  await mount(ui.WhatsAppThreads, { contactId: lead }); assert.equal(host.textContent, ''); await unmount()
  f.data[path('email')] = [{ id: 'email', subject: 'Thread' }]
  f.handlers.email = async () => { throw Error('Fictional provider unavailable') }
  await mount(ui.EmailThreads, { contactId: lead, emailSummary: { summary: 'Previously saved context' } })
  await click('Refresh summary'); assert.match(host.textContent, /Previously saved context/)
  assert.match(host.textContent, /Fictional provider unavailable/); assert.ok(!f.calls.some(c => c[0] === 'write'))
})
test('WhatsApp filters tombstones and transcribes only the selected note and language', async () => {
  f.data[path('whatsapp')] = [
    { id: 'gone', migrated_to: 'kept', channel: 'Migrated duplicate' },
    { id: 'kept', channel: 'WhatsApp Business', message_count: 1, messages: [{ from: 'Test', attachment_filename: 'voice.opus', attachment_url: '/fictional.opus', needs_transcription: true }] },
  ]
  await mount(ui.WhatsAppThreads, { contactId: lead, phone: '+85200000000' }); assert.doesNotMatch(host.textContent, /Migrated duplicate/)
  await act(async () => buttons().find(b => b.textContent.includes('WhatsApp Business')).click())
  assert.equal(host.querySelector('audio').getAttribute('src'), '/fictional.opus')
  await change(host.querySelector('select'), 'en'); await click('Transcribe')
  assert.deepEqual(f.calls.find(c => c[0] === 'transcribe'), ['transcribe', { type: 'lead', phone: '+85200000000' }, 'kept', 0, 'en'])
  await click('Generate summary'); assert.equal(f.calls.find(c => c[0] === 'whatsapp')[1], 'marketing_contacts')
})
test('changing lead closes the old subscription and replaces private correspondence', async () => {
  f.data[path('email')] = [{ id: 'first', subject: 'First private subject' }]
  f.data['marketing_contacts/other/email_threads'] = [{ id: 'second', subject: 'Second subject' }]
  await mount(ui.EmailThreads, { contactId: lead, emailSummary: { summary: 'First context' } })
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(ui.EmailThreads, { contactId: 'other', emailSummary: { summary: 'Second context' } }))))
  assert.match(host.textContent, /Second subject/); assert.match(host.textContent, /Second context/)
  assert.doesNotMatch(host.textContent, /First private subject|First context/); assert.ok(f.closed.includes(path('email')))
})
test('Alibaba paste stays available and preserves unsaved text on errors', async () => {
  await mount(ui.AlibabaThreads, { contactId: lead }); assert.ok(find('Save pasted messages').disabled)
  f.handlers.paste = async () => { throw Error('Fictional save failed') }
  await change(host.querySelector('textarea'), 'Fictional pasted chat 中文'); await click('Save pasted messages')
  assert.equal(host.querySelector('textarea').value, 'Fictional pasted chat 中文'); assert.match(host.textContent, /Fictional save failed/)
  delete f.handlers.paste; await click('Save pasted messages')
  assert.deepEqual(f.calls.filter(c => c[0] === 'paste').at(-1), ['paste', 'marketing_contacts', lead, 'Fictional pasted chat 中文'])
  assert.equal(host.querySelector('textarea').value, ''); assert.match(host.textContent, /Saved/)
})
test('Alibaba saved messages expand and summary updates return to the parent', async () => {
  f.data[path('alibaba')] = [{ id: 'paste', pasted_at: '2026-10-20', raw_text: 'Existing fictional chat' }]
  const updates = []
  await mount(ui.AlibabaThreads, { contactId: lead, onSummaryUpdated: next => updates.push(next) })
  await act(async () => buttons().find(b => b.textContent.includes('Pasted ')).click())
  assert.match(host.textContent, /Existing fictional chat/); await click('Generate summary')
  assert.deepEqual(f.calls.find(c => c[0] === 'alibaba').slice(1, 3), ['marketing_contacts', lead])
  assert.ok(updates[0].alibaba_summary.generated_at instanceof Date)
})
test('interaction log preserves its target and requires delete confirmation', async () => {
  await mount(ui.InteractionLog, { contactId: lead }); await click('Interaction Log')
  await change(host.querySelector('input'), 'Follow up on sample'); await change(host.querySelector('select'), 'WhatsApp Business'); await click('Log')
  assert.match(host.textContent, /Follow up on sample/)
  assert.deepEqual(f.calls.find(c => c[0] === 'addInteraction'), ['addInteraction', 'marketing_contacts', lead, { description: 'Follow up on sample', channel: 'WhatsApp Business' }])
  window.confirm = () => false; await act(async () => host.querySelector('button.text-platinum').click())
  assert.ok(!f.calls.some(c => c[0] === 'deleteInteraction'))
  window.confirm = () => true; await act(async () => host.querySelector('button.text-platinum').click())
  assert.match(host.textContent, /Nothing logged yet/)
  assert.deepEqual(f.calls.find(c => c[0] === 'deleteInteraction'), ['deleteInteraction', 'marketing_contacts', lead, 'new'])
})
test('collapse state survives remount, stays customer-specific, and ignores right-side clicks', async () => {
  let clicked = 0
  const props = { storageKey: 'first:history', title: 'History', right: React.createElement('button', { onClick: () => clicked++ }, 'Open history'), children: 'Private content' }
  await mount(ui.Collapsible, props); await click('Open history'); assert.equal(clicked, 1); assert.match(host.textContent, /Private content/)
  await act(async () => host.querySelector('.cursor-pointer').click()); assert.doesNotMatch(host.textContent, /Private content/)
  await unmount(); await mount(ui.Collapsible, props); assert.doesNotMatch(host.textContent, /Private content/)
  await unmount(); await mount(ui.Collapsible, { ...props, storageKey: 'other:history' }); assert.match(host.textContent, /Private content/)
})
test('brand card preserves thumbnail limits, PDF placeholders, links and design gating', async () => {
  f.assets.fictional = Array.from({ length: 7 }, (_, i) => ({ id: String(i), category: 'brand_asset', filename: i === 0 ? 'brand.pdf' : 'brand.png', file_url: '/fictional.png' }))
  f.handlers.proposal = async () => ({ status: 'published', updated_at: { seconds: 1792454400 } })
  await mount(ui.BrandProposalCard, { customerId: 'fictional', showDesignProfile: false })
  assert.match(host.textContent, /7 brand assets/); assert.match(host.textContent, /\+2/); assert.match(host.textContent, /proposal published/)
  assert.equal(host.querySelectorAll('img').length, 4); assert.equal(host.querySelector('a').getAttribute('href'), '/customers/fictional/brand')
  assert.doesNotMatch(host.textContent, /Brand Profile/); await unmount()
  await mount(ui.BrandProposalCard, { customerId: 'fictional', showDesignProfile: true }); assert.match(host.textContent, /Design brand profile for fictional/)
})
test('concepts retain empty-state navigation and uncropped image/detail/download links', async () => {
  await mount(ui.ProductDesignConceptsCard, { customerId: 'fictional' }); assert.match(host.textContent, /No approved concepts yet/); await unmount()
  f.handlers.concepts = async () => [{ template: { id: 'template', name: 'Fictional concept 中文' }, product: { name: 'Product' }, thumbUrl: 'https://www.crystocraft.com/fictional.jpg' }]
  await mount(ui.ProductDesignConceptsCard, { customerId: 'fictional' })
  assert.match(host.textContent, /1 approved/); assert.equal(host.querySelector('a').getAttribute('href'), '/design/templates/template')
  assert.equal(host.querySelector('a[download]').getAttribute('download'), 'Fictional concept 中文.jpg')
  assert.ok(host.querySelector('img').classList.contains('object-contain'))
})
test('invitation currency edits stay open and explicit confirmation retains full pricing precision', async () => {
  const confirms = [], cancels = []
  await mount(ui.InvitePricingDialog, { contact: { name: 'Test Contact' }, busy: false, onConfirm: next => confirms.push(next), onCancel: () => cancels.push(true) })
  await change(host.querySelector('select'), 'HKD'); assert.equal(cancels.length, 0)
  const inputs = host.querySelectorAll('input')
  await change(inputs[0], '7.8123'); await change(inputs[1], '90'); await change(inputs[2], '2.25')
  assert.equal(confirms.length, 0); await click('Send invite')
  assert.deepEqual(confirms, [{ baseCurrency: 'HKD', fxRate: 7.8123, wsDiscountPct: 90, corpMarkupOverride: 2.25 }])
  await click('Cancel'); assert.equal(cancels.length, 1); await unmount()
  await mount(ui.InvitePricingDialog, { contact: {}, busy: true })
  assert.ok(find('Sending invite…').disabled); assert.ok(find('Cancel').disabled)
})
test('merge requires a survivor preview before its explicit action', async () => {
  const merged = []
  f.handlers.customers = async () => [{ id: 'source', company_name: 'Source' }, { id: 'target', company_name: 'Surviving Company' }]
  f.handlers.preview = async () => ({ survivor: { company_name: 'Surviving Company' }, fieldsToFill: {}, contactsToAdd: [], tagsToAdd: [], channelsToAdd: [], ordersCount: 0, quotesCount: 0, accountsCount: 0 })
  f.handlers.merge = async () => {}
  await mount(ui.MergeCustomerModal, { customer: { id: 'source', company_name: 'Source' }, onMerged: id => merged.push(id) })
  assert.ok(find('Merge & Delete').disabled)
  await change(host.querySelector('input'), 'Surviving'); await click('Surviving Company')
  assert.deepEqual(f.calls.find(c => c[0] === 'preview'), ['preview', 'source', 'target']); assert.equal(merged.length, 0)
  assert.ok(!f.calls.some(c => c[0] === 'merge')); await click('Merge & Delete')
  assert.deepEqual(f.calls.find(c => c[0] === 'merge'), ['merge', 'source', 'target']); assert.deepEqual(merged, ['target'])
})
