import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change } from './daily-drafts-test-harness.mjs'

const calls = name => f.calls.filter(c => c[0] === name)
const input = () => host.querySelector('input[placeholder="e.g. shorter, and mention the summer catalogue"]')
const subject = () => host.querySelector('input[placeholder=Subject]')
const body = () => host.querySelector('textarea[placeholder=Message]')
const remember = () => [...host.querySelectorAll('button[title]')].filter(e => e.title.startsWith('Remember this as a standing rule'))
const enter = async () => { await act(async () => input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))) }
const draft = async () => { await change(host.querySelector('textarea'), '  Fictional QA topic 新系列  '); await click(button('Draft with AI')) }
const open = async () => { await click(button('Rewrite / fine-tune with AI')) }
const send = async message => { await change(input(), message); await click(button('Send')) }

setupDailyDraftsTests(f => {
  f.rules = [{ id: 'active', text: 'Keep facts verified.', status: 'active' }, { id: 'pending', text: 'Unapproved fixture rule.', status: 'pending' }]
  f.handlers.discussDraft = () => ({ reply: 'Fictional refinement reply.', subject: 'Refined fictional subject', body: 'Refined fictional body.' })
  f.handlers.loadBlogProducts = source => [{ id: 'fictional-product', source, name: 'Fictional ' + source + ' product' }]
  f.handlers.authedUser = () => ({ uid: 'fictional-refinement-reviewer' })
  f.handlers.createDraftMemoryRule = ({ text, source, createdBy }) => {
    f.rules = [...f.rules, { id: 'remembered', text, source, createdBy, status: 'pending' }]
    return 'remembered'
  }
  f.handlers.approveDraftMemoryRule = id => { f.rules = f.rules.map(r => r.id === id ? { ...r, status: 'active' } : r) }
})
afterEach(() => assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction', 'createDrafts', 'saveTopicTemplate', 'uploadBytes'].includes(c[0]))))

test('chat is master-gated; opening focuses the input and close/reopen retains unsaved text and master fields', async () => {
  assert.equal(button('Rewrite / fine-tune with AI'), undefined)
  await draft(); await open(); assert.equal(document.activeElement, input())
  assert.equal(input().getAttribute('autocomplete'), 'off'); assert.equal(input().getAttribute('data-lpignore'), 'true')
  await change(input(), '  Keep this unsaved 新系列  '); await click(button('Close')); assert.equal(input(), null)
  await open(); assert.equal(input().value, '  Keep this unsaved 新系列  ')
  assert.equal(subject().value, 'Fictional master subject'); assert.equal(body().value, 'Fictional approved message')
  assert.equal(calls('discussDraft').length, 0)
})

test('blank button/Enter submissions make no AI calls and do not change the master', async () => {
  await draft(); await open(); assert.equal(button('Send').disabled, false)
  await click(button('Send')); await change(input(), '   '); await enter()
  assert.equal(calls('discussDraft').length, 0); assert.equal(input().value, '   ')
  assert.equal(subject().value, 'Fictional master subject'); assert.equal(remember().length, 0)
})

test('button submission preserves exact prompt payload and applies reply/subject/body without sending email', async () => {
  await draft(); await change(subject(), 'Edited QA subject'); await change(body(), 'Edited QA body\n詳細'); await open()
  await send('  Make this concise 新系列.  ')
  assert.deepEqual(calls('discussDraft')[0], ['discussDraft', { productContext: 'Fictional QA topic 新系列', customerContext: '', draftSubject: 'Edited QA subject', draftBody: 'Edited QA body\n詳細', history: [], message: 'Make this concise 新系列.', memory: { globalRules: ['Keep facts verified.'] } }])
  assert.equal(input().value, ''); assert.equal(subject().value, 'Refined fictional subject'); assert.equal(body().value, 'Refined fictional body.')
  assert.match(host.textContent, /You: Make this concise 新系列\./); assert.match(host.textContent, /AI: Fictional refinement reply\./)
  assert.equal(remember().length, 1)
})

test('Enter submission passes ordered history and current master; close/reopen preserves completed conversation', async () => {
  await draft(); await open(); await send('First request')
  await change(subject(), 'Manually revised subject'); await change(input(), ' Second request '); await enter()
  assert.deepEqual(calls('discussDraft')[1][1].history, [{ role: 'user', content: 'First request' }, { role: 'assistant', content: 'Fictional refinement reply.' }])
  assert.equal(calls('discussDraft')[1][1].draftSubject, 'Manually revised subject'); assert.equal(calls('discussDraft')[1][1].message, 'Second request')
  await click(button('Close')); await open(); assert.equal(remember().length, 2)
  assert.match(host.textContent, /Second request/); assert.equal(input().value, '')
})

test('empty topic uses linked product name as context without changing source or master', async () => {
  await click(button('+ Link a product (optional, unlocks its photos)')); await click(button('Fictional range productRange'))
  await draft(); await change(host.querySelector('textarea'), '   '); await open(); await send('Refine the fictional copy')
  assert.equal(calls('discussDraft')[0][1].productContext, 'Fictional range product')
  assert.equal(calls('discussDraft')[0][1].customerContext, '')
})

test('busy state disables button and guards Enter; completed response restores controls', async () => {
  await draft(); await open(); let resolve
  f.handlers.discussDraft = () => new Promise(done => { resolve = done })
  await send('One request'); const busy = [...host.querySelectorAll('button')].find(e => e.disabled && e.querySelector('svg.animate-spin'))
  assert.ok(busy); await click(busy); await change(input(), 'Typed while busy'); await enter()
  assert.equal(calls('discussDraft').length, 1)
  await act(async () => resolve({ reply: 'Completed fictional reply' }))
  assert.equal(button('Send').disabled, false); assert.equal(input().value, ''); assert.equal(remember().length, 1)
})

test('failure preserves input/master/history, displays error and allows an explicit retry', async () => {
  await draft(); await open(); await send('First request')
  f.handlers.discussDraft = () => { throw Error('Fictional provider unavailable') }
  await send('  Retry this text  '); assert.match(host.textContent, /Fictional provider unavailable/)
  assert.equal(input().value, '  Retry this text  '); assert.equal(button('Send').disabled, false); assert.equal(remember().length, 1)
  assert.equal(subject().value, 'Refined fictional subject')
  f.handlers.discussDraft = () => ({ reply: 'Retry succeeded' }); await click(button('Send'))
  assert.equal(calls('discussDraft')[2][1].history.length, 2); assert.equal(remember().length, 2); assert.equal(input().value, '')
  assert.doesNotMatch(host.textContent, /Fictional provider unavailable/)
})

test('reply without revised fields preserves master, and generation consumes the current master unchanged', async () => {
  await draft(); await open(); f.handlers.discussDraft = () => ({ reply: 'Clarification only', subject: '', body: '' })
  await send('Ask one focused question')
  assert.equal(subject().value, 'Fictional master subject'); assert.equal(body().value, 'Fictional approved message')
  await click(button('Generate Drafts'))
  assert.deepEqual(calls('generateDrafts')[0][1], { subject: 'Fictional master subject', body: 'Fictional approved message' })
  assert.match(host.textContent, /Clarification only/)
})

test('response still updates parent state when panel closes while request is pending', async () => {
  await draft(); await open(); let resolve
  f.handlers.discussDraft = () => new Promise(done => { resolve = done })
  await send('Pending request'); await click(button('Close')); assert.equal(input(), null)
  await act(async () => resolve({ reply: 'Finished while closed', body: 'Updated body while closed' }))
  assert.equal(body().value, 'Updated body while closed'); await open()
  assert.match(host.textContent, /Finished while closed/); assert.equal(input().value, ''); assert.equal(button('Send').disabled, false)
})

test('redrafting clears conversation history while preserving current open/input behavior', async () => {
  await draft(); await open(); await send('First request'); await change(input(), 'Unsaved next request')
  await click(button('Draft again'))
  assert.equal(remember().length, 0); assert.equal(input().value, 'Unsaved next request'); assert.ok(button('Close'))
  assert.equal(subject().value, 'Fictional master subject'); assert.equal(body().value, 'Fictional approved message')
})

test('remember user instruction creates a pending rule and only explicit approval includes it in future prompts', async () => {
  await draft(); await open(); await send('Use plain fictional language.')
  await click(remember()[0])
  assert.deepEqual(calls('createDraftMemoryRule'), [['createDraftMemoryRule', { text: 'Use plain fictional language.', source: 'confirmed', createdBy: 'fictional-refinement-reviewer' }]])
  assert.equal(f.rules.find(r => r.id === 'remembered').status, 'pending')
  const row = [...host.querySelectorAll('div')].find(e => e.classList.contains('items-start') && e.textContent.includes('Use plain fictional language.') && [...e.querySelectorAll('button')].some(b => b.textContent.trim() === 'Approve'))
  assert.ok(row); await send('Next refinement')
  assert.deepEqual(calls('discussDraft').at(-1)[1].memory.globalRules, ['Keep facts verified.'])
  await click([...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Approve'))
  await send('After explicit approval')
  assert.deepEqual(calls('discussDraft').at(-1)[1].memory.globalRules, ['Keep facts verified.', 'Use plain fictional language.'])
})

test('remember-rule failure shows original error and leaves conversation/master intact', async () => {
  await draft(); await open(); await send('Remember only after review')
  f.handlers.createDraftMemoryRule = () => { throw Error('Fictional rule write failure') }
  await click(remember()[0]); assert.match(host.textContent, /Fictional rule write failure/)
  assert.equal(remember().length, 1); assert.equal(subject().value, 'Refined fictional subject')
  assert.equal(calls('approveDraftMemoryRule').length, 0); assert.ok(!f.rules.some(r => r.id === 'remembered'))
})
