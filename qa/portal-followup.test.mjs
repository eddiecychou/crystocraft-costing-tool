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
import { accountInformationTemplate } from '../src/portalFollowup.js'

const require = createRequire(import.meta.url)
const account = { id: 'fixture', role: 'customer', status: 'pending', email: 'applicant@example.test', company_name: 'Fictional Gifts', contact_name: 'Test Contact' }
let dom, scratch, Page, createRoot, root, host, data, calls, failSave, pendingSend, failLoad
const clean = () => ({ revision: 0, state: 'new', draft: null, active_message_id: null, last_sent_at: null, messages: [], from: 'QA <sender@example.test>', reply_to: 'reply@example.test', mail_configured: true })
const copy = () => structuredClone(data)
const click = async label => {
  const el = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
  assert.ok(el, 'button exists: ' + label)
  await act(async () => el.click())
}
const mount = async (a = account) => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(React.createElement(Page, { account: a }))) }
const unmount = async () => { if (root) { await act(async () => root.unmount()); root = null; host.remove() } }
before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/portal/accounts/fixture' })
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  scratch = await mkdtemp(join(tmpdir(), 'portal-followup-ui-'))
  await build({ stdin: { contents: "export {default} from './src/components/PortalAccountFollowup.jsx'", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', outfile: join(scratch, 'page.mjs'),
    plugins: [{ name: 'offline-api', setup(b) {
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: require.resolve(a.path), external: true }))
      b.onResolve({ filter: /\/portalInviteApi$/ }, () => ({ path: 'api', namespace: 'qa' }))
      b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ loader: 'js', contents: `export const getAccountFollowup=(...a)=>globalThis.__followupApi.get(...a);export const saveAccountFollowupDraft=(...a)=>globalThis.__followupApi.save(...a);export const sendAccountFollowup=(...a)=>globalThis.__followupApi.send(...a);export const markAccountInformationReceived=(...a)=>globalThis.__followupApi.received(...a);export const resolveAccountFollowup=(...a)=>globalThis.__followupApi.resolve(...a);` }))
    } }] })
  Page = (await import(pathToFileURL(join(scratch, 'page.mjs')))).default
})
beforeEach(() => {
  data = clean(); calls = []; failSave = false; pendingSend = null; failLoad = false
  globalThis.__followupApi = {
    get: async uid => { calls.push(['get', uid]); if (failLoad) throw Error('Fixture unavailable'); return copy() },
    save: async (uid, draft) => { calls.push(['save', uid, draft]); if (failSave) throw Error('This follow-up changed in another session. Refresh before continuing.'); data = { ...data, draft: { subject: draft.subject, message: draft.message }, revision: data.revision + 1 }; return copy() },
    send: async (uid, message) => {
      calls.push(['send', uid, message]); if (pendingSend) await pendingSend
      data = { ...data, revision: data.revision + 1, state: 'waiting', draft: null, last_sent_at: 1793548800000,
        messages: [{ id: message.messageId, to: account.email, subject: message.subject, message: message.message, status: 'sent', sent_at: 1793548800000 }] }; return copy()
    },
    received: async (uid, revision) => { calls.push(['received', uid, revision]); data = { ...data, state: 'received', received_at: 1793548800000, revision: data.revision + 1 }; return copy() },
    resolve: async () => { throw Error('Unexpected manual resolution') },
  }
})
afterEach(unmount)
after(async () => { delete globalThis.__followupApi; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })

test('request opens an editable, addressed template without sending or approving', async () => {
  await mount(); await click('Request more information')
  assert.equal(host.querySelector('[aria-label="Email subject"]').value, 'Your Crystocraft portal request')
  assert.match(host.querySelector('textarea').value, /Dear Test,/)
  assert.match(host.querySelector('textarea').value, /Fictional Gifts/)
  assert.match(host.textContent, /To: applicant@example.test/); assert.match(host.textContent, /Replies to: reply@example.test/)
  assert.match(host.textContent, /stays Pending Approval/); assert.equal(calls.length, 1)
})
test('draft persists across close and remount without sending', async () => {
  await mount(); await click('Request more information'); await click('Save draft')
  assert.equal(calls.filter(c => c[0] === 'send').length, 0)
  await unmount(); await mount(); await click('Continue draft')
  assert.equal(host.querySelector('textarea').value, data.draft.message)
})
test('explicit send uses the current edited fields and shows history/waiting then manual received', async () => {
  await mount(); await click('Request more information')
  const change = (await import('react-dom/test-utils')).Simulate.change
  await act(async () => {
    change(host.querySelector('input'), { target: { value: 'Current edited subject' } })
    change(host.querySelector('textarea'), { target: { value: 'Current edited message 中文' } })
  })
  await act(async () => host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const send = calls.find(c => c[0] === 'send')[2]
  assert.equal(send.subject, 'Current edited subject'); assert.equal(send.message, 'Current edited message 中文')
  assert.equal(send.expectedEmail, account.email); assert.match(send.messageId, /^[a-f0-9-]{36}$/)
  assert.match(host.textContent, /Waiting for reply/); assert.match(host.textContent, /Current edited message 中文/)
  await click('Mark information received'); assert.match(host.textContent, /Information received/)
  assert.equal(account.status, 'pending'); assert.deepEqual(calls.map(c => c[0]), ['get', 'send', 'received'])
})
test('rapid duplicate submission starts one request while controls are busy', async () => {
  let release; pendingSend = new Promise(r => { release = r })
  await mount(); await click('Request more information')
  await act(async () => { for (let i = 0; i < 2; i++) host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(calls.filter(c => c[0] === 'send').length, 1)
  assert.equal(host.querySelector('button[type="submit"]').disabled, true)
  await act(async () => release())
})
test('stale-save error is focused beside composer and retains entered values', async () => {
  failSave = true; await mount(); await click('Request more information')
  const text = host.querySelector('textarea').value; await click('Save draft')
  assert.match(host.querySelector('[role="alert"]').textContent, /another session/)
  assert.equal(document.activeElement, host.querySelector('[role="alert"]'))
  assert.equal(host.querySelector('textarea').value, text)
})
test('loading failure has a recovery action and never enables a send', async () => {
  failLoad = true; await mount(); assert.match(host.textContent, /Fixture unavailable/)
  assert.equal(host.querySelector('form'), null); failLoad = false; await click('Retry loading')
  assert.match(host.textContent, /Request more information/)
})
test('missing email configuration keeps draft available but disables send', async () => {
  data.mail_configured = false; data.reply_to = ''; await mount(); await click('Request more information')
  assert.equal(host.querySelector('button[type="submit"]').disabled, true)
  await click('Save draft'); assert.equal(calls.filter(c => c[0] === 'save').length, 1)
})
test('unknown send result blocks new composition, keeps history and exposes same-message recovery', async () => {
  data.active_message_id = 'unknown'; data.messages = [{ id: 'unknown', status: 'unknown', to: account.email, subject: 'Original', message: 'Do not resend as new', created_at: Date.now(), retry_until: Date.now() + 100000 }]
  await mount(); assert.equal(host.querySelector('form'), null)
  assert.ok([...host.querySelectorAll('button')].some(b => b.textContent === 'Retry same email'))
  assert.equal([...host.querySelectorAll('button')].some(b => b.textContent === 'Request more information'), false)
})
test('approved account shows prior correspondence without composing or changing approval', async () => {
  data.messages = [{ id: 'old', to: account.email, subject: 'Previous request', message: 'Saved application history', status: 'sent', sent_at: 1793548800000 }]
  await mount({ ...account, status: 'approved', customer_id: 'linked' })
  assert.match(host.textContent, /Saved application history/)
  assert.equal([...host.querySelectorAll('button')].some(b => b.textContent === 'Request more information'), false)
  assert.equal(host.querySelector('form'), null)
})
test('template tolerates missing names without inventing a customer/company', () => {
  const draft = accountInformationTemplate({})
  assert.match(draft.message, /Hello,/); assert.match(draft.message, /your business/)
  assert.doesNotMatch(draft.message, /undefined|null/)
})
