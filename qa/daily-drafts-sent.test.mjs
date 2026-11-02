import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, click, change, remount } from './daily-drafts-test-harness.mjs'

setupDailyDraftsTests(f => {
  f.sent = [
    { id: 'customer-draft', customerId: 'fictional-customer', customerName: 'Fictional company 中文', source: 'customer', productName: 'Cup & saucer', engagement: { delivered: true, opened: true, complained: true } },
    { id: 'lead-draft', customerId: 'fictional-lead', customerName: 'Fictional lead', source: 'contact', topicLabel: 'Spring samples', engagement: { clicked: true, bounced: true } },
    { id: 'replied-draft', customerName: 'Already replied', topicLabel: 'Earlier topic', repliedAt: new Date('2026-10-01'), repliedChannel: 'Email' },
  ]
  f.handlers.markDraftReplied = async () => {}
  f.handlers.addInteraction = async () => {}
})
const section = () => [...host.querySelectorAll('h2')].find(e => e.textContent.startsWith('Sent (')).parentElement
const cards = () => [...section().querySelectorAll(':scope > .card')]
const btn = (card, text) => [...card.querySelectorAll('button')].find(e => e.textContent.trim() === text)
const calls = name => f.calls.filter(c => c[0] === name)

test('empty sent history has its original message and no reply actions', async () => {
  f.sent = []; await remount()
  assert.match(section().textContent, /Sent \(0\).*Nothing sent yet\./s)
  assert.equal(section().querySelectorAll('button').length, 0)
})
test('sent rows retain order, source labels, all five engagement states and replied status', () => {
  assert.match(section().textContent, /Sent \(3\)/)
  assert.match(cards()[0].textContent, /Fictional company 中文.*Cup & saucer.*Customer/s)
  assert.match(cards()[1].textContent, /Fictional lead.*Spring samples.*Lead/s)
  for (const [label, color] of [['Delivered', 'bg-green-50'], ['Opened', 'bg-green-50'], ['Clicked', 'bg-ivory'], ['Bounced', 'bg-ivory'], ['Complained', 'bg-red-50']]) {
    const badge = [...cards()[0].querySelectorAll('span')].find(e => e.textContent.trim() === label)
    assert.ok(badge.classList.contains(color), label)
  }
  assert.match(cards()[2].textContent, /Replied via Email/)
  assert.equal(cards()[2].querySelector('button'), null)
})
test('opening/cancelling and switching reply forms retains each draft’s own text/channel without writes', async () => {
  await click(btn(cards()[0], 'Log a reply')); await click(btn(cards()[0], 'WeChat'))
  await change(cards()[0].querySelector('textarea'), 'First reply\nsecond line')
  await click(btn(cards()[0], 'Cancel')); assert.equal(section().querySelector('textarea'), null)
  await click(btn(cards()[1], 'Log a reply'))
  assert.equal(cards()[1].querySelector('textarea').value, '')
  assert.ok(btn(cards()[1], 'Personal WhatsApp').classList.contains('border-brand-600'))
  await click(btn(cards()[0], 'Log a reply'))
  assert.equal(section().querySelectorAll('textarea').length, 1)
  assert.equal(cards()[0].querySelector('textarea').value, 'First reply\nsecond line')
  assert.ok(btn(cards()[0], 'WeChat').classList.contains('border-brand-600'))
  assert.deepEqual(calls('markDraftReplied'), []); assert.deepEqual(calls('addInteraction'), [])
})
test('blank optional reply uses Personal WhatsApp and preserves the customer/product fallback payload', async () => {
  await click(btn(cards()[0], 'Log a reply')); await click(btn(cards()[0], 'Log reply'))
  assert.deepEqual(calls('markDraftReplied'), [['markDraftReplied', 'customer-draft', { channel: 'Personal WhatsApp', replyText: '' }]])
  assert.deepEqual(calls('addInteraction'), [['addInteraction', 'customers', 'fictional-customer', { description: 'Replied via Personal WhatsApp', channel: 'Personal WhatsApp', productInterest: 'Cup & saucer' }]])
  assert.match(cards()[0].textContent, /Replied via Personal WhatsApp/)
  assert.equal(cards()[0].querySelector('button'), null)
  assert.equal(calls('sendPersonalEmail').length, 0)
})
test('lead reply trims text, preserves channel/topic and targets the lead interaction log only', async () => {
  await click(btn(cards()[1], 'Log a reply')); await click(btn(cards()[1], 'Alibaba'))
  await change(cards()[1].querySelector('textarea'), '  Please send the drawings 中文  ')
  await click(btn(cards()[1], 'Log reply'))
  assert.deepEqual(calls('markDraftReplied'), [['markDraftReplied', 'lead-draft', { channel: 'Alibaba', replyText: 'Please send the drawings 中文' }]])
  assert.deepEqual(calls('addInteraction'), [['addInteraction', 'marketing_contacts', 'fictional-lead', { description: 'Replied via Alibaba: Please send the drawings 中文', channel: 'Alibaba', productInterest: 'Spring samples' }]])
  assert.match(cards()[1].textContent, /Replied via Alibaba/)
  assert.equal(calls('sendPersonalEmail').length, 0)
})
test('busy reply prevents a second submission and successful completion closes only that form', async () => {
  let resolve
  f.handlers.markDraftReplied = () => new Promise(done => { resolve = done })
  await click(btn(cards()[0], 'Log a reply')); await click(btn(cards()[0], 'Log reply'))
  assert.ok(btn(cards()[0], 'Log reply').disabled)
  await click(btn(cards()[0], 'Log reply')); assert.equal(calls('markDraftReplied').length, 1)
  await act(async () => resolve())
  assert.equal(cards()[0].querySelector('textarea'), null)
  assert.ok(btn(cards()[1], 'Log a reply'))
  assert.equal(calls('addInteraction').length, 1)
})
test('failed draft update keeps form/text/channel and permits an explicit retry without a CRM write', async () => {
  f.handlers.markDraftReplied = async () => { throw Error('Fictional draft update failed') }
  await click(btn(cards()[1], 'Log a reply')); await click(btn(cards()[1], 'Email'))
  await change(cards()[1].querySelector('textarea'), 'Keep this reply')
  await click(btn(cards()[1], 'Log reply'))
  assert.match(host.textContent, /Fictional draft update failed/)
  assert.equal(calls('addInteraction').length, 0)
  assert.equal(cards()[1].querySelector('textarea').value, 'Keep this reply')
  assert.ok(!btn(cards()[1], 'Log reply').disabled)
  f.handlers.markDraftReplied = async () => {}; await click(btn(cards()[1], 'Log reply'))
  assert.match(cards()[1].textContent, /Replied via Email/)
  assert.equal(calls('addInteraction').length, 1)
})
test('failed CRM logging retains the original retry behaviour and does not claim the UI reply is completed', async () => {
  f.handlers.addInteraction = async () => { throw Error('Fictional CRM unavailable') }
  await click(btn(cards()[0], 'Log a reply')); await change(cards()[0].querySelector('textarea'), 'Keep this text')
  await click(btn(cards()[0], 'Log reply'))
  assert.match(host.textContent, /Fictional CRM unavailable/)
  assert.equal(cards()[0].querySelector('textarea').value, 'Keep this text')
  assert.doesNotMatch(cards()[0].textContent, /Replied via/)
  f.handlers.addInteraction = async () => {}; await click(btn(cards()[0], 'Log reply'))
  assert.equal(calls('markDraftReplied').length, 2); assert.equal(calls('addInteraction').length, 2)
  assert.match(cards()[0].textContent, /Replied via Personal WhatsApp/)
})
