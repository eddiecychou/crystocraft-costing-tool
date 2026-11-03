import { test, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createCustomerNavigationFixture, customerSnapshot, customerNavigationPlugins } from './customer-navigation-fixture.mjs'

const require = createRequire(import.meta.url)
let dom, scratch, CustomerDetail, createRoot, MemoryRouter, Routes, Route, useNavigate, useLocation, Simulate
let f, host, root, navigate, route, originalFetch, runtimeErrors
const heading = () => host.querySelector('h1')?.textContent
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const settle = async (id, data = {}, index = 0) => act(async () => f.request(id, index).resolve(customerSnapshot(id, data)))
const go = async id => act(async () => navigate('/customers/' + id))
function Observer() { navigate = useNavigate(); route = useLocation().pathname; return null }
async function mount(id = 'A') {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/customers/' + id], future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(React.Fragment, null, React.createElement(Observer), React.createElement(Routes, null, React.createElement(Route, { path: '/customers/:id', element: React.createElement(CustomerDetail) }))))))
}
async function close() { if (root) { await act(async () => root.unmount()); root = null; host.remove() } }
before(async () => {
  dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/customers/A' })
  for (const key of ['window', 'document', 'sessionStorage', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.addEventListener('error', event => runtimeErrors.push(event.message))
  ;({ createRoot } = await import('react-dom/client'))
  ;({ MemoryRouter, Routes, Route, useNavigate, useLocation } = await import('react-router-dom'))
  ;({ Simulate } = await import('react-dom/test-utils'))
  originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('Network forbidden in customer-navigation fixture') }
  globalThis.__workspaceSyncDb = {}
  scratch = await mkdtemp(join(tmpdir(), 'customer-navigation-'))
  await build({ entryPoints: ['src/pages/CustomerDetail.jsx'], outfile: join(scratch, 'ui.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', plugins: await customerNavigationPlugins(require) })
  CustomerDetail = (await import(pathToFileURL(join(scratch, 'ui.mjs')))).default
})
beforeEach(() => { f = createCustomerNavigationFixture(); globalThis.__customerNavigationFixture = f; runtimeErrors = []; sessionStorage.clear(); localStorage.clear() })
afterEach(async () => {
  await close()
  assert.deepEqual(f.writes, [], 'No business writes')
  assert.deepEqual(f.unexpected, [], 'No unconfigured reads')
  assert.deepEqual(runtimeErrors, [], 'No page runtime errors')
})
after(async () => { globalThis.fetch = originalFetch; delete globalThis.__customerNavigationFixture; delete globalThis.__workspaceSyncDb; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })

test('late customer A response cannot replace customer B after navigation', async () => {
  await mount(); await go('B'); await settle('B')
  assert.equal(heading(), 'Fictional B')
  await settle('A', { company_name: 'Abandoned A' })
  assert.equal(route, '/customers/B'); assert.equal(heading(), 'Fictional B')
  assert.doesNotMatch(host.textContent, /Abandoned A/)
})
test('loaded customer is hidden immediately while a different customer loads', async () => {
  await mount(); await settle('A'); assert.equal(heading(), 'Fictional A')
  await go('B')
  assert.equal(heading(), undefined); assert.doesNotMatch(host.textContent, /Fictional A/)
  assert.equal(host.querySelector('a[href="/customers/B/edit"]'), null)
  await settle('B'); assert.equal(heading(), 'Fictional B')
})
test('A to B to A distinguishes separate requests for the same customer', async () => {
  await mount(); await go('B'); await go('A')
  await settle('A', { company_name: 'Current A' }, 1)
  await settle('B'); await settle('A', { company_name: 'Outdated first A' })
  assert.equal(route, '/customers/A'); assert.equal(heading(), 'Current A')
  assert.doesNotMatch(host.textContent, /Outdated first A|Fictional B/)
})
test('missing customer does not retain the previous customer or its actions', async () => {
  await mount(); await settle('A'); await go('missing')
  await act(async () => f.request('missing').resolve({ exists: () => false }))
  assert.equal(heading(), undefined); assert.match(host.textContent, /Customer not found/)
  assert.doesNotMatch(host.textContent, /Fictional A/); assert.equal(button('Delete'), undefined)
})
test('failed customer load shows safe error and Retry reloads only that customer', async () => {
  await mount(); await settle('A'); await go('B')
  await act(async () => f.request('B').reject(Error('Private SDK diagnostic')))
  assert.equal(heading(), undefined); assert.match(host.querySelector('[role=alert]').textContent, /Could not load this customer/)
  assert.doesNotMatch(host.textContent, /Private SDK diagnostic|Fictional A/)
  await act(async () => button('Retry').click()); assert.equal(host.querySelector('[role=alert]'), null)
  await settle('B', {}, 1); assert.equal(heading(), 'Fictional B')
  assert.deepEqual(f.customerRequests.map(r => r.id), ['A', 'B', 'B'])
})
test('an ancillary load failure is handled and can be retried without a business write', async () => {
  f.handlers.getDocs = () => { throw Error('Private ancillary failure') }
  await mount(); await settle('A')
  assert.match(host.querySelector('[role=alert]').textContent, /Could not load this customer/)
  delete f.handlers.getDocs
  await act(async () => button('Retry').click()); await settle('A', {}, 1)
  assert.equal(heading(), 'Fictional A')
})
for (const outcome of ['resolve', 'reject']) test('abandoned customer ' + outcome + ' after navigation is ignored', async () => {
  await mount(); await go('B'); await settle('B')
  await act(async () => outcome === 'resolve' ? f.request('A').resolve(customerSnapshot('A')) : f.request('A').reject(Error('Old customer read failed')))
  assert.equal(heading(), 'Fictional B'); assert.equal(host.querySelector('[role=alert]'), null)
})
for (const outcome of ['resolve', 'reject']) test('late ' + outcome + ' after page unmount is handled', async () => {
  await mount(); await close()
  await act(async () => outcome === 'resolve' ? f.request('A').resolve(customerSnapshot('A')) : f.request('A').reject(Error('Abandoned page read failed')))
  assert.ok(f.listeners.every(l => l.closed), 'Every customer subscription closes')
})
test('route change closes old subscriptions and ignores their late callbacks', async () => {
  await mount(); await settle('A')
  const old = [...f.listeners]
  await go('B'); await settle('B')
  assert.ok(old.every(l => l.closed))
  await act(async () => { for (const l of old) l.next({ docs: [], exists: () => false, data: () => undefined }) })
  assert.equal(heading(), 'Fictional B')
})
test('same-customer renders preserve unsaved compose text; another customer starts clean', async () => {
  await mount(); await settle('A')
  const section = [...host.querySelectorAll('h2')].find(h => h.textContent.includes('Compose Message')).closest('.card')
  await act(async () => section.querySelector('.cursor-pointer').click())
  const text = () => host.querySelector('textarea[placeholder*="What do you want"]') || section.querySelector('textarea')
  assert.ok(text()); await act(async () => Simulate.change(text(), { target: { value: 'Unsaved A-only context' } }))
  await go('A'); assert.equal(text().value, 'Unsaved A-only context')
  await go('B'); await settle('B')
  assert.doesNotMatch(host.textContent, /Unsaved A-only context/)
  const next = [...host.querySelectorAll('h2')].find(h => h.textContent.includes('Compose Message')).closest('.card')
  await act(async () => next.querySelector('.cursor-pointer').click())
  assert.ok([...next.querySelectorAll('textarea')].every(t => t.value === ''))
})
