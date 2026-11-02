import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import { setupDailyDraftsTests, host, f, button, click, change, changeFiles, remount } from './daily-drafts-test-harness.mjs'

const section = () => [...host.querySelectorAll('h2')].find(e => e.textContent.startsWith('Pending review (')).parentElement.parentElement
const cards = () => [...section().querySelectorAll(':scope > .card')]
const card = id => cards().find(e => e.textContent.includes(id === 'lead' ? 'Fictional Lead' : 'Fictional Customer'))
const btn = (parent, text) => [...parent.querySelectorAll('button')].find(e => e.textContent.trim() === text)
const calls = name => f.calls.filter(c => c[0] === name)
const field = (id, kind) => card(id).querySelector(kind === 'subject' ? 'input' : 'textarea')
const chat = id => card(id).querySelector('textarea[name=daily-drafts-chat-input]')
const enter = async (el, shiftKey = false) => { await act(async () => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }))) }
const readyChat = async (id, text) => { await click(btn(card(id), 'Discuss with AI')); await change(chat(id), text) }
const gallery = id => [...card(id).querySelectorAll('button')].filter(e => e.querySelector('img'))

setupDailyDraftsTests(f => {
  f.pending = [
    { id: 'pending-customer', source: 'customer', customerId: 'customer-1', customerName: 'Fictional Customer 中文', customerEmail: 'customer@example.test', customerContext: 'Fictional customer context', topicLabel: 'Fictional topic', productId: 'shared-product', productSource: 'corporate', productName: 'Fictional Corporate Product', draftSubject: 'Subject customer', draftBody: 'Body customer', imageUrls: ['https://assets.example.test/original.png'], blogLink: { title: 'Original legacy link', url: 'https://example.test/original' }, fitScore: 0.915, fitReason: 'Fictional matching reason', contextSources: ['email', 'whatsapp', 'notes', 'invoices', 'memory'], whatsapp_personal: '+1 202 555 0101', whatsapp_business: '+1 202 555 0102' },
    { id: 'pending-lead', source: 'contact', customerId: 'lead-1', customerName: 'Fictional Lead', customerEmail: 'lead@example.test', customerContext: 'Fictional lead context', topicLabel: 'Fictional topic', draftSubject: 'Subject lead', draftBody: 'Body lead', memory_conclusions: ['Keep specific'], whatsapp: '+1 202 555 0103' },
  ]
  f.rules = [{ id: 'active', text: 'Use verified facts.', status: 'active' }, { id: 'pending-rule', text: 'Not approved.', status: 'pending' }]
  f.lead = { email: 'lead@example.test', first_name: 'Fictional', last_name: 'Lead', company: 'Fictional lead company', phone: '+1 202 555 0103', ai_context_summary: 'Fictional contact summary' }
  f.handlers.authedUser = () => ({ uid: 'fictional-reviewer', email: 'reviewer@example.test' })
  f.handlers.sendPersonalEmail = () => undefined
  f.handlers.markDraftSent = () => undefined
  f.handlers.markContactOutreach = () => undefined
  f.handlers.skipDraft = () => undefined
  f.handlers.blockContactOutreach = () => undefined
  f.handlers.addInteraction = () => undefined
  f.handlers.serverTimestamp = () => 'fictional-server-time'
  f.handlers.updateDoc = () => undefined
  f.handlers.getDoc = ref => ({ id: ref.path.split('/').at(-1), exists: () => true, data: () => ref.path.startsWith('marketing_contacts/') ? f.lead : { notes: 'Existing fictional notes' } })
  f.handlers.loadBlogProducts = source => [{ id: 'shared-product', source, name: 'Fictional ' + source + ' product' }]
  f.handlers.loadBlogImages = source => [{ id: 'public', file_url: 'https://assets.example.test/' + source + '-public.png', visibility: 'public' }, { id: 'legacy', file_url: 'https://assets.example.test/' + source + '-legacy.png' }, { id: 'private', file_url: 'https://assets.example.test/private.png', visibility: 'private' }]
  f.handlers.ref = (_storage, path) => ({ path })
  f.handlers.uploadBytes = () => undefined
  f.handlers.getDownloadURL = () => 'https://assets.example.test/upload.png'
  f.handlers.discussDraft = () => ({ reply: 'Updated fictional copy.', subject: 'Revised subject', body: 'Revised body' })
  f.handlers.promoteContactsToCustomers = () => ({ created: [{ companyName: 'Fictional new company', historyWarning: true }], skipped: [] })
  f.handlers.getCustomer = id => ({ id, company_name: 'Fictional existing company', country: 'HK', contacts: [{ name: 'Existing primary', email: 'primary@example.test', is_primary: true }] })
  f.handlers.saveCustomer = () => ({ ok: true })
  f.handlers.linkContactToCustomer = () => ({ historyWarning: false })
  f.handlers.appendMemoryConclusion = (_id, prior, text) => [...prior, text.trim()]
  f.handlers.createDraftMemoryRule = () => 'fictional-new-rule'
})
afterEach(() => { window.confirm = () => { throw Error('Unexpected confirmation') } })

test('pending cards preserve order, source/context badges, fit, legacy link and empty state', async () => {
  assert.equal(cards().length, 2); assert.match(cards()[0].textContent, /Fictional Customer 中文/)
  for (const text of ['fit 92%', 'Email history', 'WhatsApp history', 'CRM notes', 'Recent orders', 'Memory', 'Original legacy link']) assert.match(cards()[0].textContent, new RegExp(text))
  assert.ok(btn(card('lead'), 'Add to Customers')); assert.equal(btn(card('customer'), 'Add to Customers'), undefined)
  f.pending = []; await remount(); assert.equal(cards().length, 0); assert.match(section().textContent, /No drafts waiting/)
})
test('edits and per-card chat/link inputs stay isolated across opening another card', async () => {
  await change(field('customer', 'subject'), 'Edited 中文 subject'); await change(field('lead', 'body'), 'Edited lead body')
  await readyChat('customer', 'Keep customer input'); await readyChat('lead', 'Keep lead input')
  await click(btn(card('customer'), 'Discuss with AI')); assert.equal(chat('customer').value, 'Keep customer input')
  assert.equal(field('customer', 'subject').value, 'Edited 中文 subject'); assert.equal(field('lead', 'body').value, 'Edited lead body')
  assert.equal(calls('discussDraft').length, 0); assert.equal(calls('sendPersonalEmail').length, 0)
})
for (const source of ['customer', 'lead']) test(source + ' Send preserves edited content/attachments and exact recipient/write targets', async () => {
  await change(field(source, 'subject'), 'Edited ' + source); await change(field(source, 'body'), 'Body 中文')
  await click(btn(card(source), 'Send'))
  const expectedId = source === 'lead' ? 'lead-1' : 'customer-1'
  const send = calls('sendPersonalEmail')[0][1]
  assert.equal(send.customerEmail, source + '@example.test'); assert.equal(send.subject, 'Edited ' + source); assert.equal(send.body, 'Body 中文')
  assert.equal(send.draftId, 'pending-' + source); assert.equal(send.recipientKind, source === 'lead' ? 'contact' : 'customer'); assert.equal(send.recipientId, expectedId)
  assert.deepEqual(send.imageUrls, source === 'lead' ? [] : ['https://assets.example.test/original.png'])
  assert.deepEqual(send.links, source === 'lead' ? [] : [{ title: 'Original legacy link', url: 'https://example.test/original' }])
  assert.deepEqual(calls('markDraftSent')[0], ['markDraftSent', 'pending-' + source, 'fictional-reviewer'])
  assert.equal(calls('addInteraction')[0][1], source === 'lead' ? 'marketing_contacts' : 'customers'); assert.equal(calls('addInteraction')[0][2], expectedId)
  assert.equal(calls('addInteraction')[0][3].channel, 'Email'); assert.equal(cards().length, 1)
  if (source === 'lead') { assert.deepEqual(calls('markContactOutreach')[0], ['markContactOutreach', 'lead-1']); assert.equal(calls('updateDoc').length, 0) }
  else assert.deepEqual(calls('updateDoc')[0], ['updateDoc', { path: 'customers/customer-1' }, { lastOutreachAt: 'fictional-server-time' }])
})
test('busy Send blocks another click; failed send retains edits and permits retry without early writes', async () => {
  let reject; f.handlers.sendPersonalEmail = () => new Promise((_done, fail) => { reject = fail })
  await change(field('customer', 'body'), 'Keep these edits'); await click(btn(card('customer'), 'Send'))
  await click(btn(card('customer'), 'Sending…')); assert.equal(calls('sendPersonalEmail').length, 1); assert.ok(btn(card('customer'), 'Skip').disabled)
  assert.equal(btn(card('lead'), 'Send').disabled, false); await act(async () => reject(Error('Fictional send failure')))
  assert.match(host.textContent, /Fictional send failure/); assert.equal(field('customer', 'body').value, 'Keep these edits'); assert.equal(calls('markDraftSent').length, 0)
  f.handlers.sendPersonalEmail = () => undefined; await click(btn(card('customer'), 'Send')); assert.equal(calls('markDraftSent').length, 1)
})
test('test email targets QA sender only, leaves pending/writes untouched and badge expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => t.mock.timers.reset())
  await click(btn(card('customer'), 'Send test to myself'))
  assert.deepEqual(calls('sendPersonalEmail')[0][1], { customerEmail: 'reviewer@example.test', subject: '[TEST] Subject customer', body: 'Body customer', imageUrls: ['https://assets.example.test/original.png'], links: [{ title: 'Original legacy link', url: 'https://example.test/original' }] })
  assert.equal(cards().length, 2); assert.match(card('customer').textContent, /Test sent — check your inbox/)
  assert.equal(calls('markDraftSent').length + calls('addInteraction').length + calls('updateDoc').length, 0)
  await act(async () => t.mock.timers.tick(5000)); assert.doesNotMatch(card('customer').textContent, /Test sent — check your inbox/)
})
test('missing test-sender identity refuses any send', async () => {
  f.handlers.authedUser = () => ({ uid: 'fictional-reviewer' }); await click(btn(card('customer'), 'Send test to myself'))
  assert.match(host.textContent, /Could not determine your own sign-in email/); assert.equal(calls('sendPersonalEmail').length, 0)
})
test('Skip preserves reviewer/reason, needs no confirmation and removes only that card', async () => {
  window.confirm = () => { throw Error('Skip must not prompt') }; await click(btn(card('lead'), 'Skip'))
  assert.deepEqual(calls('skipDraft'), [['skipDraft', 'pending-lead', 'fictional-reviewer', '']]); assert.equal(cards().length, 1); assert.equal(calls('sendPersonalEmail').length, 0)
})
test('failed Skip keeps card and restores action buttons', async () => {
  f.handlers.skipDraft = () => { throw Error('Fictional skip failure') }; await click(btn(card('lead'), 'Skip'))
  assert.equal(cards().length, 2); assert.match(host.textContent, /Fictional skip failure/); assert.equal(btn(card('lead'), 'Send').disabled, false)
})
for (const source of ['customer', 'lead']) test(source + ' Already in contact preserves 90-day block and skip targets', async () => {
  const before = Date.now(); await click(btn(card(source), 'Already in contact')); const after = Date.now()
  const until = source === 'lead' ? calls('blockContactOutreach')[0][2] : calls('updateDoc')[0][2].blockOutreachUntil
  assert.ok(until.getTime() >= before + 90 * 86400000 && until.getTime() <= after + 90 * 86400000)
  assert.deepEqual(calls('skipDraft')[0], ['skipDraft', 'pending-' + source, 'fictional-reviewer', 'Already in direct contact — paused 90 days'])
  assert.equal(cards().length, 1); assert.equal(calls('sendPersonalEmail').length, 0)
})
test('public/legacy gallery, two-image cap and image removal preserve draft-local state', async () => {
  await click(btn(card('customer'), '+ Photo')); assert.equal(gallery('customer').length, 2)
  assert.equal(calls('loadBlogImages')[0][1], 'corporate'); assert.ok(!card('customer').querySelector('img[src$="private.png"]'))
  await click(gallery('customer')[0]); assert.equal(btn(card('customer'), '+ Photo'), undefined)
  assert.equal(card('customer').querySelectorAll('img').length, 4)
  await click(card('customer').querySelector('img').parentElement.querySelector('button')); assert.ok(btn(card('customer'), '+ Photo'))
  assert.equal(field('lead', 'subject').value, 'Subject lead'); assert.equal(card('lead').querySelectorAll('img').length, 0)
})
test('generic draft upload failure/retry retains edits and original file/path contract', async () => {
  const file = new window.File(['fictional'], '新系列.png', { type: 'image/png' }); f.handlers.uploadBytes = () => { throw Error('Fictional upload failure') }
  await changeFiles(card('lead').querySelector('input[type=file]'), [file]); assert.match(host.textContent, /Fictional upload failure/)
  assert.equal(card('lead').querySelector('input[type=file]').disabled, false); assert.equal(field('lead', 'body').value, 'Body lead')
  f.handlers.uploadBytes = () => undefined; await changeFiles(card('lead').querySelector('input[type=file]'), [file])
  assert.match(calls('ref').at(-1)[2], /^daily_draft_images\/\d+_新系列\.png$/); assert.equal(calls('uploadBytes').at(-1)[2], file)
  assert.equal(calls('uploadBytes').at(-1)[1].path, calls('ref').at(-1)[2])
  assert.equal(card('lead').querySelector('img').src, 'https://assets.example.test/upload.png')
})
test('link forms retain isolated unsaved text, trim URL/title and remove only chosen link', async () => {
  await click(btn(card('lead'), '+ Link')); const url = () => card('lead').querySelector('input[placeholder="https://…"]')
  await change(url(), ' https://example.test/新系列 '); await click(btn(card('lead'), 'Cancel')); await click(btn(card('customer'), '+ Link'))
  assert.equal(card('customer').querySelector('input[placeholder="https://…"]').value, '')
  await click(btn(card('lead'), '+ Link')); assert.equal(url().value, ' https://example.test/新系列 ')
  await click(btn(card('lead'), 'Attach link')); assert.match(card('lead').textContent, /https:\/\/example.test\/新系列/)
  const chip = [...card('lead').querySelectorAll('span')].find(e => e.textContent.trim() === 'https://example.test/新系列'); await click(chip.querySelector('button'))
  assert.doesNotMatch(card('lead').textContent, /https:\/\/example.test\/新系列/); assert.match(card('customer').textContent, /Original legacy link/)
})
test('WhatsApp labels/copy/open stay manual and logging deduplicates for the correct source', async t => {
  const opened=[]; const copied=[]; const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:value=>copied.push(value)}}}); t.after(()=>{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator})
  window.open=(...args)=>opened.push(args)
  assert.ok(btn(card('customer'),'WhatsApp Personal')); assert.ok(btn(card('customer'),'WhatsApp Business')); assert.ok(btn(card('lead'),'WhatsApp'))
  await click(card('customer').querySelector('button[title="Copy WhatsApp Personal number"]')); assert.deepEqual(copied,['+1 202 555 0101'])
  await click(btn(card('customer'),'WhatsApp Personal')); assert.deepEqual(opened[0],['https://wa.me/12025550101','_blank','noopener']); assert.equal(calls('addInteraction').length,0)
  await click(btn(card('customer'),'Log WhatsApp outreach')); assert.equal(calls('addInteraction')[0][1],'customers'); assert.equal(calls('addInteraction')[0][3].channel,'Personal WhatsApp'); assert.equal(btn(card('customer'),'Log WhatsApp outreach'),undefined)
  await click(btn(card('lead'),'WhatsApp')); await click(btn(card('lead'),'Log WhatsApp outreach')); assert.equal(calls('addInteraction')[1][1],'marketing_contacts'); assert.equal(calls('addInteraction')[1][3].channel,'WhatsApp')
})
test('new-customer linking preserves lead payload, warning and confirmation without sending', async () => {
  await click(btn(card('lead'),'Add to Customers')); await click(btn(card('lead'),'Create customer'))
  assert.equal(calls('promoteContactsToCustomers')[0][1][0].id,'lead-1'); assert.match(card('lead').textContent,/Added as a new customer: Fictional new company/)
  assert.match(card('lead').textContent,/history may not have fully carried over/); assert.equal(btn(card('lead'),'Add to Customers'),undefined); assert.equal(calls('sendPersonalEmail').length,0)
})
test('already-linked lead refuses customer creation and keeps its error visible', async () => {
  f.lead.possible_customer_match='existing'; await click(btn(card('lead'),'Add to Customers')); await click(btn(card('lead'),'Create customer'))
  assert.match(card('lead').textContent,/already linked to a customer/); assert.equal(calls('promoteContactsToCustomers').length,0); assert.equal(btn(card('lead'),'Create customer').disabled,false)
})
test('existing-customer linking appends a non-primary contact and preserves customer fields', async () => {
  await click(btn(card('lead'),'Add to Customers')); await click(btn(card('lead'),'Add as a contact on an existing customer'))
  assert.ok(btn(card('lead'),'Add contact').disabled); await change(card('lead').querySelector('select'),'trade'); await click(btn(card('lead'),'Add contact'))
  const save=calls('saveCustomer')[0]; assert.equal(save[1],'trade'); assert.equal(save[2].country,'HK'); assert.equal(save[2].contacts[0].is_primary,true)
  assert.deepEqual(save[2].contacts[1],{name:'Fictional Lead',email:'lead@example.test',phone:'+1 202 555 0103',is_primary:false})
  assert.deepEqual(calls('linkContactToCustomer')[0],['linkContactToCustomer','lead-1','trade','Fictional existing company']); assert.match(card('lead').textContent,/Added as a contact/)
})
test('customer-save failure retains link form and does not link the lead', async () => {
  f.handlers.saveCustomer=()=>({ok:false,result:{errors:[{message:'Fictional customer save failure'}]}})
  await click(btn(card('lead'),'Add to Customers')); await click(btn(card('lead'),'Add as a contact on an existing customer')); await change(card('lead').querySelector('select'),'trade'); await click(btn(card('lead'),'Add contact'))
  assert.match(card('lead').textContent,/Fictional customer save failure/); assert.equal(calls('linkContactToCustomer').length,0); assert.equal(card('lead').querySelector('select').value,'trade')
})
test('per-draft Enter chat preserves contact context/history/memory and applies local edits only', async () => {
  await readyChat('lead','  Rewrite fictional copy  '); await enter(chat('lead'),true); assert.equal(calls('discussDraft').length,0); await enter(chat('lead'))
  assert.deepEqual(calls('discussDraft')[0][1],{productContext:'Fictional topic',customerContext:'Fictional lead context',draftSubject:'Subject lead',draftBody:'Body lead',history:[],message:'Rewrite fictional copy',memory:{globalRules:['Use verified facts.'],contactSummary:'Fictional contact summary',recentConclusions:['Keep specific']}})
  assert.equal(field('lead','subject').value,'Revised subject'); assert.equal(field('customer','subject').value,'Subject customer'); assert.equal(chat('lead').value,'')
  assert.equal(calls('updateDoc').length+calls('sendPersonalEmail').length,0)
})
test('chat busy/error/retry preserves text and mismatch warning when AI applies no actual change', async () => {
  let reject; f.handlers.discussDraft=()=>new Promise((_done,fail)=>{reject=fail}); await readyChat('lead','Keep request'); await enter(chat('lead')); await enter(chat('lead')); assert.equal(calls('discussDraft').length,1)
  await act(async()=>reject(Error('Fictional chat failure'))); assert.equal(chat('lead').value,'Keep request'); assert.match(host.textContent,/Fictional chat failure/)
  f.handlers.discussDraft=()=>({reply:"I've updated the copy.",subject:null,body:null}); await enter(chat('lead')); assert.match(card('lead').textContent,/No actual change was applied/); assert.equal(field('lead','subject').value,'Subject lead')
})
test('chat note, draft conclusion and standing rule keep their separate write scopes', async () => {
  await readyChat('lead','Keep these fictional details'); await enter(chat('lead'))
  await click(card('lead').querySelector('button[title="Save this as a note on the customer record"]'))
  assert.deepEqual(calls('updateDoc')[0],['updateDoc',{path:'marketing_contacts/lead-1'},{app_notes:'Keep these fictional details',updatedAt:'fictional-server-time'}])
  await click(card('lead').querySelector('button[title="Remember for THIS draft only (feeds this draft\'s rewrite chat)"]'))
  assert.deepEqual(calls('appendMemoryConclusion')[0],['appendMemoryConclusion','pending-lead',['Keep specific'],'Keep these fictional details'])
  await click(card('lead').querySelector('button[title="Remember as a standing rule for every future draft (goes to review first)"]'))
  assert.deepEqual(calls('createDraftMemoryRule')[0],['createDraftMemoryRule',{text:'Keep these fictional details',source:'confirmed',createdBy:'fictional-reviewer'}]); assert.equal(calls('approveDraftMemoryRule').length,0)
})
