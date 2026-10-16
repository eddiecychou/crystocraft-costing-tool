import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePayload } from '../seo-control-plane/validate-payload.mjs'
import { safeWrite } from '../seo-control-plane/safe-write.mjs'
import { claimBatch, withdrawBatch, queuePlan } from '../netlify/functions/lib/seoBatchSafety.js'

const widget = (id, widgetType, settings) => ({ id, elType: 'widget', widgetType, settings })
const original = [widget('h', 'heading', { title: 'Crystocraft Swarovski', header_size: 'h2' }),
  widget('i', 'image', { image: { id: 7, url: '/image.jpg' } }),
  widget('t', 'text-editor', { editor: '<p>Trade information.</p><img src="/inline.jpg"><h2>Details</h2>' })]
const carrier = (tree, shape = 'meta') => shape === 'meta_data' ? { meta_data: [{ key: '_elementor_data', value: JSON.stringify(tree) }] }
  : shape === 'flat' ? { 'meta._elementor_data': JSON.stringify(tree) } : { meta: { _elementor_data: JSON.stringify(tree) } }
const validate = (tree, options = {}) => validatePayload({ kind: 'page', lang: 'en', endpoint: 'wp/v2/pages/66619',
  source: carrier(original), payload: carrier(tree), ...options })
const checks = v => Object.fromEntries(v.checks.map(c => [c.name, c.ok]))
const bodyChecks = ['image_count_parity', 'heading_count_parity', 'no_new_scripts', 'no_new_tables']

test('Elementor-only changes fully check the authored tree for every supported carrier', () => {
  for (const p of ['meta', 'flat', 'meta_data']) for (const s of ['meta', 'flat', 'meta_data']) {
    const changed = structuredClone(original); changed[2].settings.editor = changed[2].settings.editor.replace('Trade', 'Wholesale')
    const v = validate(changed, { payload: carrier(changed, p), source: { ...carrier(original, s), content: { rendered: '<script>generated()</script><img><h2>Built</h2>' } } })
    assert.equal(v.passed, true, JSON.stringify(v.checks)); assert.equal(v.skipped, 0)
    for (const key of bodyChecks) assert.equal(checks(v)[key], true)
  }
})
for (const [name, mutate, key] of [
  ['native image removal', t => { t[1].settings.image = {} }, 'image_count_parity'],
  ['HTML image removal', t => { t[2].settings.editor = '<h2>Details</h2>' }, 'image_count_parity'],
  ['native heading tag change', t => { t[0].settings.header_size = 'p' }, 'heading_count_parity'],
  ['HTML heading removal', t => { t[2].settings.editor = '<p>Details</p><img>' }, 'heading_count_parity'],
  ['nested decoded script', t => { t[2].settings.repeater = [{ html: '<SCRIPT\n>unsafe()</SCRIPT>' }] }, 'no_new_scripts'],
  ['nested decoded table', t => { t[2].settings.repeater = [{ html: '<TABLE><tr></tr></TABLE>' }] }, 'no_new_tables'],
]) test('layout guard catches ' + name + ' even with unchanged fallback content', () => {
  const tree = structuredClone(original); mutate(tree)
  const v = validate(tree, { source: { ...carrier(original), content: { raw: '<p>Unchanged fallback</p>' } }, payload: { ...carrier(tree), content: '<p>Unchanged fallback</p>' } })
  assert.equal(checks(v)[key], false); assert.equal(v.passed, false)
})

test('declared new sections/columns/containers count only actual new widgets', () => {
  for (const elType of ['section', 'container']) {
    const tree = [...structuredClone(original), { id: 'section', elType, settings: {}, elements: [{ id: 'column', elType: 'column', settings: {}, elements: [
      widget('new-heading', 'heading', { title: 'Enquiries' }), widget('new-image', 'image', { image: { id: 8, url: '/new.jpg' } }),
    ] }] }]
    const opts = { appendOnly: true, expectedNewIds: ['section', 'column', 'new-heading', 'new-image'] }
    const v = validate(tree, opts)
    assert.equal(v.passed, true, JSON.stringify(v.checks)); assert.equal(v.skipped, 0)
    assert.equal(checks(validate(tree, { ...opts, expectedNewIds: ['new-heading', 'new-image'] })).element_ids_preserved, false)
    assert.equal(checks(validate(tree, { ...opts, expectedNewIds: [...opts.expectedNewIds, 'absent'] })).element_ids_preserved, false)
    assert.equal(checks(validate(tree, { ...opts, expectedNewIds: [...opts.expectedNewIds, 'section'] })).widget_count, false)
    assert.equal(checks(validate(tree, { ...opts, appendOnly: false })).widget_count, false)
    const bad = structuredClone(tree); bad.at(-1).elements[0].elements[0].settings.title = '<script>new()</script>'
    assert.equal(checks(validate(bad, opts)).no_new_scripts, false)
  }
})

test('additions cannot compensate for removed images/headings on existing nodes', () => {
  const tree = structuredClone(original); tree[1].settings.image = {}; tree[0].settings.header_size = 'p'
  tree.push(widget('replacement-image', 'image', { image: { id: 1, url: '/replacement.jpg' } }), widget('replacement-heading', 'heading', { title: 'Enquiries' }))
  const v = validate(tree, { appendOnly: true, expectedNewIds: ['replacement-image', 'replacement-heading'] })
  assert.equal(checks(v).image_count_parity, false); assert.equal(checks(v).heading_count_parity, false)
})

test('malformed or missing layout baseline fails body checks; unchanged content cannot certify it', () => {
  for (const source of [{}, { content: { raw: 'Fallback' } }, { meta: { _elementor_data: '[' } }]) {
    const v = validate(original, { source })
    for (const key of bodyChecks) assert.equal(checks(v)[key], false)
  }
  const bad = validate(original, { payload: { meta: { _elementor_data: '[' } } })
  for (const key of bodyChecks) assert.equal(checks(bad)[key], false)
})

test('first layout checks scripts/tables with positive empty evidence, never renders', () => {
  for (const source of [carrier([]), { id: 66619, content: { raw: '' }, meta: {} }]) {
    const v = validate(original, { source }); assert.equal(v.passed, true); assert.equal(v.skipped, 0)
    const tree = structuredClone(original); tree[2].settings.editor += '<table></table>'
    assert.equal(checks(validate(tree, { source })).no_new_tables, false)
  }
})

test('existing scripts do not suppress detection of additional scripts or scripts on new nodes', () => {
  const sourceTree = structuredClone(original); sourceTree[2].settings.editor += '<script>existing()</script>'
  assert.equal(checks(validate(sourceTree, { source: carrier(sourceTree) })).no_new_scripts, true)
  const tree = structuredClone(sourceTree); tree[2].settings.editor += '<script>additional()</script>'
  assert.equal(checks(validate(tree, { source: carrier(sourceTree) })).no_new_scripts, false)
})

test('gallery media, native default h2 and unrelated content each retain their own baseline', () => {
  const src = [widget('g', 'image-gallery', { gallery: [{ id: 1 }, { url: '/2.jpg' }] }), widget('h', 'heading', { title: 'Crystocraft' })]
  const tree = structuredClone(src); tree[0].settings.gallery.pop()
  assert.equal(checks(validate(tree, { source: carrier(src) })).image_count_parity, false)
  const v = validate(src, { source: { ...carrier(src), content: { raw: '<img><h2>Fallback</h2>' } }, payload: { ...carrier(src), content: '<p>Removed fallback</p>' } })
  assert.equal(checks(v).image_count_parity, false); assert.equal(checks(v).heading_count_parity, false)
})

test('image controls in containers, image boxes and nested repeaters are preserved; links are not media', () => {
  const sourceTree = [{ id: 'container', elType: 'container', settings: { background_image: { id: 11, url: '/background.jpg' } }, elements: [
    widget('box', 'image-box', { image: { id: 12, url: '/box.jpg' }, link: { url: '/contact' }, slides: [{ image: { id: 13, url: '/slide.jpg' } }] }),
  ] }]
  for (const remove of [t => { t[0].settings.background_image = {} }, t => { t[0].elements[0].settings.image = {} },
    t => { t[0].elements[0].settings.slides = [] }]) {
    const tree = structuredClone(sourceTree); remove(tree)
    assert.equal(checks(validate(tree, { source: carrier(sourceTree) })).image_count_parity, false)
  }
  const tree = structuredClone(sourceTree); tree[0].elements[0].settings.link.url = '/new-contact'
  assert.equal(checks(validate(tree, { source: carrier(sourceTree) })).image_count_parity, true)
})

test('body/title raw objects in reviewed snapshots compare symmetrically; drift stays strict', async () => {
  for (const field of ['content', 'excerpt', 'title']) {
    for (const value of ['Old', { raw: 'Old', rendered: 'Built content' }]) {
      let puts = 0
      const r = await safeWrite({ id: 1, endpoint: 'wp/v2/pages/1', payload: { [field]: 'New' }, expectedFields: [field],
        expectedBefore: { [field]: value }, get: async () => ({ [field]: { raw: puts ? 'New' : 'Old', rendered: 'Different render' } }), put: async () => { puts++ } })
      assert.equal(r.verified, true); assert.equal(puts, 1)
    }
    let puts = 0
    const r = await safeWrite({ id: 1, payload: { [field]: 'New' }, expectedBefore: { [field]: { raw: 'Reviewed' } },
      get: async () => ({ [field]: { raw: 'Changed' } }), put: async () => { puts++ } })
    assert.match(r.error, /reviewed source changed/); assert.equal(puts, 0)
  }
})

test('missing private pre-read and rendered-only body have actionable errors and zero PUTs', async () => {
  for (const [expectedBefore, before] of [[{ 'meta._yoast_wpseo_title': 'Reviewed' }, { meta: {} }],
    [{ content: 'Reviewed' }, { content: { rendered: 'Reviewed' } }]]) {
    let puts = 0
    const r = await safeWrite({ id: 1, payload: { title: 'Next' }, expectedBefore, get: async () => before, put: async () => { puts++ } })
    assert.match(r.error, /pre-read.*not visible.*context=edit/); assert.ok(r.missing.length); assert.equal(r.stale, undefined); assert.equal(puts, 0)
  }
})

test('missing post-read target is unverified and warns that the write may already have happened', async () => {
  let puts = 0
  const r = await safeWrite({ id: 1, payload: { meta: { private_key: 'New' } }, expectedFields: ['meta.private_key'],
    expectedBefore: { 'meta.private_key': '' }, get: async () => ({ meta: puts ? {} : { private_key: '' } }), put: async () => { puts++ } })
  assert.equal(puts, 1); assert.equal(r.verified, false); assert.match(r.error, /post-read.*not visible.*write may already have occurred/)
})

test('claimed/refused receipt is inert but does not block a fresh reviewed batch for the same entity', async () => {
  const old = { status: 'partial', execution_started_at: 'then', items: [{ decision: 'approve', endpoint: 'wp/v2/pages/1', result: { ok: false, verified: false } }] }
  assert.deepEqual(queuePlan([{ endpoint: 'wp/v2/pages/1' }], [{ id: 'old', ...old }]).conflicts, [])
  const db = { runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => old }) }) }
  await assert.rejects(claimBatch(db, {}, 'now'), /not available/)
  await assert.rejects(withdrawBatch(db, {}, 'now', 'obsolete'), /cannot withdraw/)
  assert.equal(old.status, 'partial'); assert.ok(old.items[0].result)
})
