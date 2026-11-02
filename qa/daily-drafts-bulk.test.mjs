import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change, remount } from './daily-drafts-test-harness.mjs'

const section = () => [...host.querySelectorAll('h2')].find(e => e.textContent.startsWith('Pending review (')).parentElement.parentElement
const cards = () => [...section().querySelectorAll(':scope > .card')]
const card = id => cards().find(e => e.textContent.includes(id === 'lead' ? 'Fictional Lead' : 'Fictional Customer'))
const btn = (parent, text) => [...parent.querySelectorAll('button')].find(e => e.textContent.trim() === text)
const input = () => section().querySelector('input[name=bulk-rewrite-input]')
const calls = name => f.calls.filter(c => c[0] === name)
const open = async () => { await click(button('Bulk rewrite')) }
const enter = async () => { await act(async () => input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))) }
const clock = t => { t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => t.mock.timers.reset()) }

setupDailyDraftsTests(f => {
  f.pending = [
    { id: 'bulk-customer', customerId: 'customer-1', source: 'customer', customerName: 'Fictional Customer', customerEmail: 'customer@example.test', customerContext: 'Customer context', productName: 'Fictional product', topicLabel: 'Fictional topic', draftSubject: 'Customer subject', draftBody: 'Customer body', imageUrls: ['https://assets.example.test/original.png'], links: [{ title: 'Original link', url: 'https://example.test/original' }] },
    { id: 'bulk-lead', customerId: 'lead-1', source: 'contact', customerName: 'Fictional Lead', customerEmail: 'lead@example.test', customerContext: 'Lead context', topicLabel: 'Fictional topic', draftSubject: 'Lead subject', draftBody: 'Lead body', memory_conclusions: ['Keep these details'] },
  ]
  f.rules = [{ id: 'active', text: 'Verified facts only.', status: 'active' }, { id: 'pending', text: 'Not approved.', status: 'pending' }]
  f.handlers.getDoc = () => ({ exists: () => true, data: () => ({ ai_context_summary: 'Fresh fictional lead summary' }) })
  f.handlers.discussDraft = p => ({ reply: 'Fictional bulk reply', subject: p.customerContext === 'Lead context' ? 'New lead subject' : null, body: p.customerContext === 'Customer context' ? 'New customer body' : null })
  f.handlers.authedUser = () => ({ uid: 'fictional-bulk-reviewer' })
  f.handlers.skipDraft = () => undefined
  f.handlers.deleteAllPending = () => { f.pending = [] }
})
afterEach(() => {
  window.confirm = () => { throw Error('Unexpected confirmation') }
  assert.ok(!f.calls.some(c => ['sendPersonalEmail', 'markDraftSent', 'addInteraction', 'updateDoc', 'saveCustomer', 'createDrafts', 'uploadBytes', 'createDraftMemoryRule'].includes(c[0])))
})

test('empty queue hides bulk/clear controls and populated queue preserves count/plural copy', async () => {
  assert.ok(button('Bulk rewrite')); assert.ok(button('Clear all pending')); await open(); assert.match(section().textContent, /Applies to all 2 pending drafts/)
  f.pending = [f.pending[0]]; await remount(); await open(); assert.match(section().textContent, /Applies to all 1 pending draft —/)
  f.pending = []; await remount(); assert.equal(button('Bulk rewrite'), undefined); assert.equal(button('Clear all pending'), undefined); assert.equal(input(), null)
  assert.match(section().textContent, /Pending review \(0\)/); assert.match(section().textContent, /No drafts waiting/)
})
test('opening focuses the editor, retains unsaved text through toggle, and blank submissions do nothing', async () => {
  await open(); assert.equal(document.activeElement, input()); assert.equal(input().getAttribute('data-dashlane-ignore'), 'true')
  assert.ok(button('Apply to all').disabled); await change(input(), '   '); await enter(); assert.equal(calls('discussDraft').length, 0)
  await change(input(), '  Unsaved instruction 新系列  '); await open(); assert.equal(input(), null); await open()
  assert.equal(input().value, '  Unsaved instruction 新系列  '); assert.equal(calls('deleteAllPending').length, 0)
})
test('button rewrite preserves prompt/context/history/memory contracts and changes only returned fields', async t => {
  clock(t)
  await change(card('customer').querySelector('input'), 'Edited customer subject'); await change(card('lead').querySelector('textarea'), 'Edited lead body')
  await click(btn(card('customer'), 'Discuss with AI'))
  const chat = card('customer').querySelector('textarea[name=daily-drafts-chat-input]')
  await change(chat, 'Earlier request'); await click(btn(chat.parentElement, 'Send'))
  await open(); await change(input(), '  Keep this concise 新系列  '); await click(button('Apply to all'))
  assert.deepEqual(calls('discussDraft')[1][1], { productContext: 'Fictional product', customerContext: 'Customer context', draftSubject: 'Edited customer subject', draftBody: 'New customer body', history: [{ role: 'user', content: 'Earlier request' }, { role: 'assistant', content: 'Fictional bulk reply', applied: true }], message: 'Keep this concise 新系列', memory: { globalRules: ['Verified facts only.'], contactSummary: '', recentConclusions: [] } })
  assert.deepEqual(calls('discussDraft')[2][1], { productContext: 'Fictional topic', customerContext: 'Lead context', draftSubject: 'Lead subject', draftBody: 'Edited lead body', history: [], message: 'Keep this concise 新系列', memory: { globalRules: ['Verified facts only.'], contactSummary: 'Fresh fictional lead summary', recentConclusions: ['Keep these details'] } })
  assert.equal(card('customer').querySelector('input').value, 'Edited customer subject'); assert.equal(card('lead').querySelector('textarea').value, 'Edited lead body'); assert.equal(card('lead').querySelector('input').value, 'New lead subject')
  assert.equal(card('customer').querySelector('img').src, 'https://assets.example.test/original.png'); assert.match(card('customer').textContent, /Original link/)
  assert.equal(input().value, ''); assert.match(section().textContent, /Rewrote 2 of 2/)
})
test('Enter starts sequential work; busy button/Enter do not duplicate and progress tracks completion', async t => {
  clock(t); let first, second
  f.handlers.discussDraft = p => new Promise(resolve => { if (p.customerContext === 'Customer context') first = resolve; else second = resolve })
  await open(); await change(input(), 'One batch'); await enter()
  assert.equal(calls('discussDraft').length, 1); assert.match(section().textContent, /Rewrote 0 of 2/)
  const busy = [...section().querySelectorAll('button')].find(e => e.disabled && e.querySelector('svg.animate-spin'))
  assert.ok(busy); await click(busy); await enter(); assert.equal(calls('discussDraft').length, 1)
  await act(async () => first({ reply: 'First completed', body: 'First new body' }))
  assert.equal(calls('discussDraft').length, 2); assert.match(section().textContent, /Rewrote 1 of 2/)
  await act(async () => second({ reply: 'Second completed', subject: 'Second new subject' }))
  assert.equal(button('Apply to all').disabled, true); assert.equal(input().value, ''); assert.match(section().textContent, /Rewrote 2 of 2/)
})
test('in-flight rewrite preserves unrelated edits made while earlier network work is pending', async t => {
  clock(t); let first
  f.handlers.discussDraft = p => p.customerContext === 'Customer context' ? new Promise(resolve => { first = resolve }) : { reply: 'Second completed', body: 'New lead body' }
  await open(); await change(input(), 'Rewrite body only'); await click(button('Apply to all'))
  await change(card('lead').querySelector('input'), 'Late local subject')
  await act(async () => first({ reply: 'First completed', body: 'New customer body' }))
  assert.equal(card('lead').querySelector('input').value, 'Late local subject'); assert.equal(card('lead').querySelector('textarea').value, 'New lead body')
  assert.match(card('customer').textContent, /Original link/)
})
test('partial failure continues, preserves failed draft, reports count and allows a full explicit retry', async t => {
  clock(t); f.handlers.discussDraft = p => { if (p.customerContext === 'Customer context') throw Error('Fictional provider failure'); return { reply: 'Lead done', body: 'Lead changed' } }
  await open(); await change(input(), 'First batch'); await click(button('Apply to all'))
  assert.equal(calls('discussDraft').length, 2); assert.equal(card('customer').querySelector('textarea').value, 'Customer body'); assert.equal(card('lead').querySelector('textarea').value, 'Lead changed')
  assert.match(section().textContent, /1 of 2 draft\(s\) could not be rewritten — the rest were updated/)
  f.handlers.discussDraft = () => ({ reply: 'Retry completed', body: 'Retry body' }); await change(input(), 'Retry batch'); await click(button('Apply to all'))
  assert.equal(calls('discussDraft').length, 4); assert.doesNotMatch(section().textContent, /could not be rewritten/); assert.equal(card('customer').querySelector('textarea').value, 'Retry body')
})
test('closing bulk editor during work retains parent updates/history and reopens completed progress', async t => {
  clock(t); let first
  f.handlers.discussDraft = p => p.customerContext === 'Customer context' ? new Promise(resolve => { first = resolve }) : { reply: 'Lead complete', subject: 'Lead after close' }
  await open(); await change(input(), 'Continue while closed'); await click(button('Apply to all')); await open(); assert.equal(input(), null)
  await act(async () => first({ reply: 'Customer complete', body: 'Customer after close' })); await open()
  assert.match(section().textContent, /Rewrote 2 of 2/); assert.equal(card('lead').querySelector('input').value, 'Lead after close')
  await click(btn(card('lead'), 'Discuss with AI')); assert.match(card('lead').textContent, /Continue while closed/)
})
test('target snapshot stays stable when another draft is skipped during the batch', async t => {
  clock(t); let first
  f.handlers.discussDraft = p => p.customerContext === 'Customer context' ? new Promise(resolve => { first = resolve }) : { reply: 'Original target complete', body: 'Completed snapshot' }
  await open(); await change(input(), 'Original snapshot'); await click(button('Apply to all')); await click(btn(card('lead'), 'Skip'))
  assert.equal(cards().length, 1); await act(async () => first({ reply: 'First done', body: 'First updated' }))
  assert.equal(calls('discussDraft').length, 2); assert.equal(calls('discussDraft')[1][1].customerContext, 'Lead context'); assert.equal(cards().length, 1)
  assert.match(section().textContent, /Rewrote 2 of 2/)
})
test('completion progress expires after two seconds while partial-error feedback remains', async t => {
  clock(t); f.handlers.discussDraft = () => { throw Error('Fictional unavailable provider') }
  await open(); await change(input(), 'Fictional failed batch'); await click(button('Apply to all'))
  await act(async () => t.mock.timers.tick(1999)); assert.match(section().textContent, /Rewrote 2 of 2/)
  await act(async () => t.mock.timers.tick(1)); assert.doesNotMatch(section().textContent, /Rewrote 2 of 2/); assert.match(section().textContent, /2 of 2 draft\(s\) could not be rewritten/)
})
test('Clear cancellation preserves every draft and unsaved edit without a delete call', async () => {
  await change(card('customer').querySelector('input'), 'Keep this edited subject')
  window.confirm = text => { assert.equal(text, "Delete all 2 pending drafts? This can't be undone — use this for clearing out test/duplicate runs, not for real review."); return false }
  await click(button('Clear all pending')); assert.equal(calls('deleteAllPending').length, 0); assert.equal(cards().length, 2); assert.equal(card('customer').querySelector('input').value, 'Keep this edited subject')
})
test('confirmed fictional Clear reloads the queue and hides bulk controls without sending', async () => {
  window.confirm = () => true; await open(); await change(input(), 'Unsaved instruction'); await click(button('Clear all pending'))
  assert.equal(calls('deleteAllPending').length, 1); assert.equal(cards().length, 0); assert.equal(input(), null); assert.equal(button('Clear all pending'), undefined); assert.match(section().textContent, /No drafts waiting/)
  assert.equal(calls('listPendingDrafts').length, 2)
})
test('failed fictional Clear keeps queue/editor/edits and exposes error for retry', async () => {
  window.confirm = () => true; f.handlers.deleteAllPending = () => { throw Error('Fictional delete failure') }
  await open(); await change(input(), 'Keep unsaved instruction'); await click(button('Clear all pending'))
  assert.equal(cards().length, 2); assert.equal(input().value, 'Keep unsaved instruction'); assert.match(host.textContent, /Fictional delete failure/); assert.ok(button('Clear all pending'))
})
