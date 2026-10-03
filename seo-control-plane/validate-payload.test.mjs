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

// ── L-09: double-branding lives on the post-title template path ─────────
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { title: 'Best Corporate Gifts | Crystocraft' } })
  expect('L-09 post title with brand caught', v.passed === false && chk(v).seo_title_no_double_brand === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'fr', payload: {
    title: 'Horoscope Capricorne 2026 : Prédictions et Conseils',
    meta: { _yoast_wpseo_title: 'Horoscope Capricorne 2026 : Prédictions et Conseils | Crystocraft' },
  } })
  expect('L-09 custom title with brand accepted', v.passed === true && chk(v).seo_title_no_double_brand === true)
}
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: {
    title: 'Corporate Gifts', meta: { _yoast_wpseo_title: 'Crystocraft | Crystocraft' },
  } })
  expect('L-09 literal duplicate custom title caught', v.passed === false && chk(v).seo_title_no_double_brand === false)
}

// ── Encoding damage: inspect decoded Elementor content, not raw JSON ────
{
  const payload = { meta: { _elementor_data: JSON.stringify([
    { id: 'e1', elType: 'widget', widgetType: 'text-editor', settings: { editor: 'Damaged replacement: \uFFFD' } },
  ]) } }
  const v = validatePayload({ kind: 'post', lang: 'ja', payload })
  expect('encoding replacement character in Elementor caught', v.passed === false && chk(v).no_encoding_damage === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { title: `broken ${'\uDC00'}` } })
  expect('encoding lone low surrogate caught', v.passed === false && chk(v).no_encoding_damage === false)
}
{
  const v = validatePayload({ kind: 'post', lang: 'fr', payload: { title: 'Élégance française pour célébrer Noël' } })
  expect('ordinary accented copy has no encoding damage', chk(v).no_encoding_damage === true)
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

// ── 2026-09-23 (Workbench handoff): fr/ja/zh-hant leaked-translator-
// instruction coverage — 28 of 29 sitewide leaks predated this check ──────
{
  const leaks = [
    ['fr', 'Veuillez fournir le texte à traduire.'],
    ['fr', 'Veuillez fournir le texte source à traduire.'],
    ['fr', 'Merci de traduire le paragraphe suivant.'],
    ['ja', '翻訳するテキストを提供してください。'],
    ['ja', '以下の文章を翻訳してください。'],
    ['ja', 'テキストを提供してください'],
    ['zh-hant', '請提供要翻譯的文字。'],
    ['zh-hant', '請輸入需要翻譯的內容'],
    ['zh-hant', '需要翻譯'],
  ]
  for (const [lang, title] of leaks) {
    const v = validatePayload({ kind: 'post', lang, endpoint: `wp/v2/posts?lang=${lang}`, payload: { title, status: 'draft' } })
    expect(`leak caught [${lang}] "${title}"`, v.passed === false && chk(v).placeholder_markers === false)
  }
}

// ── same set: real copy that must NOT fire (the false positives v1 produced) ──
{
  const clean = [
    ['fr', 'Veuillez indiquer votre adresse de livraison.'],
    ['fr', 'Veuillez saisir votre code promotionnel.'],
    ['fr', 'Veuillez noter que les délais peuvent varier.'],
    ['fr', 'La traduction de nos catalogues est disponible sur demande.'],
    ['zh-hant', '請提供您的訂單編號以便我們查詢。'],
    ['zh-hant', '請輸入您的電郵地址。'],
    ['zh-hant', '翻譯服務由專人負責，歡迎查詢。'],
    ['ja', 'Crystocraftのこのユニークなワインデキャンタが心温まる贈り物になります。'],
  ]
  for (const [lang, title] of clean) {
    const v = validatePayload({ kind: 'post', lang, endpoint: `wp/v2/posts?lang=${lang}`, payload: { title, status: 'draft' } })
    expect(`real copy passes [${lang}] "${title}"`, chk(v).placeholder_markers !== false,
      JSON.stringify(v.checks.filter(c => !c.ok)))
  }
}

// ── 2026-10-03: parity compares the RAW body, not the REST render ───────
// A live entity's `content` is `{ rendered, raw }`; for an Elementor post
// `.rendered` is the whole BUILT page (36 images, 4 <h2>) while the payload's
// raw body is a short paragraph. Comparing them could never agree, so every
// correct Elementor edit failed the gate.
{
  const rendered = '<h2>One</h2><h2>Two</h2><h2>Three</h2><h2>Four</h2>' + '<img src="a.jpg"/>'.repeat(36)
  const mkEd = (t) => JSON.stringify([{ id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: t } }])
  const source = {
    content: { rendered, raw: '<p>Short intro.</p>' },
    meta: { _elementor_data: mkEd('Old heading') },
  }
  const payload = { content: '<p>Short intro.</p>', meta: { _elementor_data: mkEd('Neue Überschrift') }, status: 'draft' }
  const v = validatePayload({ kind: 'page', lang: 'de', endpoint: 'wp/v2/pages?lang=de', payload, source })
  const c = chk(v)
  expect('Elementor edit: rendered side no longer drives image parity', c.image_count_parity === undefined,
    JSON.stringify(v.checks.filter(x => !x.ok)))
  expect('Elementor edit: rendered side no longer drives heading parity', c.heading_count_parity === undefined,
    JSON.stringify(v.checks.filter(x => !x.ok)))
  expect('Elementor edit passes on its own merits', v.passed, JSON.stringify(v.checks.filter(x => !x.ok)))
}

// ── the same check must still bite when the raw body REALLY has images ──
{
  const raw = '<p><img src="a.jpg"/><img src="b.jpg"/></p>'
  const source = { content: { rendered: raw, raw } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p><img src="a.jpg"/></p>', status: 'draft' }, source })
  expect('classic HTML body still enforces image parity', chk(v).image_count_parity === false,
    JSON.stringify(chk(v)))
}
{
  const raw = '<h2>About</h2><h2>Care</h2>'
  const source = { content: { rendered: raw, raw } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<h2>About</h2>', status: 'draft' }, source })
  expect('classic HTML body still enforces heading parity', chk(v).heading_count_parity === false,
    JSON.stringify(chk(v)))
}

// ── no_new_scripts/tables must read the raw body too ────────────────────
// Yoast's inline JSON-LD <script> lives in `.rendered`; it used to make the
// source side look script-bearing and suppress the check entirely.
{
  const source = { content: { rendered: '<p>ok</p><script type="application/ld+json">{}</script>', raw: '<p>ok</p>' } }
  const v = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><script>alert(1)</script>', status: 'draft' }, source })
  expect('no_new_scripts compares the raw body', chk(v).no_new_scripts === false, JSON.stringify(chk(v)))

  const v2 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p>', status: 'draft' }, source })
  expect('a clean body passes when the render carries JSON-LD', chk(v2).no_new_scripts === true, JSON.stringify(chk(v2)))

  const source2 = { content: { rendered: '<p>ok</p>', raw: '<p>ok</p><script>x</script>' } }
  const v3 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><script>x</script>', status: 'draft' }, source: source2 })
  expect('a script already in the raw source is skipped, not flagged', chk(v3).no_new_scripts !== false, JSON.stringify(chk(v3)))

  const source3 = { content: { rendered: '<p>ok</p><table><tr><td>x</td></tr></table>', raw: '<p>ok</p>' } }
  const v4 = validatePayload({ kind: 'post', lang: 'en', payload: { content: '<p>ok</p><table><tr><td>y</td></tr></table>', status: 'draft' }, source: source3 })
  expect('no_new_tables compares the raw body', chk(v4).no_new_tables === false, JSON.stringify(chk(v4)))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
