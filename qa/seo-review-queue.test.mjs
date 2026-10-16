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
 get: async () => ({exists:()=>true,data:()=> {
 const state = globalThis.__queueFixture;
 const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object'
   ? Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])) : v;
 return state.reorderRead ? reorder(state.batch) : state.batch;
 }}),
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

test('approval tolerates Firestore map key order, but blocks changed values and array order', async () => {
  const bundle = await build({ entryPoints: ['src/pages/SeoReview.jsx'], bundle: true, write: false,
    platform: 'node', format: 'esm', jsx: 'automatic', plugins: [fixturePlugin(), { name: 'react-external', setup(b) {
      b.onResolve({ filter: /^(?:react(?:\/.*)?|lucide-react)$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }))
    } }] })
  const { default: Review } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.test' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const findButton = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const mount = async key => {
    globalThis.__queueFixture = { reorderRead: true, batch: { id: 'pending-map-order', note: 'Review me', status: 'pending_review', item_count: 1,
      items: [{ ...item, decision: 'pending', payload: { title: 'Reviewed title', meta: { _elementor_data: '[{"id":"a"}]', other: 'safe' } }, before: { 'meta._elementor_data': '[{"id":"old"}]' }, source: { list: [1,2] } }] }, listeners: [] }
    await act(async () => { root.render(React.createElement(Review, { key })) })
  }
  try {
    await mount('single')
    assert.match(document.body.textContent, /len 14/)
    await act(async () => findButton('Approve').click())
    assert.equal(globalThis.__queueFixture.batch.items[0].decision, 'approve', 'same data in a different map key order must approve')
    assert.doesNotMatch(document.body.textContent, /Review decisions changed/)
    await act(async () => findButton('Send to DSH (1 approved)').click())
    assert.equal(globalThis.__queueFixture.batch.status, 'approved')
    await mount('bulk')
    await act(async () => findButton('Approve all passing').click())
    assert.equal(globalThis.__queueFixture.batch.items[0].decision, 'approve')
    for (const change of ['payload','decision','array','superseded','claimed']) {
      await mount(change)
      const state = globalThis.__queueFixture
      // Replace rather than mutate: the existing rendered snapshot stays old.
      state.batch = structuredClone(state.batch)
      if (change === 'payload') state.batch.items[0].payload.title = 'Unreviewed replacement'
      if (change === 'decision') state.batch.items[0].decision = 'reject'
      if (change === 'array') state.batch.items[0].source.list.reverse()
      if (change === 'superseded') { state.batch.status = 'superseded'; state.batch.superseded_by = 'new' }
      if (change === 'claimed') { state.batch.status = 'executing'; state.batch.execution_started_at = 'now' }
      const expected = structuredClone(state.batch)
      await act(async () => findButton('Approve').click())
      assert.deepEqual(state.batch, expected, 'stale approval must not overwrite ' + change)
      assert.match(document.body.textContent, /changed|no longer awaiting review/)
      const reload = findButton('Reload queue')
      assert.ok(reload, 'stale review provides an explicit recovery action')
      let reloads = 0
      const previousWindow = globalThis.window
      globalThis.window = { location: { reload: () => { reloads++ } } }
      try { await act(async () => reload.click()) } finally { globalThis.window = previousWindow }
      assert.equal(reloads, 1)
      assert.deepEqual(state.batch, expected, 'reload must never approve or mutate stale work')
    }
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete globalThis.window; delete globalThis.document; delete globalThis.__queueFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('review value comparison retains Firestore timestamp and numeric meaning; baselines support all carriers', async () => {
  const { sameReviewValue, reviewFieldValue } = await import('../src/domain/seoReview.js')
  const { Timestamp } = await import('firebase/firestore')
  assert.equal(sameReviewValue({ a: 1, at: new Timestamp(20, 30) }, { at: new Timestamp(20, 30), a: 1 }), true)
  assert.equal(sameReviewValue(new Timestamp(20, 30), new Timestamp(20, 31)), false)
  assert.equal(sameReviewValue({ n: NaN }, { n: null }), false)
  assert.equal(sameReviewValue({ a: undefined }, {}), false)
  assert.equal(sameReviewValue([1,2], [2,1]), false)
  assert.equal(sameReviewValue({ a: [1,2] }, { a: [1] }), false)
  for (const entity of [{ 'meta._elementor_data': 'old' }, { meta: { _elementor_data: 'old' } }, { meta_data: [{ key: '_elementor_data', value: 'old' }] }])
    assert.equal(reviewFieldValue(entity, 'meta._elementor_data'), 'old')
  assert.equal(reviewFieldValue({ title: { raw: 'Authored', rendered: 'Built' } }, 'title'), 'Authored')
  assert.equal(reviewFieldValue({ 'meta.empty': '', meta: { empty: 'wrong fallback' } }, 'meta.empty'), '')
})
