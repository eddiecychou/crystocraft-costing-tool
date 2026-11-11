import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

const require = createRequire(import.meta.url)
let scratch, dom, Panel, createRoot, root, host, calls
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'prepared', customer: 'Fictional first buyer', line_count: 2
}
const second = {
  ...first, id: '22222222-2222-4222-8222-222222222222',
  customer: 'Fictional second buyer', status: 'committed', direct: true,
  invoice: { state: 'due' }
}

before(async () => {
  dom = new JSDOM('<body></body>', { url: 'https://fixture.invalid/shipping' })
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent'])
    globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  globalThis.__ocSavedRequests = (action, body) => new Promise((resolve, reject) => {
    calls.push({ action, body, resolve, reject })
  })
  scratch = await mkdtemp(join(tmpdir(), 'oc-saved-requests-'))
  await build({
    entryPoints: ['src/components/shipping/SavedOrderRequests.jsx'],
    outfile: join(scratch, 'panel.mjs'),
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{
      name: 'fictional-request-transport',
      setup(b) {
        b.onResolve({ filter: /^(react(?:\/.*)?|react-router-dom)$/ }, a => ({
          path: require.resolve(a.path), external: true
        }))
        b.onResolve({ filter: /\/orderCreateRequest$/ }, () => ({
          path: 'requests', namespace: 'fictional'
        }))
        b.onLoad({ filter: /.*/, namespace: 'fictional' }, () => ({
          contents: 'export const orderRequestAction=(...args)=>globalThis.__ocSavedRequests(...args);',
          loader: 'js'
        }))
      }
    }]
  })
  Panel = (await import(pathToFileURL(join(scratch, 'panel.mjs')))).default
})
beforeEach(() => {
  calls = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => {
    for (const call of calls) call.resolve({ requests: [], next: null })
  })
  await act(async () => root.unmount())
  host.remove()
})
after(async () => {
  dom.window.close()
  delete globalThis.__ocSavedRequests
  if (scratch) await rm(scratch, { recursive: true, force: true })
})
const render = uid => act(async () => root.render(
  React.createElement(MemoryRouter, {
    future: { v7_startTransition: true, v7_relativeSplatPath: true }
  }, React.createElement(Panel, { uid }))
))
const button = name => {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name)
  assert.ok(found, name)
  return found
}
const toggle = () => button('My saved order requests')
const click = name => act(async () => button(name).click())
const reply = (index, requests, next = null) => act(async () => {
  calls[index].resolve({ requests, next })
})
const fail = (index, message) => act(async () => calls[index].reject(Error(message)))

test('a reopened list keeps its latest result when an earlier response arrives late', { timeout: 5000 }, async () => {
  await render('operator-a')
  await click('My saved order requests')
  await click('My saved order requests')
  await click('My saved order requests')
  assert.equal(calls.length, 2)
  await reply(1, [second])
  await reply(0, [first])
  assert.match(host.textContent, /Fictional second buyer/)
  assert.doesNotMatch(host.textContent, /Fictional first buyer/)
  assert.match(host.querySelector('a').textContent, /Resume Direct Invoice/)
  assert.equal(new URL(host.querySelector('a').href).searchParams.get('operator'), 'operator-a')
})

test('an abandoned rejection cannot replace the reopened loading or empty state', { timeout: 5000 }, async () => {
  await render('operator-a')
  await click('My saved order requests')
  await click('My saved order requests')
  await click('My saved order requests')
  await fail(0, 'Abandoned read failed')
  assert.equal(host.querySelector('[role=alert]'), null)
  assert.match(host.textContent, /Loading/)
  await reply(1, [])
  assert.match(host.textContent, /No saved order requests/)
})

test('a failed later page retries its cursor and retains the already loaded requests', { timeout: 5000 }, async () => {
  await render('operator-a')
  await click('My saved order requests')
  await reply(0, [first], 'next-page')
  await click('Show more')
  await fail(1, 'Fictional page read failed')
  assert.match(host.querySelector('[role=alert]').textContent, /Fictional page read failed/)
  assert.match(host.textContent, /Fictional first buyer/)
  await click('Retry')
  assert.equal(calls[2].body.cursor, 'next-page')
  await reply(2, [second])
  assert.equal(host.querySelectorAll('a').length, 2)
  assert.match(host.textContent, /Fictional first buyer/)
  assert.match(host.textContent, /Fictional second buyer/)
})

test('rapid pagination clicks start one read and append its page once', { timeout: 5000 }, async () => {
  await render('operator-a')
  await click('My saved order requests')
  await reply(0, [first], 'next-page')
  const more = button('Show more')
  await act(async () => { more.click(); more.click() })
  assert.equal(calls.length, 2)
  assert.equal(more.disabled, true)
  await reply(1, [second])
  assert.equal(host.querySelectorAll('a').length, 2)
})

test('changing operators clears the old list and ignores its outstanding read', { timeout: 5000 }, async () => {
  await render('operator-a')
  await click('My saved order requests')
  await reply(0, [first], 'next-page')
  await click('Show more')
  await render('operator-b')
  assert.equal(toggle().getAttribute('aria-expanded'), 'false')
  assert.doesNotMatch(host.textContent, /Fictional first buyer/)
  await click('My saved order requests')
  await reply(2, [second])
  await reply(1, [first])
  assert.doesNotMatch(host.textContent, /Fictional first buyer/)
  assert.equal(host.querySelectorAll('a').length, 1)
  assert.equal(new URL(host.querySelector('a').href).searchParams.get('operator'), 'operator-b')
})
