import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePayload, isCreateEndpoint, validateAllow } from '../seo-control-plane/validate-payload.mjs'
import { revalidateBatchItem } from '../netlify/functions/seo-batch.js'
const tree = JSON.stringify([{ id: 'a', elType: 'widget', widgetType: 'heading', settings: { title: 'Wholesale' } }])
const payload = { meta: { _elementor_data: tree }, status: 'draft' }
const guards = ['widget_count', 'element_ids_preserved', 'length_anomaly']
const check = (v, name) => v.checks.find(c => c.name === name)

test('collection creates accept a first layout, including query and trailing slash', () => {
  for (const endpoint of ['wp/v2/pages', 'wp/v2/posts?lang=en', 'wp/v2/pages/?lang=en', 'wc/v3/products']) {
    const v = validatePayload({ endpoint, payload })
    assert.equal(v.passed, true)
    for (const name of guards) { assert.equal(check(v, name).ok, true); assert.match(check(v, name).detail, /nothing to preserve/) }
  }
  for (const endpoint of ['wp/v2/pages/123', 'wp/v2/pages/123?lang=en', 'x/wp/v2/pages', 'wc/v3/pages']) assert.equal(isCreateEndpoint(endpoint), false)
})

test('existing plain page needs an explicit empty value or complete edit entity', () => {
  for (const source of [
    { id: 123, content: { raw: '' }, meta: {} },
    { meta: { _elementor_data: '' } }, { 'meta._elementor_data': null },
    { meta_data: [{ key: '_elementor_data', value: '[]' }] },
    { meta: { _elementor_data: [] } },
  ]) {
    const v = validatePayload({ endpoint: 'wp/v2/pages/123', payload, source })
    for (const name of guards) assert.equal(check(v, name).ok, true)
  }
})

test('missing, malformed, primitive, rendered-only and incomplete baselines still fail', () => {
  for (const source of [null, {}, { id: 123 }, { meta: {} },
    { id: 123, content: { rendered: 'page' }, meta: {} },
    { id: 123, content: { raw: '' }, 'meta._yoast_wpseo_title': 'Only a partial snapshot' },
    { meta: { _elementor_data: '{broken' } }, { meta: { _elementor_data: 'false' } }]) {
    const v = validatePayload({ endpoint: 'wp/v2/pages/123', payload, source, create: true })
    assert.equal(v.passed, false)
    for (const name of guards) assert.equal(check(v, name).ok, false)
  }
})

test('existing layouts retain loss-of-widgets and ID preservation guards', () => {
  const source = { meta: { _elementor_data: tree } }
  const v = validatePayload({ endpoint: 'wp/v2/pages/123', payload: { meta: { _elementor_data: '[]' } }, source })
  assert.equal(check(v, 'widget_count').ok, false)
  assert.equal(check(v, 'element_ids_preserved').ok, false)
})

test('malformed new layout and published unlinked translation remain blocked', () => {
  assert.equal(validatePayload({ endpoint: 'wp/v2/pages', payload: { meta: { _elementor_data: '{bad' } } }).passed, false)
  for (const endpoint of ['wp/v2/pages?lang=fr', 'wp/v2/pages/?lang=fr'])
    assert.equal(validatePayload({ endpoint, lang: 'fr', payload: { ...payload, status: 'publish' } }).passed, false)
})

test('reasoned exception retains original failure and requires human decision separately', () => {
  const it = { endpoint: 'wp/v2/pages/123', payload: { meta: { _yoast_wpseo_metadesc: 'x'.repeat(159) } },
    allow: [{ check: 'seo_desc_length', why: 'Approved campaign description length' }] }
  const v = revalidateBatchItem(it)
  assert.equal(v.passed, true); assert.equal(v.rawPassed, false); assert.equal(v.overridden, 1)
  assert.equal(check(v, 'seo_desc_length').ok, false)
  assert.equal(check(v, 'seo_desc_length').overridden, true)
  assert.equal(check(v, 'seo_desc_length').why, it.allow[0].why)
  assert.equal(it.decision, undefined)
})

test('missing reasons, duplicates, unknown and non-applicable exceptions fail closed', () => {
  for (const allow of [null, {}, [{ check: 'seo_desc_length', why: ' ' }], [{ check: 'seo_desc_length' }],
    [{ check: 'x', why: 'a' }, { check: 'x', why: 'b' }]]) assert.ok(validateAllow(allow).length)
  for (const allow of [[{ check: 'unknown', why: 'reason' }], [{ check: 'widget_count', why: 'reason' }],
    [{ check: 'unknown', why: 'reason' }, { check: 'allow_valid', why: 'Cannot waive exception validation' }]])
    assert.equal(validatePayload({ payload: { title: 'Title' }, allow }).passed, false)
})

test('exceptions cannot waive missing evidence, broken JSON or translation publication', () => {
  const v = validatePayload({ endpoint: 'wp/v2/pages/123', payload,
    allow: guards.map(check => ({ check, why: 'No source provided' })) })
  assert.equal(v.passed, false); assert.equal(v.overridden, 0)
  assert.equal(validatePayload({ endpoint: 'wp/v2/pages?lang=fr', lang: 'fr',
    payload: { status: 'publish' }, allow: [{ check: 'translation_draft_only', why: 'Publish' }] }).passed, false)
})


test('review UI shows first-layout note, exception reason and original failure', async () => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const require = createRequire(import.meta.url)
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const bundle = await build({ entryPoints: ['src/components/SeoValidationDetails.jsx'], bundle: true,
    write: false, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'react-external', setup(b) {
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }))
    } }] })
  const { default: Details } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const html = renderToStaticMarkup(React.createElement(Details, {
    validation: { checks: [{ name: 'widget_count', ok: true, detail: 'no prior _elementor_data — nothing to preserve' },
      { name: 'seo_desc_length', ok: false, overridden: true, detail: '159 chars (>158)' }] },
    allow: [{ check: 'seo_desc_length', why: 'Campaign <review>' }] }))
  assert.match(html, /nothing to preserve/)
  assert.match(html, /Campaign &lt;review&gt;/)
  assert.match(html, /original failure retained/)
  assert.match(html, /159 chars/)
  assert.equal(renderToStaticMarkup(React.createElement(Details)), '')
})


test('a first layout validates its own tree instead of accepting arbitrary JSON', () => {
  for (const data of [{}, [], [null], [{ id: 'a' }],
    [{ id: 'a', elType: 'widget', widgetType: 'heading' }, { id: 'a', elType: 'container' }],
    [{ id: 'a', elType: 'container', elements: 'broken' }]]) {
    const v = validatePayload({ endpoint: 'wp/v2/pages', payload: { meta: { _elementor_data: JSON.stringify(data) } },
      allow: [{ check: 'first_layout_structure', why: 'Cannot supply invalid layout' }] })
    assert.equal(v.passed, false)
  }
})
