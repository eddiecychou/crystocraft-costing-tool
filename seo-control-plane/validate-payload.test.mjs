// node seo-control-plane/validate-payload.test.mjs
import { validatePayload } from './validate-payload.mjs'

let pass = 0, fail = 0
const chk = (v) => v.checks.reduce((m, c) => (m[c.name] = c.ok, m), {})
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── a clean ES product translation ───────────────────────────────────────
{
  const source = {
    name: 'D0268 Crystal Rose Figurine',
    description: '<h2>About</h2><p>A crystal rose <img src="a.jpg"/> gift.</p>',
    meta: { _elementor_data: JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: 'Colours and Effects' } }]) },
  }
  const payload = {
    name: 'D0268 Figura de Rosa de Cristal',
    description: '<h2>Acerca de</h2><p>Un regalo de rosa de cristal <img src="a.jpg"/>.</p>',
    meta: {
      _elementor_data: JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: 'Colores y efectos' } }]),
      _yoast_wpseo_title: 'Figura de Rosa de Cristal - Crystocraft',
      _yoast_wpseo_metadesc: 'Una figura de rosa de cristal, regalo corporativo elegante de Crystocraft.',
    },
    status: 'draft',
  }
  const v = validatePayload({ kind: 'product', lang: 'es', endpoint: 'wc/v3/products?lang=es', payload, source })
  expect('clean ES payload passes', v.passed, JSON.stringify(v.checks.filter(c => !c.ok)))
  const c = chk(v)
  expect('  widget_count ok', c.widget_count === true)
  expect('  brand preserved', c.brand_terms_preserved === true)
  expect('  image parity', c.image_count_parity === true)
}

// ── B6: length anomaly (short heading ballooned) ─────────────────────────
{
  const source = { meta: { _elementor_data: JSON.stringify([{ id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'IT Film' } }]) } }
  const payload = { meta: { _elementor_data: JSON.stringify([{ id: 'h1', elType: 'widget', widgetType: 'heading', settings: { title: 'IT Film '.repeat(200) } }]) } }
  const v = validatePayload({ kind: 'product', lang: 'zh-hant', payload, source })
  expect('B6 length anomaly caught', v.passed === false && chk(v).length_anomaly === false)
}

// ── B33/B35: CJK leaked into a FR payload ───────────────────────────────
{
  const source = { name: 'Crystal Horse' }
  const payload = { name: 'Cheval en cristal 水晶马', status: 'draft' }
  const v = validatePayload({ kind: 'product', lang: 'fr', payload, source })
  expect('B33 CJK-in-fr caught', v.passed === false && chk(v).wrong_language_chars === false)
}

// ── simplified char in a zh-hant payload ────────────────────────────────
{
  const payload = { name: '水晶马' } // 马 is simplified; 馬 is traditional
  const v = validatePayload({ kind: 'product', lang: 'zh-hant', payload })
  expect('simplified-in-zh-hant caught', v.passed === false && chk(v).wrong_language_chars === false)
}

// ── B12: placeholder marker ─────────────────────────────────────────────
{
  const v = validatePayload({ kind: 'product', lang: 'es', payload: { name: 'Por favor, proporcione el nombre del producto' } })
  expect('B12 placeholder caught', v.passed === false && chk(v).placeholder_markers === false)
}

// ── L-09: double-branded Yoast title ───────────────────────────────────
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { meta: { _yoast_wpseo_title: 'Best Corporate Gifts | Crystocraft' } } })
  expect('L-09 double-brand caught', v.passed === false && chk(v).seo_title_no_double_brand === false)
}

// ── Rule 4: publishing an unlinked translation ─────────────────────────
{
  const v = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja', payload: { title: 'テスト', status: 'publish' } })
  expect('Rule 4 publish-translation caught', v.passed === false && chk(v).translation_draft_only === false)
}

// ── B20: stale layout (widget count mismatch) ─────────────────────────
{
  const mk = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: 'w' + i, elType: 'widget', widgetType: 'text-editor', settings: { editor: 'x' } })))
  const v = validatePayload({
    kind: 'page', lang: 'ja',
    payload: { meta: { _elementor_data: mk(16) } },
    source: { meta: { _elementor_data: mk(20) } },
  })
  expect('B20 stale-layout caught', v.passed === false && chk(v).widget_count === false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
