import { before, beforeEach, after, afterEach } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { dailyDraftsFixturePlugin, createDailyDraftsFixture } from './daily-drafts-fixture.mjs'

const require = createRequire(import.meta.url)
export let host, f
let dom, scratch, DailyDrafts, createRoot, Simulate, root, originalFetch
export const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
export const click = async el => { assert.ok(el); await act(async () => el.click()) }
export const change = async (el, value) => { assert.ok(el); await act(async () => Simulate.change(el, { target: { value } })) }
export const changeFiles = async (el, files) => {
  assert.ok(el)
  Object.defineProperty(el, 'files', { configurable: true, value: files })
  await act(async () => Simulate.change(el, { target: el }))
}
export async function remount() {
  if (root) await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(React.createElement(DailyDrafts)))
}

export function setupDailyDraftsTests(seed = () => {}) {
  before(async () => {
    dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/marketing' })
    for (const name of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[name] = dom.window[name]
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    createRoot = (await import('react-dom/client')).createRoot
    Simulate = (await import('react-dom/test-utils')).Simulate
    originalFetch = globalThis.fetch
    globalThis.fetch = () => { throw Error('Network forbidden in Daily Drafts fixture') }
    scratch = await mkdtemp(join(tmpdir(), 'daily-drafts-'))
    await build({ entryPoints: ['src/marketing/DailyDrafts.jsx'], outfile: join(scratch, 'ui.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
      plugins: [{ name: 'same-react-runtime', setup(b) { b.onResolve({ filter: /^(?:react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true })) } }, dailyDraftsFixturePlugin()] })
    DailyDrafts = (await import(pathToFileURL(join(scratch, 'ui.mjs')))).default
  })
  beforeEach(async () => {
    f = createDailyDraftsFixture(); seed(f); globalThis.__dailyDraftsFixture = f
    host = document.createElement('div'); document.body.append(host); root = null
    await remount()
  })
  afterEach(async () => { await act(async () => root.unmount()); root = null; host.remove() })
  after(async () => { globalThis.fetch = originalFetch; delete globalThis.__dailyDraftsFixture; dom.window.close(); await rm(scratch, { recursive: true, force: true }) })
}
