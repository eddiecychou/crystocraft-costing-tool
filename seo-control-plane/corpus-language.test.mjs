import test from 'node:test'
import assert from 'node:assert/strict'
import { auditCorpusRow, scriptRatio } from './corpus-language.mjs'

test('Chinese and Japanese corpus thresholds catch untranslated Latin bodies', () => {
  assert.equal(scriptRatio('Crystal gifts '.repeat(20) + '水晶', 'zh-hant').flagged, true)
  assert.equal(scriptRatio('水晶禮品'.repeat(20) + 'Crystal', 'zh-hant').flagged, false)
  assert.equal(scriptRatio('Crystal gifts '.repeat(20) + '日本', 'ja').flagged, true)
  assert.equal(scriptRatio('日本語の贈り物'.repeat(20) + 'Crystal', 'ja').flagged, false)
})

test('French, Spanish, English detect substantial CJK leakage', () => {
  assert.equal(scriptRatio('Cadeau en cristal '.repeat(20) + '水晶礼品'.repeat(5), 'fr').flagged, true)
  assert.equal(scriptRatio('Regalo de cristal '.repeat(20), 'es').flagged, false)
  assert.equal(scriptRatio('Crystal gift '.repeat(4) + '水晶礼品'.repeat(15), 'en').flagged, true)
})

test('product audit reads both body fields and selected Elementor widget text', () => {
  const row = auditCorpusRow({
    id: 60509, status: 'publish', description: '<p>Crystal gift collection</p>',
    short_description: '<p>Corporate gift</p>',
    meta_data: [{ key: '_elementor_data', value: JSON.stringify([{ id: 'abc', elType: 'widget',
      settings: { editor: 'English editorial copy', caption: 'Logo caption' } }]) }],
  }, 'product', 'zh-hant')
  assert.equal(row.flagged, true)
  assert.equal(row.coverage.elementor_meta_visible, true)
  assert.deepEqual(row.fields.map(f => f.field), [
    'post_content', 'post_excerpt', 'elementor.abc.editor', 'elementor.abc.caption',
  ])
})

test('post audit uses raw body, not rendered page, and reports malformed Elementor JSON', () => {
  const row = auditCorpusRow({ id: 10, status: 'publish',
    content: { raw: '<p>水晶禮品</p>', rendered: '<p>English nav footer</p>' },
    excerpt: { raw: '訂製禮物', rendered: 'English footer' },
    meta: { _elementor_data: '{broken' },
  }, 'post', 'zh-hant')
  assert.equal(row.latin, 0)
  assert.equal(row.coverage.raw_body_visible, true)
  assert.equal(row.fields[0].error, 'invalid Elementor JSON')
})

test('missing REST metadata is explicit rather than a clean full sweep', () => {
  const row = auditCorpusRow({ id: 11, status: 'publish', content: { rendered: 'Only rendered content' } }, 'post', 'zh-hant')
  assert.deepEqual(row.coverage, { elementor_meta_visible: false, raw_body_visible: false })
})
