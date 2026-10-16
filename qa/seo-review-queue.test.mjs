import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)
const item = { index: 0, decision: 'approve', validation: { passed: true, checks: [] }, before: {}, payload: { title: 'Reviewed title' } }
export const fixtureModule = `
export const collection = () => ({}), doc = (_, col, id) => ({id});
export const query = (_, ...args) => ({ active: args.some(a => a?.active) });
export const orderBy = () => ({}), limit = () => ({}), where = () => ({active:true});
export const serverTimestamp = () => 'now';
export const onSnapshot = (q, callback) => {
 const state = globalThis.__queueFixture;
 const emit = () => callback({ docs: (q.active ? [state.batch] : []).map(b => ({id:b.id, data:()=>b})) });
 state.listeners.push(emit); emit(); return () => {};
};
export const runTransaction = async (_, fn) => fn({
 get: async () => ({exists:()=>true,data:()=>globalThis.__queueFixture.batch}),
 update: (_, patch) => { Object.assign(globalThis.__queueFixture.batch, patch); globalThis.__queueFixture.listeners.forEach(fn=>fn()); }
});`
export function fixturePlugin() { return { name: 'fixture-firestore', setup(b) {
  b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'store', namespace: 'fixture' }))
  b.onResolve({ filter: /\/firebase$|^\.\.\/firebase$/ }, () => ({ path: 'db', namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'db' ? 'export const db = {}' : fixtureModule }))
} } }

test('review UI shows old active approved IDs, withdraws unused approval and rejects claim races', async () => {
  const bundle = await build({ entryPoints: ['src/pages/SeoReview.jsx'], bundle: true, write: false,
    platform: 'node', format: 'esm', jsx: 'automatic', plugins: [fixturePlugin(), { name: 'react-external', setup(b) {
      b.onResolve({ filter: /^(?:react(?:\/.*)?|lucide-react)$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }))
    } }] })
  const { default: Review } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.test' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const button = () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Withdraw unused'))
  try {
    for (const race of [false, true]) {
      globalThis.__queueFixture = { batch: { id: 'old-approved-outside-history', note: 'Unused approved batch', status: 'approved', item_count: 1, items: [item] }, listeners: [] }
      await act(async () => { root.render(React.createElement(Review, { key: String(race) })) })
      assert.match(document.body.textContent, /old-approved-outside-history/)
      assert.ok(button())
      if (race) Object.assign(globalThis.__queueFixture.batch, { status: 'executing', execution_started_at: 'now' })
      await act(async () => { button().click() })
      assert.equal(globalThis.__queueFixture.batch.status, race ? 'executing' : 'withdrawn')
      if (race) assert.match(document.body.textContent, /started or changed/)
      else assert.match(document.body.textContent, /Withdrawn in OC/)
    }
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete globalThis.window; delete globalThis.document; delete globalThis.__queueFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
