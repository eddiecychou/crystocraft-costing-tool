import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change, remount } from './daily-drafts-test-harness.mjs'

const toggle = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Draft memory — standing rules'))
const panel = () => toggle().parentElement
const btn = (parent, text) => [...parent.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const row = text => [...panel().querySelectorAll('div')].find(el => el.classList.contains('items-start') && el.textContent.includes(text))
const newRule = () => panel().querySelector('input[placeholder]')
const calls = name => f.calls.filter(c => c[0] === name)
const open = async () => { await click(toggle()) }
const draft = async () => {
  await change(host.querySelector('textarea'), 'Fictional topic')
  await click(button(calls('draftTopic').length ? 'Draft again' : 'Draft with AI'))
  return calls('draftTopic').at(-1)[2].globalRules
}

setupDailyDraftsTests(f => {
  f.rules = [
    { id: 'pending-short', text: 'Use concise sentences.', status: 'pending' },
    { id: 'pending-long', text: 'Ask before making delivery promises or committing to dates that have not yet been confirmed.', status: 'pending' },
    { id: 'active-signoff', text: 'Sign off as Eddie.', status: 'active' },
    { id: 'active-details', text: 'Keep product details accurate.', status: 'active' },
    { id: 'disabled', text: 'Disabled fixture instruction.', status: 'disabled' },
  ]
  const update = (id, patch) => { f.rules = f.rules.map(r => r.id === id ? { ...r, ...patch } : r) }
  f.handlers.authedUser = () => ({ uid: 'fictional-rule-reviewer' })
  f.handlers.createDraftMemoryRule = ({ text, source, createdBy }) => {
    const id = 'new-rule-' + f.rules.length
    f.rules = [...f.rules, { id, text, source, createdBy, status: 'pending' }]
    return id
  }
  f.handlers.approveDraftMemoryRule = id => update(id, { status: 'active' })
  f.handlers.rejectDraftMemoryRule = id => update(id, { status: 'disabled' })
  f.handlers.disableDraftMemoryRule = id => update(id, { status: 'disabled' })
  f.handlers.deleteDraftMemoryRule = id => { f.rules = f.rules.filter(r => r.id !== id) }
  f.handlers.updateDraftMemoryRuleText = (id, text) => update(id, { text: text.trim() })
})

test('collapsed/open panel preserves status groups, count and hidden disabled rules without writes', async () => {
  assert.match(toggle().textContent, /2 pending review/)
  assert.equal(panel().querySelectorAll('input').length, 0)
  await open()
  assert.match(panel().textContent, /Pending — not used in any draft yet/)
  assert.match(panel().textContent, /Active — used in every draft\/rewrite \(2\/8\)/)
  assert.ok(btn(row('Use concise sentences.'), 'Approve'))
  assert.ok(btn(row('Sign off as Eddie.'), 'Edit'))
  assert.ok(!panel().textContent.includes('Disabled fixture instruction.'))
  await click(toggle())
  assert.equal(panel().querySelectorAll('input').length, 0)
  assert.ok(!f.calls.some(c => /^(create|approve|reject|disable|delete|update).*Rule/.test(c[0])))
})

test('empty state and unsaved direct-rule text survive collapse and reopen', async () => {
  f.rules = []; await remount(); await open()
  assert.match(panel().textContent, /None yet — approve a pending rule/)
  assert.match(panel().textContent, /\(0\/8\)/)
  assert.ok(btn(panel(), 'Add').disabled)
  await change(newRule(), '   '); assert.ok(btn(panel(), 'Add').disabled)
  await change(newRule(), '  Keep this unsaved rule 中文  ')
  await click(toggle()); await click(toggle())
  assert.equal(newRule().value, '  Keep this unsaved rule 中文  ')
  assert.equal(calls('createDraftMemoryRule').length, 0)
})

test('direct add uses the original payload and only explicit approval includes the new rule in prompts', async () => {
  await open(); await change(newRule(), '  Use plain text.  '); await click(btn(panel(), 'Add'))
  assert.deepEqual(calls('createDraftMemoryRule'), [['createDraftMemoryRule', { text: 'Use plain text.', source: 'admin', createdBy: 'fictional-rule-reviewer' }]])
  assert.equal(newRule().value, ''); assert.match(toggle().textContent, /3 pending review/)
  assert.deepEqual(await draft(), ['Sign off as Eddie.', 'Keep product details accurate.'])
  assert.equal(calls('approveDraftMemoryRule').length, 0)
  await click(btn(row('Use plain text.'), 'Approve'))
  assert.deepEqual(calls('approveDraftMemoryRule'), [['approveDraftMemoryRule', 'new-rule-5', 'fictional-rule-reviewer']])
  assert.deepEqual(await draft(), ['Sign off as Eddie.', 'Keep product details accurate.', 'Use plain text.'])
  assert.equal(calls('sendPersonalEmail').length, 0)
})

test('Enter adds a pending rule through the same parent handler without approving it', async () => {
  await open(); await change(newRule(), '  Manual link rule  ')
  await act(async () => newRule().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.deepEqual(calls('createDraftMemoryRule')[0], ['createDraftMemoryRule', { text: 'Manual link rule', source: 'admin', createdBy: 'fictional-rule-reviewer' }])
  assert.ok(btn(row('Manual link rule'), 'Approve'))
  assert.equal(calls('approveDraftMemoryRule').length, 0)
})

test('editing retains unsaved text through collapse, cancel discards it, and save keeps the original rule identity', async () => {
  await open(); await click(btn(row('Sign off as Eddie.'), 'Edit'))
  await change(panel().querySelector('input:not([placeholder])'), '  Sign off as Eddie 中文.  ')
  await click(toggle()); await click(toggle())
  assert.equal(panel().querySelector('input:not([placeholder])').value, '  Sign off as Eddie 中文.  ')
  await click(btn(panel(), 'Cancel')); assert.equal(calls('updateDraftMemoryRuleText').length, 0)
  await click(btn(row('Sign off as Eddie.'), 'Edit'))
  assert.equal(panel().querySelector('input:not([placeholder])').value, 'Sign off as Eddie.')
  await change(panel().querySelector('input:not([placeholder])'), '  Revised signoff.  '); await click(btn(panel(), 'Save'))
  assert.deepEqual(calls('updateDraftMemoryRuleText'), [['updateDraftMemoryRuleText', 'active-signoff', '  Revised signoff.  ']])
  assert.equal(panel().querySelector('input:not([placeholder])'), null)
  assert.deepEqual(await draft(), ['Revised signoff.', 'Keep product details accurate.'])
})

test('pending approval busy state disables only that row and prevents repeated clicks', async () => {
  let resolve
  f.handlers.approveDraftMemoryRule = id => new Promise(done => { resolve = () => { f.rules = f.rules.map(r => r.id === id ? { ...r, status: 'active' } : r); done() } })
  await open(); await click(btn(row('Use concise sentences.'), 'Approve'))
  assert.ok(btn(row('Use concise sentences.'), 'Approve').disabled)
  assert.ok(btn(row('Use concise sentences.'), 'Dismiss').disabled)
  assert.ok(!btn(row('Ask before making delivery promises'), 'Approve').disabled)
  await click(btn(row('Use concise sentences.'), 'Approve'))
  assert.equal(calls('approveDraftMemoryRule').length, 1)
  await act(async () => resolve())
  assert.ok(btn(row('Use concise sentences.'), 'Edit'))
})

test('approval-limit failure keeps the pending rule outside prompts and permits retry', async () => {
  const original = f.handlers.approveDraftMemoryRule
  f.handlers.approveDraftMemoryRule = () => { throw Error('Already at the 8-rule limit — disable one before approving another.') }
  await open(); await click(btn(row('Use concise sentences.'), 'Approve'))
  assert.match(host.textContent, /Already at the 8-rule limit/)
  assert.ok(!btn(row('Use concise sentences.'), 'Approve').disabled)
  assert.deepEqual(await draft(), ['Sign off as Eddie.', 'Keep product details accurate.'])
  f.handlers.approveDraftMemoryRule = original
  await click(btn(row('Use concise sentences.'), 'Approve'))
  assert.ok((await draft()).includes('Use concise sentences.'))
})

test('dismissing a pending rule records the reviewer and does not add it to prompts', async () => {
  await open(); await click(btn(row('Use concise sentences.'), 'Dismiss'))
  assert.deepEqual(calls('rejectDraftMemoryRule'), [['rejectDraftMemoryRule', 'pending-short', 'fictional-rule-reviewer']])
  assert.equal(row('Use concise sentences.'), undefined)
  assert.match(toggle().textContent, /1 pending review/)
  assert.deepEqual(await draft(), ['Sign off as Eddie.', 'Keep product details accurate.'])
})

test('disabling an active rule removes it from display and subsequent prompt payloads', async () => {
  await open(); await click(btn(row('Sign off as Eddie.'), 'Disable'))
  assert.deepEqual(calls('disableDraftMemoryRule'), [['disableDraftMemoryRule', 'active-signoff']])
  assert.equal(row('Sign off as Eddie.'), undefined)
  assert.match(panel().textContent, /\(1\/8\)/)
  assert.deepEqual(await draft(), ['Keep product details accurate.'])
})

test('deletion retains the confirmation and only deletes the selected fictional rule after acceptance', async t => {
  const original = window.confirm, prompts = []; let accept = false
  window.confirm = text => { prompts.push(text); return accept }
  t.after(() => { window.confirm = original })
  await open(); await click(btn(row('Sign off as Eddie.'), 'Delete'))
  assert.deepEqual(prompts, ['Delete this rule permanently?']); assert.equal(calls('deleteDraftMemoryRule').length, 0)
  assert.ok(row('Sign off as Eddie.'))
  accept = true; await click(btn(row('Sign off as Eddie.'), 'Delete'))
  assert.deepEqual(calls('deleteDraftMemoryRule'), [['deleteDraftMemoryRule', 'active-signoff']])
  assert.ok(row('Keep product details accurate.')); assert.equal(row('Sign off as Eddie.'), undefined)
})

test('add and edit failures preserve unsaved inputs for explicit correction and retry', async () => {
  f.handlers.createDraftMemoryRule = () => { throw Error('Fictional add failed') }
  f.handlers.updateDraftMemoryRuleText = () => { throw Error('Fictional edit failed') }
  await open(); await change(newRule(), 'Keep the new rule'); await click(btn(panel(), 'Add'))
  assert.match(host.textContent, /Fictional add failed/); assert.equal(newRule().value, 'Keep the new rule')
  await click(btn(row('Sign off as Eddie.'), 'Edit'))
  await change(panel().querySelector('input:not([placeholder])'), 'Keep the edited rule'); await click(btn(panel(), 'Save'))
  assert.match(host.textContent, /Fictional edit failed/)
  assert.equal(panel().querySelector('input:not([placeholder])').value, 'Keep the edited rule')
  assert.deepEqual(await draft(), ['Sign off as Eddie.', 'Keep product details accurate.'])
})

test('rule-load failure retains the original independent page loading behavior', async () => {
  f.handlers.listDraftMemoryRules = () => { throw Error('Fictional read failed') }
  await remount(); await open()
  assert.match(panel().textContent, /\(0\/8\)/)
  assert.ok(button('Draft with AI')); assert.match(host.textContent, /Pending review \(0\)/)
  assert.deepEqual(await draft(), [])
  assert.equal(calls('sendPersonalEmail').length, 0)
})
