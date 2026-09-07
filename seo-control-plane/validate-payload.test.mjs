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

// ── B51: polite "por favor" in real es copy must NOT flag ─────────────
{
  const v = validatePayload({ kind: 'page', lang: 'es',
    payload: { title: 'Contáctenos', content: '<p>Por favor, contáctenos para un presupuesto. Por favor visítenos en la feria.</p>', status: 'draft' } })
  expect('B51 polite por-favor passes', chk(v).placeholder_markers !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // but a leaked translator instruction still trips it
  const v2 = validatePayload({ kind: 'page', lang: 'es', payload: { title: 'Por favor traduzca el siguiente texto' } })
  expect('B51 still catches "por favor traduzca"', v2.passed === false && chk(v2).placeholder_markers === false)
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

// ── B53: Yoast head / JSON-LD must not drive brand_terms_preserved ─────
{
  // Source carries Yoast's generated head with "Crystocraft" in JSON-LD +
  // an inline JSON-LD <script> in the body; the ES payload legitimately
  // keeps "Crystocraft" in visible copy but not in those machine blocks.
  const source = {
    name: 'D0268 Crystocraft Crystal Rose',
    description: '<p>A Crystocraft gift.</p><script type="application/ld+json">{"@type":"Product","brand":"Crystocraft"}</script>',
    yoast_head_json: { og_site_name: 'Crystocraft', schema: { '@graph': [{ name: 'Crystocraft' }] } },
    yoast_head: '<meta property="og:site_name" content="Crystocraft"/>',
  }
  const payload = {
    name: 'D0268 Rosa de Cristal Crystocraft',
    description: '<p>Un regalo de Crystocraft.</p>',
    status: 'draft',
  }
  const v = validatePayload({ kind: 'product', lang: 'es', endpoint: 'wc/v3/products?lang=es', payload, source })
  expect('B53 Yoast/JSON-LD not counted for brand check', chk(v).brand_terms_preserved === true,
    JSON.stringify(v.checks.filter(c => !c.ok)))
}

// ── B51/B53: valid Traditional forms no longer flagged in zh-hant ──────
{
  // 舞台 (stage), 回顧 (review), 繁體 (traditional), 山谷 (valley), 羨慕 (envy)
  const v = validatePayload({ kind: 'page', lang: 'zh-hant', payload: { title: '舞台上的回顧：繁體字、山谷與羨慕' } })
  expect('zh-hant allows 台回繁谷慕', chk(v).wrong_language_chars !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // but a genuine simplified form still trips it (这 个 门 are all PRC-simplified)
  const v2 = validatePayload({ kind: 'page', lang: 'zh-hant', payload: { title: '这个门' } })
  expect('zh-hant still catches 这个门', v2.passed === false && chk(v2).wrong_language_chars === false)
}

// ── B54: ja payload of normal Japanese kanji must pass ────────────────
{
  // All standard Japanese: 国 台 宝 当 号 写 声 将 会 図 実 対
  const v = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja',
    payload: { title: '国宝級の台座と号数', content: '<p>会場の図と実物に対する声</p>', status: 'draft' } })
  expect('B54 normal ja kanji passes', chk(v).wrong_language_chars !== false,
    JSON.stringify(v.checks.filter(c => !c.ok)))
  // a PRC-only form still trips it
  const v2 = validatePayload({ kind: 'post', lang: 'ja', endpoint: 'wp/v2/posts?lang=ja',
    payload: { title: '这个说话', status: 'draft' } })
  expect('B54 still catches 这个说 in ja', v2.passed === false && chk(v2).wrong_language_chars === false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
