import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change } from './daily-drafts-test-harness.mjs'

const topic = () => host.querySelector('textarea')
const selector = () => host.querySelector('select[aria-label="Saved topics"]')
const subject = () => host.querySelector('input[placeholder=Subject]')
const body = () => host.querySelector('textarea[placeholder=Message]')
const calls = name => f.calls.filter(c => c[0] === name)
const draft = async () => { await change(topic(), '  新系列 — fictional topic  '); await click(button('Draft with AI')) }
const noMail = () => assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction'].includes(c[0])))

setupDailyDraftsTests(f => {
  f.rules = [{ id: 'active', text: 'Use verified facts.', status: 'active' }, { id: 'pending', text: 'Do not use this.', status: 'pending' }]
  f.handlers.listTopicTemplates = () => [{ id: 'saved', name: 'Fictional saved topic', text: 'Saved 新系列 / updates' }]
})
afterEach(() => { window.prompt = () => { throw Error('Unexpected prompt') }; window.confirm = () => { throw Error('Unexpected confirmation') }; noMail() })

test('blank topic blocks drafting/saving; saved-topic selection and manual edits preserve original behavior', async () => {
  assert.ok(button('Draft with AI').disabled); assert.ok(button('Save as reusable topic').disabled)
  assert.equal(subject(), null); assert.equal(body(), null)
  await change(topic(), '   '); await click(button('Draft with AI')); assert.equal(calls('draftTopic').length, 0)
  await change(selector(), 'saved'); assert.equal(topic().value, 'Saved 新系列 / updates')
  assert.ok(button('Update saved topic')); assert.ok(button('Delete saved topic'))
  await change(selector(), ''); assert.equal(topic().value, 'Saved 新系列 / updates')
  await change(selector(), 'saved'); await change(topic(), 'Manual topic')
  assert.equal(selector().value, ''); assert.ok(button('Save as reusable topic')); assert.equal(button('Delete saved topic'), undefined)
})

test('draft uses trimmed topic and active rules, prevents repeat clicks, then populates editable master fields', async () => {
  let resolve
  f.handlers.draftTopic = () => new Promise(done => { resolve = done })
  await change(topic(), '  新系列 — fictional topic  '); await click(button('Draft with AI'))
  assert.ok(button('Drafting…').disabled); await click(button('Drafting…'))
  assert.deepEqual(calls('draftTopic'), [['draftTopic', '新系列 — fictional topic', { globalRules: ['Use verified facts.'] }]])
  await act(async () => resolve({ subject: 'Original subject', body: 'Original body' }))
  assert.equal(subject().value, 'Original subject'); assert.equal(body().value, 'Original body'); assert.ok(button('Draft again'))
  await change(subject(), 'Edited subject'); await change(body(), 'Edited body\nwith details')
  await click(button('Generate Drafts'))
  assert.deepEqual(calls('generateDrafts')[0][1], { subject: 'Edited subject', body: 'Edited body\nwith details' })
  assert.equal(calls('generateDrafts')[0][2], '新系列 — fictional topic')
  assert.deepEqual(calls('generateDrafts')[0][6], { globalRules: ['Use verified facts.'] })
})

test('failed redraft retains topic and edited master, shows error and permits retry', async () => {
  await draft(); await change(subject(), 'Keep subject'); await change(body(), 'Keep body')
  f.handlers.draftTopic = () => { throw Error('Fictional drafting failure') }
  await click(button('Draft again')); assert.match(host.textContent, /Fictional drafting failure/)
  assert.equal(topic().value, '  新系列 — fictional topic  '); assert.equal(subject().value, 'Keep subject'); assert.equal(body().value, 'Keep body')
  assert.ok(!button('Draft again').disabled)
  delete f.handlers.draftTopic; await click(button('Draft again'))
  assert.equal(calls('draftTopic').length, 3); assert.equal(subject().value, 'Fictional master subject')
})

test('cancelled and whitespace template names do not write', async () => {
  await change(topic(), 'New topic')
  for (const answer of [null, '   ']) { window.prompt = () => answer; await click(button('Save as reusable topic')) }
  assert.equal(calls('saveTopicTemplate').length, 0); assert.equal(calls('updateTopicTemplate').length, 0)
})

test('new template save trims payload and selects the returned record without losing topic edits', async () => {
  await change(topic(), '  新系列 / updates  ')
  window.prompt = (label, initial) => { assert.equal(label, 'Save this topic as:'); assert.equal(initial, '新系列 / updates'); return '  New saved name  ' }
  f.handlers.saveTopicTemplate = () => 'new-fictional'
  await click(button('Save as reusable topic'))
  assert.deepEqual(calls('saveTopicTemplate'), [['saveTopicTemplate', { name: 'New saved name', text: '新系列 / updates' }]])
  assert.equal(selector().value, 'new-fictional'); assert.equal(topic().value, '  新系列 / updates  '); assert.ok(button('Update saved topic'))
})

test('updating a selected template keeps its identity and updates the displayed name', async () => {
  await change(selector(), 'saved')
  window.prompt = (_label, initial) => { assert.equal(initial, 'Fictional saved topic'); return ' Revised name ' }
  f.handlers.updateTopicTemplate = () => undefined
  await click(button('Update saved topic'))
  assert.deepEqual(calls('updateTopicTemplate'), [['updateTopicTemplate', 'saved', { name: 'Revised name', text: 'Saved 新系列 / updates' }]])
  assert.equal(selector().selectedOptions[0].textContent, 'Revised name'); assert.equal(selector().value, 'saved')
})

test('template write failures preserve selected topic and show original service error', async () => {
  await change(selector(), 'saved'); window.prompt = () => 'Keep name'
  f.handlers.updateTopicTemplate = () => { throw Error('Fictional save failure') }
  await click(button('Update saved topic')); assert.match(host.textContent, /Fictional save failure/)
  assert.equal(selector().value, 'saved'); assert.equal(topic().value, 'Saved 新系列 / updates')
})

test('template deletion respects cancellation and removes only selected template while preserving text', async () => {
  await change(selector(), 'saved'); window.confirm = () => false
  await click(button('Delete saved topic')); assert.equal(calls('deleteTopicTemplate').length, 0)
  window.confirm = message => { assert.match(message, /Fictional saved topic/); return true }
  f.handlers.deleteTopicTemplate = () => undefined
  await click(button('Delete saved topic'))
  assert.deepEqual(calls('deleteTopicTemplate'), [['deleteTopicTemplate', 'saved']])
  assert.equal(selector(), null); assert.equal(topic().value, 'Saved 新系列 / updates'); assert.ok(button('Save as reusable topic'))
})

test('long Unicode master edits persist through audience and refinement-panel toggles', async () => {
  await draft()
  const long = '詳細 — <specification> & application\n'.repeat(80)
  await change(subject(), '新系列 — updated subject'); await change(body(), long)
  await click(host.querySelector('input[value=retail]')); await click(button('Rewrite / fine-tune with AI')); await click(button('Close'))
  assert.equal(subject().value, '新系列 — updated subject'); assert.equal(body().value, long)
  assert.equal(calls('discussDraft').length, 0); assert.equal(calls('createDrafts').length, 0)
})
