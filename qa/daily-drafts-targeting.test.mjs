import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change } from './daily-drafts-test-harness.mjs'

const panel = () => [...host.querySelectorAll('h2')].find(e => e.textContent === '2. Who do you want to reach?').parentElement
const targeting = () => panel().querySelector('input:not([type])')
const includePrior = () => [...panel().querySelectorAll('label')].find(el => el.textContent.includes('Include people already contacted')).querySelector('input')
const readyMaster = async () => {
  await change(host.querySelector('textarea'), '  Fictional topic  ')
  await click(button('Draft with AI'))
}
const generated = () => f.calls.filter(c => c[0] === 'generateDrafts').at(-1)
const candidateIds = () => generated()[3].map(c => c.id).sort()

setupDailyDraftsTests()

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

const contactMode=()=>panel().querySelector('select')
const daysAgo=n=>new Date(Date.now()-n*86400000).toISOString()
test('quiet 90 mode uses real recorded contact dates before the candidate cap, excludes B2C/leads and never sends',async()=>{
 f.contacts=Array.from({length:75},(_,i)=>({id:'lead'+i,status:'subscribed',emailable:true,audiences:['trade'],tags:[],email:'lead'+i+'@example.test'}))
 f.customers.push({id:'unknown',company_name:'Unknown history',contacts:[{email:'unknown@example.test'}]})
 f.handlers.fetchCustomerActivity=async()=>({checkedAt:new Date().toISOString(),customers:[{customerId:'trade',lastContactAt:daysAgo(120),historyState:'known'},{customerId:'gift',lastContactAt:daysAgo(10),historyState:'known'},{customerId:'retail',lastContactAt:daysAgo(180),historyState:'known'},{customerId:'unknown',lastContactAt:null,historyState:'unknown'}]})
 await readyMaster();await change(contactMode(),'quiet90');assert.equal(generated(),undefined)
 await click(button('Generate Drafts'));assert.deepEqual(candidateIds(),['trade']);assert.match(panel().textContent,/Unknown or partial histories are excluded/)
 assert.ok(!f.calls.some(c=>['sendPersonalEmail','markDraftSent','addInteraction'].includes(c[0])))
})
test('quiet history failure preserves composer, stops generation, and never falls back to normal audience',async()=>{
 f.handlers.fetchCustomerActivity=async()=>{throw Error('Fictional history unavailable')}
 await readyMaster();await change(targeting(),'Keep this targeting');await change(contactMode(),'quiet90');await click(button('Generate Drafts'))
 assert.equal(generated(),undefined);assert.equal(targeting().value,'Keep this targeting');assert.equal(host.querySelector('input[placeholder=Subject]').value,'Fictional master subject');assert.match(host.textContent,/Fictional history unavailable/)
})
test('quiet mode preserves outreach/topic cooldowns and includes current work in the reviewed draft context',async()=>{
 f.customers.find(c=>c.id==='trade').sales_pipeline={status:'active',detail:'A long-running custom sample request'}
 f.handlers.fetchCustomerActivity=async()=>({customers:[{customerId:'trade',lastContactAt:daysAgo(120),historyState:'known'},{customerId:'gift',lastContactAt:daysAgo(120),historyState:'partial'}]})
 f.prior=[{id:'prior',parentId:'trade',date:{toDate:()=>new Date()}}]
 await readyMaster();await change(contactMode(),'quiet90');await click(button('Generate Drafts'));assert.equal(generated(),undefined,'Topic exclusion remains in force')
 await click(includePrior());await click(button('Generate Drafts'));assert.deepEqual(candidateIds(),['trade']);assert.match(generated()[3][0].notes,/long-running custom sample/)
})
